// Vercel serverless function: Anthropic/OpenAI dual-provider proxy. Replaces
// supabase/functions/ai — same contract (POST {messages, maxTokens} ->
// {content:[{type:"text",text}]}), but reads keys from Vercel's env instead
// of Supabase secrets. Provider is env-selected (AI_PROVIDER, or whichever
// key is configured — Anthropic preferred when both are set), matching
// server/ai.js's self-hosted-backend behavior.
import { requireSupabaseUser } from "./_auth.js";
import { complete } from "./_ai.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await requireSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });

  const { messages, maxTokens } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: "messages required" });
  }

  try {
    const data = await complete({ messages, maxTokens });
    return res.status(200).json(data);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || "Server error" });
  }
}
