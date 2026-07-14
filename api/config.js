// Vercel serverless function: capability check. Mirrors server/index.js's
// `/api/config` — tells the client whether AI/TTS are actually usable,
// based on real env var presence, instead of assuming they are.
// No auth required: it leaks no secrets, only booleans (+ which AI provider).
import { pickProvider } from "./_ai.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const provider = pickProvider();
  const tts = !!process.env.ELEVENLABS_API_KEY;

  return res.status(200).json({ ai: !!provider, aiProvider: provider, tts, stt: false, streamingAsr: false });
}