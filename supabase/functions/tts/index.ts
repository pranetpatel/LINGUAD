// Supabase Edge Function: OpenAI TTS proxy. Mirrors api/tts.js. Replaces the
// old ElevenLabs-based proxy — same contract (POST {text, gender, lang} ->
// audio/mpeg), but uses OPENAI_API_KEY (already required for chat) instead
// of a separate ELEVENLABS_API_KEY. gpt-4o-mini-tts supports steerable
// `instructions`, which we use to push toward native pronunciation per
// target language (e.g. the Spanish "J" issue reported by testers).
import { createClient } from "jsr:@supabase/supabase-js@2";

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

// Matched to the same 4 persona slots the app already uses (f/m/kid_f/kid_m).
const OPENAI_VOICE: Record<string, string> = {
  f: "nova",
  m: "onyx",
  kid_f: "shimmer",
  kid_m: "fable",
};

const ACCENT_INSTRUCTIONS: Record<string, string> = {
  es: "Speak in natural, native Spanish (neutral Latin American accent). Use authentic Spanish pronunciation — for example, pronounce the letter J as the Spanish H sound, not an English J. Warm, clear, conversational pace, like a friendly tutor.",
  en: "Speak naturally in English, warm and conversational pace, like a friendly tutor.",
};

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

    const { text, gender, lang } = await req.json().catch(() => ({}));
    if (!text) {
      return new Response(JSON.stringify({ error: "text required" }), { status: 400, headers: corsHeaders });
    }

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
      return new Response(JSON.stringify({ error: errBody || "TTS upstream error" }), { status: upstream.status, headers: corsHeaders });
    }
    return new Response(await upstream.arrayBuffer(), { headers: { ...corsHeaders, "Content-Type": "audio/mpeg" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Server error" }), { status: 500, headers: corsHeaders });
  }
});
