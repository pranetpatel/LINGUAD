# Running Lingua on Supabase (free tier)

This is the alternative to `server/` + MongoDB described in the architecture memo:
Supabase Auth + Postgres replace the account/household backend, Vercel serverless
functions (`api/ai.js`, `api/tts.js`) proxy OpenAI/ElevenLabs so keys stay off the
client, and speech-to-text runs in the browser (Web Speech API) instead of a
server-side ASR gateway. `server/` is untouched — this is a parallel mode,
switched with one env var.

## 1. Create the Supabase project (2 minutes)

1. Go to [supabase.com](https://supabase.com) → **New project**.
2. Pick an org, name it `lingua`, set a database password (save it), pick a region.
3. Wait ~2 minutes for provisioning.
4. In **Project Settings → API**, copy the **Project URL** and the **anon public** key.

## 2. Apply the schema

In the Supabase dashboard: **SQL Editor → New query**, paste the contents of
[`supabase/migrations/0001_households.sql`](supabase/migrations/0001_households.sql), and run it.
This creates the `households` table with row-level security so each user can only
ever read/write their own row.

(If you have the Supabase CLI installed: `supabase link` then `supabase db push` does the same thing.)

## 3. Turn off email confirmation (for today's demo)

**Authentication → Providers → Email** → turn off "Confirm email". Otherwise every
signup needs a click-through email before the account can sign in — fine for
production, annoying mid-demo. Turn it back on before real users show up.

## 4. Configure the AI/TTS proxy (Vercel functions)

`api/ai.js` and `api/tts.js` hold the OpenAI/ElevenLabs keys server-side, same as
`server/index.js`'s `/api/ai` and `/api/tts` today — they just run as Vercel
serverless functions instead of Supabase Edge Functions, so the keys live next to
the rest of the app's Vercel env config.

In the Vercel project → **Settings → Environment Variables**, add:

```
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=...       # optional, premium voices
```

No Supabase CLI or `supabase secrets` needed — these are plain Vercel env vars,
never sent to the browser (only `api/*.js`, which runs server-side, reads them).

## 5. Point the app at it

In the repo root, create `.env`:

```bash
VITE_APP_MODE=supabase
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Then:

```bash
npm install
npm run dev
```

Open the app, sign up with a real-looking email (confirmation is off) and a
password — you're now running fully on the free tier: Supabase Auth for login,
Postgres for household data, Edge Functions for AI/TTS, and the browser's own
speech recognition for Talk mode (best in Chrome/Edge).

## What's different from `server/` mode

- **No streaming ASR gateway.** `server/asr/stream.js` (WebSocket, Deepgram) has
  no Supabase equivalent in this pass — Talk mode automatically falls back to the
  browser's built-in `SpeechRecognition`, which is what the memo's "browser-side
  STT" line means. Voice quality is close; latency is slightly higher.
- **Pronunciation scoring runs client-side.** `server/speech/score.js` is a pure
  function with no I/O, so it's copied to `src/speechScore.js` and scores off the
  browser's own transcript directly — no ElevenLabs acoustic STT round-trip. The
  "Say it, get scored" feature still works, just without the acoustic-confidence
  boost.
- **Deploying the client is unchanged** — still a static Vite build to Vercel/any
  CDN. Only the backend moved.

## Rolling back

Delete/comment `VITE_APP_MODE` (or set it to `server`) and the app goes back to
talking to `server/` exactly as before. Nothing about this migration touches that
code path.
