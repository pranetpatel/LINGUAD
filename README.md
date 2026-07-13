# Lingua — your family's AI language tutor

**Repo:** [github.com/Lingua-family/lingua-web](https://github.com/Lingua-family/lingua-web) ·
**Home:** [lingua.family](https://lingua.family) (client) · suggested API host: `api.lingua.family`

A voice-first, installable web app (PWA): real spoken conversations with named AI tutors,
lessons generated live around each learner, story time for kids, a listening lab, spaced-repetition
review, self-updating skill assessments, family accounts with parent PIN controls, and a full
teacher/classroom mode with assignments.

Built with React + Vite. AI powered by GPT (OpenAI API). Optional premium voice via
ElevenLabs and optional in-browser open-source HD voice (Kokoro-82M).

## Architecture

Three separate pieces, each with one job:

- **Vercel** hosts the static frontend only — the compiled HTML/CSS/JS from `npm run build`
  (the React UI). It has no backend logic, no database connection, and holds no secrets.
- **The Express server** (`server/`) is the backend. It's the only thing that talks to
  MongoDB, and the only thing holding API keys (OpenAI, ElevenLabs). It handles
  signup/login, proxies AI/TTS requests so keys never reach the browser, and runs the
  WebSocket speech-streaming connection. It needs a host that supports long-running Node
  processes and WebSockets (e.g. Railway, Fly.io) — not Vercel.
- **MongoDB** is just the data store. It doesn't run any code; it only stores what the
  server writes to it — accounts (email, hashed password, name) and household/progress
  data. The frontend never queries Mongo directly.

**Request flow:** browser → Vercel (serves the page) → the page's JS calls the Express
server directly → server reads/writes MongoDB and calls OpenAI/ElevenLabs. Vercel and
MongoDB never talk to each other; the server is the middleman for everything.

In local dev, `vite.config.js` proxies `/api/*` from the Vite dev server to the backend
on `:8787` so this same flow works without CORS friction. In production, the frontend
needs `VITE_SERVER_URL` set at build time to the backend's real URL (see `.env.example`),
since Vercel and the backend are deployed independently and don't share an origin.

## Quick start

```bash
git clone https://github.com/Lingua-family/lingua-web.git
cd lingua-web
npm install
npm run dev
```

Open the printed URL. On first launch, paste an **OpenAI API key**
(create one at https://platform.openai.com → API keys). The key is stored only in your
browser's localStorage and requests go directly from your browser to OpenAI — usage bills
to your key.

## Build & deploy

```bash
npm run build      # outputs static site to dist/
npm run preview    # test the production build locally
```

Deploy `dist/` to any static host, then point **lingua.family** at it (add the custom
domain in your host's dashboard; DNS: apex A/ALIAS or CNAME per their docs):
- **Vercel (production):** BOS team → project **lingua-web**, wired to
  [Lingua-family/lingua-web](https://github.com/Lingua-family/lingua-web); live at
  [www.lingua.family](https://www.lingua.family) (`lingua.family` redirects to `www`)
- **Netlify**: build `npm run build`, publish `dist`
- **GitHub Pages / Cloudflare Pages**: serve `dist`

Run the backend at **api.lingua.family** (any Node host) with
`CLIENT_ORIGIN=https://lingua.family` in its `.env`; users enter
`https://api.lingua.family` on the app's connect screen. Also registering
`familylingua.com`? Redirect it to lingua.family at your registrar.

HTTPS is required in production for the microphone and for PWA install.

## Install as an app

Visit your deployed URL, then:
- **iPhone/iPad (Safari):** Share → *Add to Home Screen*
- **Android (Chrome):** menu ⋮ → *Install app*
- **Desktop (Chrome/Edge):** install icon in the address bar

It launches full-screen with the Lingua icon; reviews, decks, and progress work offline.

## Voice notes

- **Speech input** (talking to the tutor) uses the Web Speech API — best in **Chrome/Edge**.
  Safari/Firefox fall back to typing while the tutor still speaks aloud.
- **Speech output** ladder, best-available first:
  1. **ElevenLabs premium** (optional): paste your ElevenLabs API key in any adult profile →
     Tutor & Voice → Premium voice. Uses `eleven_multilingual_v2` — human-quality, native
     Spanish + English. Billed to your ElevenLabs account.
  2. **Kokoro-82M HD** (optional, open source, English): toggle in Tutor & Voice; downloads
     an ~80 MB model once and synthesizes locally in your browser.
  3. **Enhanced browser voices** (default): expressive prosody engine with per-segment
     language detection, so Spanish text always gets a Spanish voice. Microsoft Edge's
     "Natural" voices sound best on this tier.


## Server mode — multi-device sync, server-held keys, speech scoring

The `server/` folder is a self-hostable backend implementing the blueprint's production layer:

```bash
cd server
cp .env.example .env        # add OPENAI_API_KEY (and optionally ELEVENLABS_API_KEY)
npm install
npm start                   # → http://localhost:8787
npm test                    # speech-pipeline unit tests
```

Then open the client, choose **"Connect to your family's server"**, and enter the address.
What server mode gives you:

- **Multi-device sync** — real accounts (scrypt-hashed passwords, HMAC bearer tokens) and a
  versioned household document. Every change pushes with its base version; the server accepts
  or returns `409` with the newer copy, and clients pull on focus + every 25 s. Sign in on a
  phone and a laptop and watch a lesson finished on one appear on the other.
- **Server-held keys** — the OpenAI and ElevenLabs keys live only in the server's `.env`.
  Clients call `/api/ai` and `/api/tts` proxies with their bearer token; no key ever reaches
  a browser, per the blueprint's security model.
- **The speech-scoring pipeline** (`/api/speech/score`) — normalize → similarity-weighted word
  alignment → grapheme-to-phoneme (rule-based Spanish, heuristic English) → per-word scores
  blending edit similarity with ASR word confidence → phoneme-level diffs → targeted advice.
  With `ELEVENLABS_API_KEY` set, uploaded audio is transcribed acoustically (scribe_v1, word-level
  confidence); otherwise the browser transcript feeds the same pipeline. In the app it powers
  the **"🎯 Say it — get scored"** buttons on lesson vocabulary and debrief corrections, with
  word-by-word color chips and phoneme tips, feeding the speaking-skill assessment.
- **MongoDB behind the store seam** — set `MONGODB_URI` and the server uses MongoDB
  (`accounts` + `households` collections, optimistic concurrency via a version check on
  update). Unset, it falls back to the atomic JSON file. Both implementations share one
  async interface (`server/stores/`).
- **Streaming ASR gateway** — `ws(s)://…/api/asr/stream?token=…&lang=es|en`. The client
  streams MediaRecorder audio chunks; the gateway relays to a provider and returns
  `interim`/`final` JSON frames. With `DEEPGRAM_API_KEY` set, live transcription runs on
  Deepgram nova-2 and the Talk conversation shows " · live server transcription"; with
  `ASR_PROVIDER=mock` the full protocol runs keylessly for dev/tests. Finals carry
  confidence straight into the scoring pipeline and the speaking assessment.
- **Rate limiting** — fixed-window token buckets on every endpoint: 10/min per IP on auth,
  30/min per account on `/api/ai` and `/api/speech/score`, 60/min on `/api/tts`, 120/min on
  sync, 20/min on ASR sessions. 429 responses carry `Retry-After` and
  `X-RateLimit-*` headers; unauthorized or rate-limited WebSocket upgrades are refused at
  the socket.
- Deploy the server on any Node host (Railway, Fly.io, a Raspberry Pi) behind HTTPS and set
  `CLIENT_ORIGIN`.

## Security & scope (honest notes)

Device-only mode keeps everything local (fine for one device). Server mode implements the
blueprint's backend layer: server-held keys, real auth, sync, and the scoring pipeline.
MongoDB, streaming ASR, and rate limiting are now in. Remaining per the blueprint:
forced-alignment GOP phoneme scoring on the streaming audio (the provider interface is the
slot-in point), Redis-backed rate limits for multi-instance deploys, and per-seat billing.

## Deploying

Full production walkthrough — DNS, both deploy targets, env vars, MongoDB, smoke tests,
and ops — lives in [DEPLOY.md](DEPLOY.md).

## Project layout

```
index.html            app shell, PWA meta
public/manifest.webmanifest, sw.js, icon-*.png
src/main.jsx          entry + service-worker registration
src/App.jsx           the entire Lingua application
```
