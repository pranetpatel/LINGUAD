// Vercel serverless function: OpenAI proxy. Replaces supabase/functions/ai —
// same contract (POST {messages, maxTokens} -> {content:[{type:"text",text}]}),
// but reads OPENAI_API_KEY from Vercel's env instead of Supabase secrets.
import { requireSupabaseUser } from "./_auth.js";

const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await requireSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });
  if (!OPENAI_KEY) return res.status(503).json({ error: "Server has no OPENAI_API_KEY configured" });

  const { messages, maxTokens } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: "messages required" });
  }

  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o",
      max_tokens: Math.min(Number(maxTokens) || 1000, 1600),
      // hardening: cap history depth and per-message size so one client can't ship megabyte prompts
      messages: messages.slice(-60).map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? "").slice(0, 8000),
      })),
    }),
  });
  if (!upstream.ok) {
    const errBody = await upstream.text();
    return res.status(upstream.status).setHeader("Content-Type", "application/json").send(errBody);
  }
  const data = await upstream.json();
  const text = data.choices?.[0]?.message?.content || "";
  return res.status(200).json({ content: [{ type: "text", text }] });
}
