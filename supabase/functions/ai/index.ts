// Supabase Edge Function: OpenAI proxy. Mirrors server/index.js `/api/ai`.
// Deploy with `supabase functions deploy ai` (verify_jwt stays on — Supabase
// checks the caller's auth token before this code runs, so req is already
// an authenticated user; see supabase/config.toml).
import { createClient } from "jsr:@supabase/supabase-js@2";

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Not signed in" }), { status: 401, headers: corsHeaders });
    }
    if (!OPENAI_KEY) {
      return new Response(JSON.stringify({ error: "Server has no OPENAI_API_KEY configured" }), { status: 503, headers: corsHeaders });
    }

    const { messages, maxTokens } = await req.json().catch(() => ({}));
    if (!Array.isArray(messages) || !messages.length) {
      return new Response(JSON.stringify({ error: "messages required" }), { status: 400, headers: corsHeaders });
    }

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: Math.min(Number(maxTokens) || 1000, 1600),
        // hardening: cap history depth and per-message size so one client can't ship megabyte prompts
        messages: messages.slice(-60).map((m: any) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.content ?? "").slice(0, 8000),
        })),
      }),
    });
    if (!upstream.ok) {
      const errBody = await upstream.text();
      return new Response(errBody, { status: upstream.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await upstream.json();
    const text = data.choices?.[0]?.message?.content || "";
    return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Server error" }), { status: 500, headers: corsHeaders });
  }
});
