# Deploying Lingua to lingua.family

**Source repo:** [github.com/Lingua-family/lingua-web](https://github.com/Lingua-family/lingua-web)

This guide takes the repo from `git clone` to a live product at **https://lingua.family** with the
API at **https://api.lingua.family**. It covers the two deployable pieces, the static client
(`/`, a Vite PWA) and the Node backend (`server/`), plus DNS, keys, MongoDB, and post-deploy
verification. Everything here matches the code as shipped; env variable names and endpoints are
the ones the code actually reads.

## Architecture at a glance

The client is a fully static build (`dist/`) served from any CDN or static host. The backend is a
single Node process (Express + a WebSocket upgrade handler on the same port) that holds all API
keys, owns the account database, and exposes: `/api/health`, `/api/config`, `/api/auth/*`,
`/api/household` (GET/PUT/DELETE, versioned sync), `/api/ai` (OpenAI proxy), `/api/tts`
(ElevenLabs proxy), `/api/speech/score` (scoring pipeline), and `ws(s)://…/api/asr/stream`
(streaming ASR gateway). Clients authenticate with bearer tokens; browsers never see a provider
key. The client also runs in a device-only mode with a user-supplied OpenAI key, which needs
no backend at all, if that's all you want, do step 3 only and stop.

## 0. Prerequisites

```bash
git clone https://github.com/Lingua-family/lingua-web.git
cd lingua-web
```

Node 20+ locally and on the server host (the backend uses top-level `await` and the global
`fetch`/`FormData`, so Node 18 is the hard floor; 20 or 22 recommended). The **lingua.family**
domain registered and pointed at a DNS provider you control. An **OpenAI API key**
(platform.openai.com), required for all AI features. Optional: an **ElevenLabs API key**
(premium tutor voices + acoustic pronunciation scoring), a **Deepgram API key** (live streaming
transcription in conversations), and a **MongoDB database** (production persistence; without it
the server uses an atomic JSON file, which is fine for a family and wrong for a business).

## 1. Deploy the backend to api.lingua.family

The server is plain Node with no build step. It runs anywhere Node runs; pick one:

**Railway / Render (easiest).** Create a service from
[github.com/Lingua-family/lingua-web](https://github.com/Lingua-family/lingua-web), set the root directory to
`server`, start command `npm start`. Add the environment variables from the table below in the
dashboard. Both platforms give you a health-checkable HTTPS URL immediately; add
`api.lingua.family` as a custom domain and they'll provision the certificate.

**Fly.io.** From `server/`: `fly launch` (accept the Node builder), `fly secrets set` each
variable, then `fly certs add api.lingua.family`.

**A VPS / Raspberry Pi.** Clone the repo, `cd server && npm install --omit=dev`, create `.env`
(next section), and run under a supervisor:

```bash
# systemd unit example: /etc/systemd/system/lingua.service
[Service]
WorkingDirectory=/opt/lingua/server
ExecStart=/usr/bin/node index.js
Restart=always
Environment=NODE_ENV=production
```

Put a reverse proxy in front for TLS. **The proxy must pass WebSocket upgrades** or streaming ASR
silently breaks, for Caddy this is automatic (`api.lingua.family { reverse_proxy localhost:8787 }`);
for nginx you need the `Upgrade`/`Connection` headers on the location block.

### Environment variables

Copy `server/.env.example` to `server/.env` (or set these in your platform's dashboard):

```bash
PORT=8787
OPENAI_API_KEY=sk-...                   # required, lessons, talk, stories, digests
ELEVENLABS_API_KEY=...                  # optional, premium voices + acoustic STT scoring
DEEPGRAM_API_KEY=...                    # optional, live streaming transcription (nova-2)
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/lingua   # optional, MongoDB instead of JSON file
CLIENT_ORIGIN=https://lingua.family     # CORS allow-list; comma-separate extra origins
JWT_SECRET=<64 random hex chars>        # openssl rand -hex 32; auto-generated if empty
```

Notes that matter: `CLIENT_ORIGIN` must exactly match the deployed client origin (scheme
included) or every browser call fails CORS. Set `JWT_SECRET` explicitly in production, the
auto-generated fallback lands in `server/data/secret`, which disappears on ephemeral filesystems
and would sign everyone out on each deploy. With `MONGODB_URI` set the server logs
`[store] backend: mongo` at boot and creates its own collections (`accounts`, `households`); no migration
step. Without MongoDB, back up `server/data/db.json`, it is the entire database.

### Verify the backend

```bash
curl https://api.lingua.family/api/health
# {"ok":true,"service":"lingua"}
curl https://api.lingua.family/api/config
# {"ai":true,"tts":true,"stt":true,"streamingAsr":true}  ← booleans reflect your keys
npm test   # from server/: 9 tests, scoring pipeline, rate limiter
```

If `ai` is `false`, the OpenAI key isn't reaching the process, check the dashboard scoping
(some platforms separate build-time and runtime variables).

## 2. Deploy the client to lingua.family

**Production setup:** [Lingua-family/lingua-web](https://github.com/Lingua-family/lingua-web) on GitHub →
**BOS** Vercel team, project **lingua-web**. Custom domains **lingua.family** and **www.lingua.family**
are already attached (apex redirects to `www`); pushes to `master` auto-deploy to
[https://www.lingua.family](https://www.lingua.family).

```bash
npm install
npm run build        # → dist/ (~93 KB gzipped)
```

For a manual deploy from this checkout: `vercel link --scope bos-studio --project lingua-web`, then
`vercel --prod`. Framework preset **Vite**, build `npm run build`, output `dist`, root `/` (not
`server/`). Netlify / Cloudflare Pages work too if you prefer — same build commands.
HTTPS is not optional: the microphone, the PWA install prompt, and the service worker all require
a secure origin.

If you also registered **familylingua.com**, set a registrar-level 301 redirect to
`https://lingua.family` rather than serving the app from two origins (two origins means two
service-worker scopes and split logins).

## 3. Connect them (or go device-only)

Open https://lingua.family. The first-run screen offers two modes. For the full product, choose
**"Connect to your family's server"** and enter `https://api.lingua.family`, the app health-checks
it, stores the address, and from then on every device that signs in gets synced households,
server-held keys, "Say it, get scored" pronunciation practice, and (with Deepgram) live
streaming transcription in Talk. For a single-device setup with no backend, choose **"This device
only"** and paste an OpenAI API key; everything except the server features works identically.

## 4. Post-deploy smoke test

Five minutes, in order: create an account and a member on a laptop; sign in on a phone with the
same account and confirm the member appears (sync pull); finish a lesson on the phone and watch
XP appear on the laptop within ~25 seconds or on window focus (sync push); open Talk, grant the
mic, and hold a two-turn conversation (TTS + STT + AI proxy); on a lesson vocab card run "Say it, get scored" (scoring pipeline; the result says *acoustic scoring* if ElevenLabs STT is active);
mis-enter a password eleven times and confirm a 429 (rate limiting); and finally install the PWA
(browser menu → *Install app* / *Add to Home Screen*) and check the orb icon launches standalone.

## 5. Operations

**Backups.** MongoDB: your provider's automated backups cover it. JSON store: cron-copy
`server/data/db.json` somewhere off-box; writes are atomic (`tmp` + rename) so copies are always
consistent.

**Upgrades.** Client: rebuild and redeploy; the service worker cache name (`lingua-v2` in
`public/sw.js`) should be bumped whenever you ship, so installed clients fetch the new shell.
Server: redeploy freely, tokens keep working across restarts as long as `JWT_SECRET` is stable,
and sync versioning means in-flight clients reconcile with a 409/refresh, not data loss.

**Scaling honesty.** Rate limits are in-process memory, so they're per-instance, behind a load
balancer with N replicas the effective limits multiply by N until you move the buckets to Redis.
The JSON store is single-instance only; use MongoDB before running two replicas. The ASR gateway
holds one upstream Deepgram socket per active speaker, a Pi handles a family, a small VM handles
a school.

**Costs to expect.** OpenAI usage scales with lessons/conversations generated (each turn is a
small gpt-4o call, capped at 1,600 output tokens server-side). ElevenLabs bills per character
spoken by tutors; the server truncates TTS requests at 900 characters. Deepgram bills per audio
minute streamed, with a 15-second cap per utterance and a 30-second hard session cap in the
gateway.

## 6. Troubleshooting

*Browser console shows CORS errors*, `CLIENT_ORIGIN` doesn't match the site origin exactly.
*Everyone got signed out after a deploy*, `JWT_SECRET` changed or was never pinned. *Mic prompt
never appears*, the site isn't HTTPS, or the browser previously stored a Block (the in-app
denied sheet walks users through the address-bar fix). *Streaming badge never says "live server
transcription"*, `/api/config` shows `"streamingAsr":false` (no Deepgram key), or your reverse
proxy is dropping WebSocket upgrades. *Premium voice silently falls back to the browser voice*, the ElevenLabs key is invalid or out of quota; the client is designed to degrade audibly rather
than fail. *A 429 during normal family use*, you're behind a shared NAT hitting the per-IP auth
limit; raise `max` for the `auth` limiter in `server/index.js`.

Ship it, then say something to Mila. 🌿
