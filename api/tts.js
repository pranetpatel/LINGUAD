// Vercel serverless function: ElevenLabs TTS proxy. Replaces supabase/functions/tts —
// same contract (POST {text, gender} -> audio/mpeg), but reads ELEVENLABS_API_KEY
// from Vercel's env instead of Supabase secrets.
import { requireSupabaseUser } from "./_auth.js";

const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVEN_VOICE = {
  f: "21m00Tcm4TlvDq8ikWAM" /* Rachel */,
  m: "pNInz6obpgDQGcFmaJgB" /* Adam */,
  kid_f: "MF3mGyEYCl7XYWbV9V6O" /* Elli */,
  kid_m: "TxGEqnHWrfWFTfGW9XjX" /* Josh */,
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await requireSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });
  if (!ELEVEN_KEY) return res.status(503).json({ error: "Server has no ELEVENLABS_API_KEY configured" });

  const { text, gender } = req.body || {};
  if (!text) return res.status(400).json({ error: "text required" });

  const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE[gender] || ELEVEN_VOICE.f}`, {
    method: "POST",
    headers: { "xi-api-key": ELEVEN_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: String(text).slice(0, 900),
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true },
    }),
  });
  if (!upstream.ok) {
    return res.status(upstream.status).json({ error: "TTS upstream error" });
  }
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.setHeader("Content-Type", "audio/mpeg");
  return res.status(200).send(buf);
}
