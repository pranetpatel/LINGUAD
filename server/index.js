/* ── Lingua backend ────────────────────────────────────────────────────────
   Server-held keys · multi-device household sync · speech-scoring pipeline */
import http from "node:http";
import express from "express";
import cors from "cors";
import { PORT, ANTHROPIC_KEY, OPENAI_KEY, ELEVEN_KEY, ORIGINS } from "./env.js";
import { accounts, households } from "./store.js";
import { signup, login, requireAuth } from "./auth.js";
import { transcribe } from "./speech/providers.js";
import { scoreUtterance } from "./speech/score.js";
import { makeLimiter, byIp, byAccount } from "./ratelimit.js";
import { complete, pickProvider } from "./ai.js";
import { attachAsr, streamingAvailable } from "./asr/stream.js";

const app = express();
app.use(cors({ origin: ORIGINS.includes("*") ? true : ORIGINS }));
app.use(express.json({ limit: "16mb" })); // audio arrives as base64 JSON

const ok = (res, body) => res.json(body);
const fail = (res, e) => res.status(e.status || 500).json({ error: e.message || "Server error" });

/* ── rate limits (fixed windows, per-IP for auth, per-account elsewhere) ── */
const authLimit  = makeLimiter({ windowMs: 60000, max: 10,  name: "auth"  });
const aiLimit    = makeLimiter({ windowMs: 60000, max: 30,  name: "ai"    });
const ttsLimit   = makeLimiter({ windowMs: 60000, max: 60,  name: "tts"   });
const scoreLimit = makeLimiter({ windowMs: 60000, max: 30,  name: "score" });
const syncLimit  = makeLimiter({ windowMs: 60000, max: 120, name: "sync"  });

app.get("/api/health", (_, res) => ok(res, { ok: true, service: "lingua" }));
app.get("/api/config", (_, res) => ok(res, { ai: !!pickProvider(), aiProvider: pickProvider(), tts: !!OPENAI_KEY, stt: !!ELEVEN_KEY, streamingAsr: streamingAvailable() }));

/* ── auth ── */
app.post("/api/auth/signup", authLimit.mw(byIp), async (req, res) => { try { ok(res, await signup(req.body || {})); } catch (e) { fail(res, e); } });
app.post("/api/auth/login", authLimit.mw(byIp), async (req, res) => { try { ok(res, await login(req.body || {})); } catch (e) { fail(res, e); } });

/* ── multi-device household sync (versioned, conflict-aware) ── */
app.get("/api/household", requireAuth, syncLimit.mw(byAccount), async (req, res) => {
  const hh = await households.get(req.accountId);
  if (!hh) return fail(res, { status: 404, message: "No household" });
  ok(res, { version: hh.version, data: hh.data });
});
app.put("/api/household", requireAuth, syncLimit.mw(byAccount), async (req, res) => {
  const { version, data } = req.body || {};
  if (!data || typeof version !== "number") return fail(res, { status: 400, message: "version and data required" });
  const r = await households.put(req.accountId, version, data);
  if (r.ok) return ok(res, { version: r.version });
  res.status(409).json({ conflict: true, version: r.version, data: r.data }); // client refreshes to the newer copy
});
app.delete("/api/household", requireAuth, syncLimit.mw(byAccount), async (req, res) => {
  try {
    const acc = await accounts.byId(req.accountId);
    if (!acc) return fail(res, { status: 404, message: "No account" });
    const fresh = { account: { name: acc.name, email: acc.email }, type: acc.type, members: [] };
    const r = await households.reset(req.accountId, fresh);
    ok(res, { version: r.version, data: r.data });
  } catch (e) { fail(res, e); }
});

/* ── server-held AI key: Anthropic/OpenAI proxy (dual provider) ── */
app.post("/api/ai", requireAuth, aiLimit.mw(byAccount), async (req, res) => {
  try {
    const { messages, maxTokens } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) return fail(res, { status: 400, message: "messages required" });
    ok(res, await complete({ messages, maxTokens }));
  } catch (e) { fail(res, e); }
});

/* ── server-held voice key: OpenAI TTS proxy (gpt-4o-mini-tts) ──
   Replaces the old ElevenLabs-based TTS proxy — same contract (POST
   {text, gender, lang} -> audio/mpeg), but uses OPENAI_API_KEY (already
   required for chat) instead of a separate ELEVENLABS_API_KEY. Note
   ELEVEN_KEY is still used below for acoustic speech-to-text scoring —
   that's a separate capability this swap doesn't touch. */
const OPENAI_VOICE = {
  f: "nova", m: "onyx", kid_f: "shimmer", kid_m: "fable",
};
const ACCENT_INSTRUCTIONS = {
  es: "Speak in natural, native Spanish (neutral Latin American accent). Use authentic Spanish pronunciation — for example, pronounce the letter J as the Spanish H sound, not an English J. Warm, clear, conversational pace, like a friendly tutor.",
  en: "Speak naturally in English, warm and conversational pace, like a friendly tutor.",
};
app.post("/api/tts", requireAuth, ttsLimit.mw(byAccount), async (req, res) => {
  try {
    if (!OPENAI_KEY) return fail(res, { status: 503, message: "Server has no OPENAI_API_KEY configured" });
    const { text, gender, lang } = req.body || {};
    if (!text) return fail(res, { status: 400, message: "text required" });
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
      return fail(res, { status: upstream.status, message: errBody || "TTS upstream error" });
    }
    res.type("audio/mpeg");
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (e) { fail(res, e); }
});

/* ── the speech-scoring pipeline endpoint ── */
app.post("/api/speech/score", requireAuth, scoreLimit.mw(byAccount), async (req, res) => {
  try {
    const { expected, lang, audioB64, mime, transcript, confidence } = req.body || {};
    if (!expected) return fail(res, { status: 400, message: "expected text required" });
    const asr = await transcribe({ audioB64, mime, lang, transcript, confidence });
    const result = scoreUtterance({ expected, heard: asr.heard, lang: lang === "es" ? "es" : "en", wordConfs: asr.wordConfs, overallConf: asr.overallConf });
    ok(res, { ...result, heard: asr.heard, provider: asr.provider });
  } catch (e) { fail(res, e); }
});

const server = http.createServer(app);
attachAsr(server); // WebSocket streaming-ASR gateway on the same port
server.listen(PORT, () => console.log(`Lingua server on :${PORT}  ai=${!!ANTHROPIC_KEY || !!OPENAI_KEY} tts=${!!OPENAI_KEY} stt=${!!ELEVEN_KEY} streamingAsr=${streamingAvailable()}`));
