/* ── Streaming ASR gateway (blueprint §10, streaming leg) ─────────────────
   WebSocket endpoint: /api/asr/stream?token=…&lang=es|en
   Client streams binary audio chunks (webm/opus); the gateway relays to a
   provider and emits {type:"interim"|"final"|"error"} JSON frames back.
   Providers:
   - deepgram: real streaming ASR (DEEPGRAM_API_KEY), nova-2, interim results
   - mock:     keyless harness for tests/dev (ASR_PROVIDER=mock) */
import { WebSocketServer, WebSocket } from "ws";
import { verifyToken } from "../auth.js";
import { makeLimiter } from "../ratelimit.js";

const DG_KEY = process.env.DEEPGRAM_API_KEY || "";
export const streamingAvailable = () => !!DG_KEY || process.env.ASR_PROVIDER === "mock";
const asrLimit = makeLimiter({ windowMs: 60000, max: 20, name: "asr" });

export function attachAsr(server) {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname !== "/api/asr/stream") { socket.destroy(); return; }
    const sub = verifyToken(u.searchParams.get("token"));
    if (!sub) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
    if (!asrLimit.check(sub).ok) { socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n"); socket.destroy(); return; }
    if (!streamingAvailable()) { socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n"); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const lang = u.searchParams.get("lang") === "es" ? "es" : "en";
      (DG_KEY ? deepgramSession : mockSession)(ws, lang);
    });
  });
}

const send = (ws, obj) => { try { ws.readyState === 1 && ws.send(JSON.stringify(obj)); } catch {} };

/* Mock provider: exercises the full client↔gateway protocol without a key.
   Emits one interim after first audio, and a final on {"type":"stop"}. */
function mockSession(ws, lang) {
  let chunks = 0;
  const finalText = process.env.MOCK_TRANSCRIPT || (lang === "es" ? "hola amigo" : "hello there");
  const idle = setTimeout(() => { send(ws, { type: "final", text: finalText, confidence: 0.9, provider: "mock" }); ws.close(); }, 8000);
  ws.on("message", (data, isBinary) => {
    if (isBinary) { if (++chunks === 1) send(ws, { type: "interim", text: "…", provider: "mock" }); return; }
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.type === "stop") {
      clearTimeout(idle);
      send(ws, { type: "final", text: finalText, confidence: 0.92, provider: "mock" });
      ws.close();
    }
  });
  ws.on("close", () => clearTimeout(idle));
}

/* Deepgram provider: relay binary upstream, translate results downstream. */
function deepgramSession(ws, lang) {
  const url = `wss://api.deepgram.com/v1/listen?model=nova-2&language=${lang}&interim_results=true&smart_format=true&punctuate=true`;
  const dg = new WebSocket(url, { headers: { Authorization: `Token ${DG_KEY}` } });
  const pending = [];
  let done = false;
  const finish = () => { if (!done) { done = true; try { dg.close(); } catch {} try { ws.close(); } catch {} } };

  dg.on("open", () => { for (const c of pending) dg.send(c); pending.length = 0; });
  dg.on("message", (raw) => {
    let j; try { j = JSON.parse(raw); } catch { return; }
    const alt = j.channel?.alternatives?.[0];
    if (!alt || !alt.transcript) return;
    if (j.is_final || j.speech_final) {
      send(ws, { type: "final", text: alt.transcript, confidence: alt.confidence ?? null, provider: "deepgram" });
      finish();
    } else send(ws, { type: "interim", text: alt.transcript, provider: "deepgram" });
  });
  dg.on("error", () => { send(ws, { type: "error", message: "ASR provider error" }); finish(); });
  dg.on("close", finish);

  ws.on("message", (data, isBinary) => {
    if (isBinary) { dg.readyState === 1 ? dg.send(data) : pending.push(data); return; }
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.type === "stop" && dg.readyState === 1) dg.send(JSON.stringify({ type: "CloseStream" }));
  });
  ws.on("close", finish);

  setTimeout(finish, 30000); // hard session cap
}
