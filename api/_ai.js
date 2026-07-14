// Shared AI provider layer for Vercel serverless functions: Anthropic and
// OpenAI behind one contract. Mirrors server/ai.js so the self-hosted
// backend and the Vercel functions stay behaviorally identical.
// Input: {messages:[{role,content}], maxTokens}. Output: normalized
// Anthropic-style {content:[{type:"text",text}]} so clients parse one shape.
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
export const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/** Which provider serves /api/ai. AI_PROVIDER env wins if its key exists;
    otherwise whichever key is configured; anthropic preferred when both. */
export function pickProvider({ anthropicKey = ANTHROPIC_KEY, openaiKey = OPENAI_KEY, pref = process.env.AI_PROVIDER } = {}) {
  if (pref === "openai" && openaiKey) return "openai";
  if (pref === "anthropic" && anthropicKey) return "anthropic";
  if (anthropicKey) return "anthropic";
  if (openaiKey) return "openai";
  return null;
}

export function sanitizeMessages(messages) {
  return messages.slice(-60).map(m => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content ?? "").slice(0, 8000),
  }));
}

/** Normalize an OpenAI chat.completions response to Anthropic content blocks. */
export function normalizeOpenAI(data) {
  const text = data?.choices?.[0]?.message?.content || "";
  return { content: [{ type: "text", text }], model: data?.model, provider: "openai" };
}

export async function complete({ messages, maxTokens }) {
  const provider = pickProvider();
  if (!provider) {
    const err = new Error("Server has no ANTHROPIC_API_KEY or OPENAI_API_KEY configured");
    err.status = 503;
    throw err;
  }
  const msgs = sanitizeMessages(messages);
  const cap = Math.min(Number(maxTokens) || 1000, 1600);

  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: OPENAI_MODEL, max_tokens: cap, messages: msgs }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body?.error?.message || `OpenAI upstream ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return normalizeOpenAI(body);
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: cap, messages: msgs }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error?.message || `Anthropic upstream ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return { ...body, provider: "anthropic" };
}
