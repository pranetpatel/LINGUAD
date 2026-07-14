// Vercel serverless function: OpenAI TTS proxy. Replaces the ElevenLabs-based
// TTS proxy — same contract (POST {text, gender, lang} -> audio/mpeg), but
// uses OPENAI_API_KEY (already required for chat) instead of a separate
// ELEVENLABS_API_KEY. gpt-4o-mini-tts supports steerable `instructions`,
// which we use to push toward native pronunciation per target language
// (this is the fix for the Spanish "J" issue reported by testers — it also
// now receives the target language at all, which the old ElevenLabs proxy
// never did, so it had no way to pick a Spanish-appropriate voice/style).
import { requireSupabaseUser } from "./_auth.js";

const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

// Matched to the same 4 persona slots the app already uses (f/m/kid_f/kid_m).
const OPENAI_VOICE = {
  f: "nova",
  m: "onyx",
  kid_f: "shimmer",
  kid_m: "fable",
};

const ACCENT_INSTRUCTIONS = {
  es: "Speak in natural, native Spanish (neutral Latin American accent). Use authentic Spanish pronunciation — for example, pronounce the letter J as the Spanish H sound, not an English J. Warm, clear, conversational pace, like a friendly tutor.",
  en: "Speak naturally in English, warm and conversational pace, like a friendly tutor.",
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await requireSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });
  if (!OPENAI_KEY) return res.status(503).json({ error: "Server has no OPENAI_API_KEY configured" });

  const { text, gender, lang } = req.body || {};
  if (!text) return res.status(400).json({ error: "text required" });

  const upstream = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: OPENAI_VOICE[gender] || OPENAI_VOICE.f,
      input: String(text).slice(0, 900),
      instructions: ACCENT_INSTRUCTIONS[lang] || ACCENT_INSTRUCTIONS.en,
      response_format: "mp3",
    }),
  });
  if (!upstream.ok) {
    const errBody = await upstream.text().catch(() => "");
    return res.status(upstream.status).json({ error: errBody || "TTS upstream error" });
  }
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.setHeader("Content-Type", "audio/mpeg");
  return res.status(200).send(buf);
}