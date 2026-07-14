# Running Lingua on Supabase (free tier)

This is the alternative to `server/` + MongoDB described in the architecture memo:
Supabase Auth + Postgres replace the account/household backend, Vercel serverless
functions (`api/ai.js`, `api/tts.js`) proxy OpenAI (chat and premium TTS, via
gpt-4o-mini-tts) so keys stay off the client, and speech-to-text runs in the
browser (Web Speech API) instead of a server-side ASR gateway. `server/` is
untouched — this is a parallel mode, switched with one env var.

## 1. Create the Supabase project (2 minutes)

1. Go to [supabase.com](https://supabase.com) → **New project**.
2. Pick an org, name it `lingua`, set a database password (save it), pick a region.
3. Wait ~2 minutes for provisioning.
4. In **Project Settings → API**, copy the **Project URL** and the **anon public** key.

## 2. Apply the schema

In the Supabase dashboard: **SQL Editor → New query**, run these three migrations
in order:

1. [`0001_households.sql`](supabase/migrations/0001_households.sql) — creates the
   `households` table with row-level security so each user can only ever read/write
   their own row.
2. [`0002_household_on_signup.sql`](supabase/migrations/0002_household_on_signup.sql) —
   auto-creates the household row when the auth user is created.
3. [`0003_household_membership.sql`](supabase/migrations/0003_household_membership.sql) —
   adds `household_members`/`household_invites` and rewrites RLS so multiple auth
   users (an owner + invited family members) can share one household. Required for
   the email-invite feature in step 6; safe to apply even if you don't use invites.

(If you have the Supabase CLI installed: `supabase link` then `supabase db push` does the same thing.)

## 3. Auth settings

**For demos / internal testing:** **Authentication → Providers → Email** → turn off
"Confirm email". Otherwise signup needs a click-through email before sign-in.

**For production with email confirmation on:** run the second migration
[`0002_household_on_signup.sql`](supabase/migrations/0002_household_on_signup.sql)
as well — it auto-creates the household row when the auth user is created, so
signup doesn't hit an RLS error while waiting for email confirmation.

## 4. Configure the AI/TTS proxy (Vercel functions)

`api/ai.js` and `api/tts.js` hold the OpenAI key server-side, same as
`server/index.js`'s `/api/ai` and `/api/tts` today — they just run as Vercel
serverless functions instead of Supabase Edge Functions, so the key lives next to
the rest of the app's Vercel env config. `api/tts.js` uses OpenAI's
`gpt-4o-mini-tts` for premium voices — the same `OPENAI_API_KEY` already
required for chat, no separate TTS key needed.

In the Vercel project → **Settings → Environment Variables**, add:

```
OPENAI_API_KEY=sk-...
```

No Supabase CLI or `supabase secrets` needed — this is a plain Vercel env var,
never sent to the browser (only `api/*.js`, which runs server-side, reads it).

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

## 6. Inviting family members (optional)

Adults/teens can be invited by email instead of being added as a local profile —
they get their own login, linked to the same household. This needs one more
server-only secret, since sending an invite requires Supabase's admin API:

1. **Project Settings → API → service_role** (marked secret) — copy it.
2. In the Vercel project → **Settings → Environment Variables**, add:

   ```
   SUPABASE_SERVICE_ROLE_KEY=eyJ...     # server-only — never prefix with VITE_, never put in local .env
   SITE_URL=https://your-deployed-domain.com
   ```

   `SUPABASE_SERVICE_ROLE_KEY` has full admin access to the database and bypasses
   RLS — it must only ever live in Vercel's env config (used by `api/invite.js`,
   which never returns it to the browser), the same trust boundary as
   `OPENAI_API_KEY` today.
3. **Authentication → URL Configuration → Redirect URLs** — add
   `https://your-deployed-domain.com/app/invite` to the allowlist, so Supabase's
   invite email is allowed to redirect back into the app.
4. Redeploy. From **Family → Add a family member → Another adult**, the invite
   form sends a real email via Supabase's built-in mailer.

Supabase's default mailer is rate-limited and meant for development/demos — for
real invite volume, configure a custom SMTP provider under **Authentication →
Emails** in the dashboard (not an app code change).

### Configuring the contact email

The contact email used in invite templates and throughout the app is configurable
via the `CONTACT_EMAIL` environment variable (defaults to `hello@lingua.family`).
Set this in Vercel's environment variables if you want invite emails to reference
a different contact address:

```
CONTACT_EMAIL=your-email@your-domain.com
```

Note: This only affects where support/reply emails go — the "from" address of
the invite email itself is controlled by Supabase's **Authentication → Emails**
settings in the dashboard.

## Rolling back

Delete/comment `VITE_APP_MODE` (or set it to `server`) and the app goes back to
talking to `server/` exactly as before. Nothing about this migration touches that
code path.
