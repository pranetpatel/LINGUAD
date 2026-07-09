/* ASR providers for the scoring pipeline. The scorer is provider-agnostic:
   any backend that yields a transcript (+ optional word confidences) plugs in.
   - "browser": trusts the client's Web Speech transcript + confidence
   - "elevenlabs": real acoustic STT (scribe_v1) with word-level confidence,
     used automatically when the server holds an ELEVENLABS_API_KEY and the
     client sends audio. Add Whisper/GCP here the same way. */
import { ELEVEN_KEY } from "../env.js";

export async function transcribe({ audioB64, mime, lang, transcript, confidence }) {
  if (ELEVEN_KEY && audioB64) {
    try {
      const bytes = Buffer.from(audioB64, "base64");
      const form = new FormData();
      form.append("model_id", "scribe_v1");
      form.append("language_code", lang === "es" ? "spa" : "eng");
      form.append("file", new Blob([bytes], { type: mime || "audio/webm" }), "utterance.webm");
      const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": ELEVEN_KEY },
        body: form,
      });
      if (res.ok) {
        const data = await res.json();
        const wordConfs = {};
        for (const w of data.words || []) {
          if (w.type === "word" && typeof w.logprob === "number") {
            wordConfs[String(w.text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")] = Math.min(1, Math.exp(w.logprob));
          }
        }
        return { heard: data.text || "", wordConfs: Object.keys(wordConfs).length ? wordConfs : null, overallConf: null, provider: "elevenlabs" };
      }
    } catch { /* fall through to browser transcript */ }
  }
  return { heard: transcript || "", wordConfs: null, overallConf: typeof confidence === "number" ? confidence : null, provider: "browser" };
}
