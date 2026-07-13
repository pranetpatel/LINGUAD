// Supabase Edge Function: ElevenLabs TTS proxy. Mirrors server/index.js `/api/tts`.
import { createClient } from "jsr:@supabase/supabase-js@2";

const ELEVEN_KEY = Deno.env.get("ELEVENLABS_API_KEY") ?? "";
const ELEVEN_VOICE: Record<string, string> = {
  f: "21m00Tcm4TlvDq8ikWAM" /* Rachel */,
  m: "pNInz6obpgDQGcFmaJgB" /* Adam */,
  kid_f: "MF3mGyEYCl7XYWbV9V6O" /* Elli */,
  kid_m: "TxGEqnHWrfWFTfGW9XjX" /* Josh */,
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
    if (!ELEVEN_KEY) {
      return new Response(JSON.stringify({ error: "Server has no ELEVENLABS_API_KEY configured" }), { status: 503, headers: corsHeaders });
    }

    const { text, gender } = await req.json().catch(() => ({}));
    if (!text) {
      return new Response(JSON.stringify({ error: "text required" }), { status: 400, headers: corsHeaders });
    }

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
      return new Response(JSON.stringify({ error: "TTS upstream error" }), { status: upstream.status, headers: corsHeaders });
    }
    return new Response(await upstream.arrayBuffer(), { headers: { ...corsHeaders, "Content-Type": "audio/mpeg" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Server error" }), { status: 500, headers: corsHeaders });
  }
});
