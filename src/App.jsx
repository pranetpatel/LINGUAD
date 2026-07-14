import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Sparkles, Mic, MicOff, BookOpen, Languages, User, Flame, Star, ChevronRight,
  Volume2, VolumeX, Check, X, ArrowRight, RefreshCw, Send, GraduationCap, Plus,
  MessageCircle, Layers, Trash2, CornerDownRight, Loader, Users, Keyboard,
  Settings, LogOut, Eye, EyeOff, TrendingUp, TrendingDown, Minus, Wand2, Home,
  Headphones, Play, RotateCcw, ClipboardList, ArrowUpRight, SlidersHorizontal
} from "lucide-react";
import {
  supabase, supabaseConfigured, supaSignup, supaLogin, supaLogout,
  supaGetHousehold, supaPutHousehold, supaResetHousehold, supaAskAI, supaTts,
  supaJoinHousehold, supaInviteMember, supaAcceptPendingInvite, supaListInvites, supaRevokeInvite, supaSetMemberRole,
} from "./supabase.js";
import { scoreUtterance } from "./speechScore.js";

/* Standalone-app shims ——————————————————————————————————————— */
// Persistent storage: use the host's window.storage when present (Claude
// artifacts); otherwise back it with localStorage so the app runs anywhere.
if (typeof window !== "undefined" && !window.storage) {
  window.storage = {
    async get(key) {
      const v = localStorage.getItem("lingua:" + key);
      if (v === null) throw new Error("not found");
      return { key, value: v };
    },
    async set(key, value) { localStorage.setItem("lingua:" + key, value); return { key, value }; },
    async delete(key) { localStorage.removeItem("lingua:" + key); return { key, deleted: true }; },
  };
}
// Device-only mode supports either Claude (Anthropic) or GPT (OpenAI) as the
// model provider; the key + provider choice are paired so switching providers
// doesn't accidentally send one provider's key to the other's endpoint.
const AI_PROVIDER = () => { try { return localStorage.getItem("lingua-ai-provider") || "anthropic"; } catch { return "anthropic"; } };
const getApiKey = () => {
  try {
    return AI_PROVIDER() === "openai"
      ? (localStorage.getItem("lingua-openai-key") || "")
      : (localStorage.getItem("lingua-anthropic-key") || "");
  } catch { return ""; }
};
// Premium TTS always calls OpenAI directly, regardless of which provider is
// chosen for chat — so it needs the OpenAI key specifically, not getApiKey()
// (which returns an Anthropic key when that's the chosen chat provider, and
// would otherwise get sent as a Bearer token to OpenAI's TTS endpoint and
// 401 silently).
const getOpenAiTtsKey = () => {
  try { return localStorage.getItem("lingua-openai-key") || ""; } catch { return ""; }
};
const hasAiAccess = () => { try { return !!(getApiKey() || localStorage.getItem("lingua-skip-key")); } catch { return true; } };

// ── Lingua server mode: multi-device sync + server-held keys ──
// The backend (server/) deploys separately from the static frontend, so its
// URL comes from a build-time env var. localStorage can still override it
// for local testing against a different backend.
const SRV_URL = () => {
  try {
    const stored = (localStorage.getItem("lingua-server-url") || "").replace(/\/+$/, "");
    if (stored) return stored;
  } catch {}
  if (import.meta.env.VITE_SERVER_URL) return import.meta.env.VITE_SERVER_URL.replace(/\/+$/, "");
  return typeof window !== "undefined" ? window.location.origin : "";
};
const SRV_TOKEN = () => { try { return localStorage.getItem("lingua-token") || ""; } catch { return ""; } };
// Mode defaults to the build's VITE_APP_MODE (see .env.example); a device
// can still override it from localStorage for local testing, or opt into
// device-only / local-server mode via ModeGate below.
const APP_MODE = () => { try { return localStorage.getItem("lingua-mode") || import.meta.env.VITE_APP_MODE || "server"; } catch { return import.meta.env.VITE_APP_MODE || "server"; } };
const isSupabase = () => APP_MODE() === "supabase" && supabaseConfigured;
const isServer = () => (APP_MODE() === "server" && !!SRV_URL()) || isSupabase();
let serverCaps = { ai: false, tts: false, stt: false, streamingAsr: false };

/* Same {status, version, data, token, error} shape as the Express backend,
   whichever remote mode (self-hosted server/ or Supabase) is active — so
   every isServer()/srv() call site below stays backend-agnostic. */
async function srv(path, { method = "GET", body } = {}) {
  if (isSupabase()) return srvSupabase(path, method, body);
  const res = await fetch(SRV_URL() + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(SRV_TOKEN() ? { Authorization: "Bearer " + SRV_TOKEN() } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 409) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return { status: res.status, ...data };
}
async function srvSupabase(path, method, body) {
  if (path === "/api/config") {
    // Was hardcoded to {ai:true, tts:true} regardless of whether OPENAI_API_KEY
    // was actually set in Vercel — so the UI never warned when it was missing.
    // Hit the real serverless endpoint instead, same as the self-hosted
    // server's /api/config does. (TTS runs on OpenAI too now, same key as AI.)
    const res = await fetch("/api/config");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { status: res.status, ai: false, tts: false, stt: false, streamingAsr: false };
    return { status: 200, ...data };
  }
  if (path === "/api/auth/signup") return { status: 200, ...(await supaSignup(body)) };
  if (path === "/api/auth/login") return { status: 200, ...(await supaLogin(body)) };
  if (path === "/api/household" && method === "GET") return { status: 200, ...(await supaGetHousehold()) };
  if (path === "/api/household" && method === "PUT") {
    const r = await supaPutHousehold(body.version, body.data);
    return r.ok ? { status: 200, version: r.version } : { status: 409, conflict: true, version: r.version, data: r.data };
  }
  if (path === "/api/household" && method === "DELETE") {
    const { data: { user } } = await supabase.auth.getUser();
    const fresh = { account: { name: "", email: user?.email || "" }, type: "family", members: [] };
    const r = await supaResetHousehold(fresh);
    await supaLogout();
    return { status: 200, ...r };
  }
  throw Object.assign(new Error(`Unsupported Supabase path: ${path}`), { status: 500 });
}

/* ─────────────────────────────────────────────────────────────────────────
   LINGUA v2 — voice-first family AI language tutor
   Households · parent-created child profiles · age-banded tutor personas ·
   self-updating skill assessment · guided spoken onboarding · story mode
────────────────────────────────────────────────────────────────────────── */

const LANGS = {
  en: { name: "English", flag: "🇺🇸", accent: "#0E7C6B", soft: "#E3F1EE", tts: "en-US", sttHints: ["en-US","en-GB"] },
  es: { name: "Spanish", flag: "🇲🇽", accent: "#D95B3F", soft: "#FBEAE4", tts: "es-MX", sttHints: ["es-MX","es-ES"] },
};
const INK = "#152521", MIST = "#F1F5F3", FADE = "#5D6F6A", GOLD = "#D9A441", LINE = "#DCE5E1";
const KID_BG = "#FFF7EA", KID_CARD = "linear-gradient(135deg,#FFE3B3,#FFD1DC)";
const STORE = "lingua-v2";
const DAY = 86400000;

const LEVELS = [
  { id: "A1", label: "Brand new", desc: "Starting from zero" },
  { id: "A2", label: "Basics", desc: "Simple phrases, present tense" },
  { id: "B1", label: "Conversational", desc: "Everyday topics, some errors" },
  { id: "B2", label: "Confident", desc: "Fluent-ish, refining nuance" },
];
const GOALS = ["Travel", "Work & career", "Family & friends", "School", "Moving abroad", "For fun"];
const ADULT_INTERESTS = ["Food & cooking", "Sports", "Music", "Movies & TV", "Tech", "Nature", "Business", "Art", "Fitness"];
const KID_INTERESTS = ["Animals", "Space", "Dinosaurs", "Magic", "Sports", "Music", "Ocean", "Robots", "Fairy tales"];
const KID_AVATARS = ["🦊","🐼","🦄","🐸","🐯","🐙","🦖","🐰"];
const ADULT_AVATARS = ["🙂","😎","🌟","🌿","🎧","☕","📚","🏔️"];

const POPULAR_NATIVE = ["English", "Spanish", "Mandarin Chinese", "Hindi", "Arabic", "French", "Portuguese", "Urdu"];
const ALL_NATIVE = [
  "Afrikaans","Albanian","Amharic","Arabic","Armenian","Azerbaijani","Bengali","Bosnian","Bulgarian","Burmese",
  "Cantonese","Catalan","Cebuano","Croatian","Czech","Danish","Dutch","English","Estonian","Farsi (Persian)",
  "Filipino (Tagalog)","Finnish","French","Georgian","German","Greek","Gujarati","Haitian Creole","Hausa","Hebrew",
  "Hindi","Hungarian","Icelandic","Igbo","Indonesian","Italian","Japanese","Javanese","Kannada","Kazakh",
  "Khmer","Kinyarwanda","Korean","Kurdish","Lao","Latvian","Lithuanian","Macedonian","Malay","Malayalam",
  "Mandarin Chinese","Marathi","Mongolian","Nepali","Norwegian","Oromo","Pashto","Polish","Portuguese","Punjabi",
  "Romanian","Russian","Serbian","Sinhala","Slovak","Slovenian","Somali","Spanish","Swahili","Swedish",
  "Tamil","Telugu","Thai","Turkish","Ukrainian","Urdu","Uzbek","Vietnamese","Yoruba","Zulu",
];

/* Tutor personas by age band. Each carries a prompt style + voice shaping. */
const AGE_BANDS = {
  child: { label: "Child (5–12)", emoji: "🦊" },
  teen:  { label: "Teen (13–17)", emoji: "✨" },
  adult: { label: "Adult", emoji: "🌿" },
};
const PERSONAS = {
  silly:  { band: "child", name: "Pip", emoji: "🦊", gender: "m", label: "Pip · silly & giggly", voice: { pitch: 1.22, rate: 0.97 },
    prompt: "You are Pip, a silly, giggly little boy-fox tutor for a young child. Tiny simple words, playful sound effects (whoosh! yay!), lots of cheering, one idea at a time. Always wholesome, gentle, and safe — nothing scary, sad, or grown-up. Never ask the child for personal information." },
  gentle: { band: "child", name: "Luna", emoji: "🐰", gender: "f", label: "Luna · gentle & kind", voice: { pitch: 1.12, rate: 0.9 },
    prompt: "You are Luna, a soft-spoken, kind girl-bunny tutor for a young child. Slow, warm, encouraging; celebrate every try. Always wholesome, gentle, and safe — nothing scary, sad, or grown-up. Never ask the child for personal information." },
  chill:  { band: "teen", name: "Zoe", emoji: "✨", gender: "f", label: "Zoe · chill", voice: { pitch: 1.02, rate: 0.98 },
    prompt: "You are Zoe, a laid-back young woman tutoring a teenager. Casual, a little funny, zero cringe, never condescending. Keep it school-appropriate at all times." },
  hype:   { band: "teen", name: "Kai", emoji: "⚡", gender: "m", label: "Kai · hype", voice: { pitch: 1.0, rate: 1.04 },
    prompt: "You are Kai, an upbeat young man tutoring a teenager. Quick, encouraging, playful competitive energy. Keep it school-appropriate at all times." },
  warm:   { band: "adult", name: "Mila", emoji: "🌿", gender: "f", label: "Mila · warm & encouraging", voice: { pitch: 1.0, rate: 0.96 },
    prompt: "You are Mila, a warm, encouraging woman and private tutor. Human, specific praise, gentle humor." },
  calm:   { band: "adult", name: "Noah", emoji: "🌊", gender: "m", label: "Noah · calm & patient", voice: { pitch: 0.94, rate: 0.9 },
    prompt: "You are Noah, a calm, unhurried man and private tutor. Soothing, patient, never rushes." },
  coach:  { band: "adult", name: "Leo", emoji: "🔥", gender: "m", label: "Leo · energetic coach", voice: { pitch: 0.98, rate: 1.03 },
    prompt: "You are Leo, a direct, energetic man and language coach. Momentum, clear goals, honest and kind feedback." },
};
const personasFor = band => Object.entries(PERSONAS).filter(([, p]) => p.band === band);
const tutorFor = m => PERSONAS[m?.personality] || PERSONAS.warm;

const SCENARIOS_ADULT = [
  { id: "cafe", emoji: "☕", label: "Ordering at a café" },
  { id: "travel", emoji: "✈️", label: "At the airport" },
  { id: "shop", emoji: "🛍️", label: "Shopping" },
  { id: "interview", emoji: "💼", label: "Job interview" },
  { id: "doctor", emoji: "🩺", label: "Doctor's visit" },
  { id: "friends", emoji: "🎉", label: "Meeting new people" },
  { id: "phone", emoji: "📞", label: "A phone call" },
  { id: "open", emoji: "💬", label: "Just chat" },
];
const SCENARIOS_CHILD = [
  { id: "zoo", emoji: "🦁", label: "A trip to the zoo" },
  { id: "picnic", emoji: "🧺", label: "A picnic party" },
  { id: "space", emoji: "🚀", label: "Space adventure" },
  { id: "pet", emoji: "🐶", label: "My silly pet" },
  { id: "icecream", emoji: "🍦", label: "The ice-cream shop" },
  { id: "open", emoji: "💬", label: "Just chat" },
];

/* ───────────────────────────── voice engine ───────────────────────────── */

function useOnline() {
  const [on, setOn] = useState(typeof navigator === "undefined" ? true : navigator.onLine !== false);
  useEffect(() => {
    const up = () => setOn(true), down = () => setOn(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  return on;
}

function useVoices() {
  const [voices, setVoices] = useState([]);
  useEffect(() => {
    if (!window.speechSynthesis) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);
  return voices;
}
const F_NAMES = /samantha|victoria|karen|moira|tessa|allison|ava|susan|zira|jenny|aria|michelle|joanna|salli|kendra|kimberly|ivy|paulina|mónica|monica|sabina|angelica|lupe|penelope|female|mujer/i;
const M_NAMES = /\balex\b|daniel|fred|tom|aaron|guy|davis|david|mark|nathan|christopher|eric|brian|justin|matthew|joey|diego|juan|jorge|carlos|miguel|male|hombre/i;
function pickVoice(voices, langCode, prefURI, gender) {
  const prefix = langCode === "es" ? "es" : "en";
  const pool = voices.filter(v => (v.lang || "").toLowerCase().startsWith(prefix));
  if (!pool.length) return null;
  if (prefURI) { const hit = pool.find(v => v.voiceURI === prefURI); if (hit) return hit; }
  const score = v => {
    let s = 0;
    const n = v.name || "";
    if (/natural|premium|enhanced|neural/i.test(n)) s += 5;
    if (/online/i.test(n)) s += 2;
    if (v.localService === false) s += 3; // cloud voices are far more human
    if (/google/i.test(n)) s += 2;
    if (/microsoft/i.test(n)) s += 1;
    // prefer American voices: en-US, and Latin American Spanish (es-MX / es-US)
    const l = (v.lang || "").toLowerCase();
    if (prefix === "en" && l === "en-us") s += 3;
    if (prefix === "es" && (l === "es-mx" || l === "es-us")) s += 3;
    if (gender === "f") { if (F_NAMES.test(n)) s += 6; else if (M_NAMES.test(n)) s -= 4; }
    if (gender === "m") { if (M_NAMES.test(n)) s += 6; else if (F_NAMES.test(n)) s -= 4; }
    return s;
  };
  return [...pool].sort((a, b) => score(b) - score(a))[0];
}
const SPEEDS = { slow: 0.78, normal: 1.0, native: 1.12 };

/* ── Phase 2: guided conversation packs (Listening Lab trainer) ──
   Bilingual lines work in both directions: target=es speaks .es (gloss .en),
   target=en speaks .en (gloss .es). k=1 marks echo-worthy key lines; the
   learner role-plays every s:1 line in the final step. */
const GUIDED_CONVOS = [
  { id: "g_cafe", emoji: "☕", band: "adult", level: "A1",
    title: { en: "First coffee", es: "Primer café" },
    scene: { en: "You walk into a café in Mexico City and order.", es: "Entras a un café y pides algo." },
    lines: [
      { s: 0, es: "¡Buenos días! ¿Qué le doy?", en: "Good morning! What can I get you?" },
      { s: 1, es: "Buenos días. Un café con leche, por favor.", en: "Good morning. A coffee with milk, please.", k: 1 },
      { s: 0, es: "¿Grande o pequeño?", en: "Large or small?" },
      { s: 1, es: "Grande, por favor.", en: "Large, please." },
      { s: 0, es: "¿Algo más? Los panes están recién hechos.", en: "Anything else? The pastries are freshly made." },
      { s: 1, es: "Sí, un pan dulce. ¿Cuánto es?", en: "Yes, a sweet roll. How much is it?", k: 1 },
      { s: 0, es: "Son sesenta pesos.", en: "That's sixty pesos." },
      { s: 1, es: "Aquí tiene. ¡Gracias!", en: "Here you go. Thank you!", k: 1 },
    ],
    quiz: [
      { q: { en: "What does the customer order to drink?", es: "¿Qué pide el cliente para tomar?" },
        opts: { en: ["Black coffee", "Coffee with milk", "Tea", "Juice"], es: ["Café negro", "Café con leche", "Té", "Jugo"] }, a: 1 },
      { q: { en: "How much is the total?", es: "¿Cuánto cuesta todo?" },
        opts: { en: ["16 pesos", "60 pesos", "70 pesos", "6 pesos"], es: ["16 pesos", "60 pesos", "70 pesos", "6 pesos"] }, a: 1 },
    ],
    words: [
      { es: "por favor", en: "please", ex: "Un café, por favor." },
      { es: "¿Cuánto es?", en: "How much is it?", ex: "¿Cuánto es todo?" },
      { es: "recién hecho", en: "freshly made", ex: "El pan está recién hecho." },
    ] },
  { id: "g_meet", emoji: "👋", band: "adult", level: "A1",
    title: { en: "Meeting a neighbor", es: "Conociendo a un vecino" },
    scene: { en: "A new neighbor says hello in the elevator.", es: "Un vecino nuevo te saluda en el ascensor." },
    lines: [
      { s: 0, es: "¡Hola! Creo que eres nuevo aquí, ¿no?", en: "Hi! I think you're new here, right?" },
      { s: 1, es: "¡Hola! Sí, me llamo Sam. Mucho gusto.", en: "Hi! Yes, my name is Sam. Nice to meet you.", k: 1 },
      { s: 0, es: "Mucho gusto, Sam. Yo soy Carmen, del quinto piso.", en: "Nice to meet you, Sam. I'm Carmen, from the fifth floor." },
      { s: 1, es: "¿De dónde eres, Carmen?", en: "Where are you from, Carmen?", k: 1 },
      { s: 0, es: "Soy de Guadalajara. ¿Y tú?", en: "I'm from Guadalajara. And you?" },
      { s: 1, es: "Soy de Toronto. Estoy aprendiendo español.", en: "I'm from Toronto. I'm learning Spanish.", k: 1 },
      { s: 0, es: "¡Pues hablas muy bien! Bienvenido al edificio.", en: "Well, you speak very well! Welcome to the building." },
      { s: 1, es: "Gracias. ¡Hasta luego!", en: "Thanks. See you later!" },
    ],
    quiz: [
      { q: { en: "Where does Carmen live?", es: "¿Dónde vive Carmen?" },
        opts: { en: ["First floor", "Fifth floor", "Next door", "Downstairs"], es: ["Primer piso", "Quinto piso", "Al lado", "Abajo"] }, a: 1 },
      { q: { en: "Where is Carmen from?", es: "¿De dónde es Carmen?" },
        opts: { en: ["Toronto", "Mexico City", "Guadalajara", "Madrid"], es: ["Toronto", "Ciudad de México", "Guadalajara", "Madrid"] }, a: 2 },
    ],
    words: [
      { es: "mucho gusto", en: "nice to meet you", ex: "Mucho gusto, Carmen." },
      { es: "¿De dónde eres?", en: "Where are you from?", ex: "¿De dónde eres tú?" },
      { es: "hasta luego", en: "see you later", ex: "¡Hasta luego, vecino!" },
    ] },
  { id: "g_market", emoji: "🍅", band: "adult", level: "A2",
    title: { en: "At the market", es: "En el mercado" },
    scene: { en: "Buying fruit at a street market stall.", es: "Compras fruta en un puesto del mercado." },
    lines: [
      { s: 0, es: "¡Pase, pase! ¿Qué va a llevar hoy?", en: "Come in! What will you take today?" },
      { s: 1, es: "¿A cómo están los mangos?", en: "How much are the mangoes?", k: 1 },
      { s: 0, es: "A treinta el kilo, están dulcísimos.", en: "Thirty a kilo, they're very sweet." },
      { s: 1, es: "Deme un kilo, y medio kilo de fresas.", en: "Give me one kilo, and half a kilo of strawberries.", k: 1 },
      { s: 0, es: "¿Algo más? Tengo aguacates muy buenos.", en: "Anything else? I have very good avocados." },
      { s: 1, es: "No, gracias, así está bien.", en: "No thanks, that's all.", k: 1 },
      { s: 0, es: "Son cincuenta y cinco. ¿Le pongo bolsa?", en: "That's fifty-five. Shall I bag it for you?" },
      { s: 1, es: "Sí, por favor. Que tenga buen día.", en: "Yes, please. Have a good day." },
    ],
    quiz: [
      { q: { en: "What costs thirty per kilo?", es: "¿Qué cuesta treinta el kilo?" },
        opts: { en: ["Strawberries", "Avocados", "Mangoes", "Bananas"], es: ["Fresas", "Aguacates", "Mangos", "Plátanos"] }, a: 2 },
      { q: { en: "How many strawberries does the customer buy?", es: "¿Cuántas fresas compra el cliente?" },
        opts: { en: ["One kilo", "Half a kilo", "Two kilos", "None"], es: ["Un kilo", "Medio kilo", "Dos kilos", "Ninguna"] }, a: 1 },
    ],
    words: [
      { es: "¿A cómo están…?", en: "How much are…?", ex: "¿A cómo están las fresas?" },
      { es: "medio kilo", en: "half a kilo", ex: "Medio kilo de fresas, por favor." },
      { es: "así está bien", en: "that's all / that's fine", ex: "No, gracias, así está bien." },
    ] },
  { id: "g_friend", emoji: "🧸", band: "child", level: "A1",
    title: { en: "Making a friend", es: "Haciendo un amigo" },
    scene: { en: "A new kid at the park wants to play.", es: "Un niño nuevo en el parque quiere jugar." },
    lines: [
      { s: 0, es: "¡Hola! ¿Quieres jugar conmigo?", en: "Hi! Do you want to play with me?" },
      { s: 1, es: "¡Sí! Me llamo Ali. ¿Y tú?", en: "Yes! My name is Ali. And you?", k: 1 },
      { s: 0, es: "Yo soy Sofía. ¿Te gusta el fútbol?", en: "I'm Sofía. Do you like soccer?" },
      { s: 1, es: "¡Me gusta mucho! ¿Tienes una pelota?", en: "I like it a lot! Do you have a ball?", k: 1 },
      { s: 0, es: "¡Sí, mira! Es nueva y muy rápida.", en: "Yes, look! It's new and very fast." },
      { s: 1, es: "¡Vamos a jugar!", en: "Let's play!", k: 1 },
    ],
    quiz: [
      { q: { en: "What game do they play?", es: "¿A qué juegan?" },
        opts: { en: ["Soccer", "Tag", "Hide and seek", "Cards"], es: ["Fútbol", "Atrapadas", "Escondidas", "Cartas"] }, a: 0 },
      { q: { en: "Whose ball is it?", es: "¿De quién es la pelota?" },
        opts: { en: ["Ali's", "Sofía's", "The teacher's", "Nobody's"], es: ["De Ali", "De Sofía", "De la maestra", "De nadie"] }, a: 1 },
    ],
    words: [
      { es: "jugar", en: "to play", ex: "¿Quieres jugar?" },
      { es: "la pelota", en: "the ball", ex: "La pelota es rápida." },
      { es: "¡vamos!", en: "let's go!", ex: "¡Vamos a jugar!" },
    ] },
  { id: "g_puppy", emoji: "🐶", band: "child", level: "A1",
    title: { en: "The lost puppy", es: "El perrito perdido" },
    scene: { en: "You find a little dog with no owner.", es: "Encuentras un perrito sin dueño." },
    lines: [
      { s: 0, es: "¡Mira! Un perrito. Está solo.", en: "Look! A puppy. He's alone." },
      { s: 1, es: "¿Dónde está tu casa, perrito?", en: "Where is your home, puppy?", k: 1 },
      { s: 0, es: "Tiene un collar. Dice “Luna”.", en: "He has a collar. It says “Luna”." },
      { s: 1, es: "¡Hola, Luna! ¿Tienes hambre?", en: "Hi, Luna! Are you hungry?", k: 1 },
      { s: 0, es: "¡Allí viene una señora corriendo!", en: "A lady is coming, running!" },
      { s: 1, es: "¡Señora! ¿Es su perrita?", en: "Ma'am! Is this your puppy?", k: 1 },
      { s: 0, es: "¡Sí! ¡Gracias, gracias! Luna, ¡a casa!", en: "Yes! Thank you, thank you! Luna, home!" },
    ],
    quiz: [
      { q: { en: "What is the puppy's name?", es: "¿Cómo se llama la perrita?" },
        opts: { en: ["Pip", "Luna", "Sol", "Nube"], es: ["Pip", "Luna", "Sol", "Nube"] }, a: 1 },
      { q: { en: "Who comes running?", es: "¿Quién viene corriendo?" },
        opts: { en: ["A boy", "A police officer", "A lady", "A cat"], es: ["Un niño", "Un policía", "Una señora", "Un gato"] }, a: 2 },
    ],
    words: [
      { es: "el perrito", en: "the puppy", ex: "El perrito está solo." },
      { es: "la casa", en: "the home / house", ex: "¿Dónde está tu casa?" },
      { es: "tener hambre", en: "to be hungry", ex: "¿Tienes hambre?" },
    ] },
];

/* ── Phase 2: the Course — a mastery-gated path from fundamentals up.
   Each item advances through stages: learn → quiz → build → say (m 0..4).
   A unit unlocks when the previous one is complete. Direction-agnostic. */
const PATH_UNITS = [
  { id: "u0", emoji: "⚡", title: { en: "Power words: the survival core", es: "Palabras clave" }, items: [
    { es: "quiero", en: "I want", xes: "Quiero agua, por favor.", xen: "I want water, please.", pic: "🤲" },
    { es: "tengo", en: "I have", xes: "Tengo una pregunta.", xen: "I have a question.", pic: "🎒" },
    { es: "¿dónde está…?", en: "where is…?", xes: "¿Dónde está el baño?", xen: "Where is the bathroom?", pic: "🧭" },
    { es: "y / pero", en: "and / but", xes: "Quiero pan y agua, pero no café.", xen: "I want bread and water, but not coffee.", pic: "➕" },
    { es: "no entiendo", en: "I don't understand", xes: "Lo siento, no entiendo.", xen: "Sorry, I don't understand.", pic: "🤷" },
  ] },
  { id: "u1", emoji: "👋", title: { en: "Greetings & introductions", es: "Saludos y presentaciones" }, items: [
    { es: "hola", en: "hello", xes: "¡Hola! ¿Cómo estás?", xen: "Hello! How are you?", pic: "👋" },
    { es: "buenos días", en: "good morning", xes: "Buenos días, señora.", xen: "Good morning, ma'am.", pic: "🌅" },
    { es: "me llamo", en: "my name is", xes: "Me llamo Sam.", xen: "My name is Sam.", pic: "📛" },
    { es: "mucho gusto", en: "nice to meet you", xes: "Mucho gusto, Carmen.", xen: "Nice to meet you, Carmen.", pic: "🤝" },
    { es: "adiós", en: "goodbye", xes: "Adiós, hasta mañana.", xen: "Goodbye, see you tomorrow.", pic: "✌️" },
  ] },
  { id: "u2", emoji: "🔢", title: { en: "Numbers & how many", es: "Números y cantidades" }, items: [
    { es: "uno, dos, tres", en: "one, two, three", xes: "Uno, dos, tres, ¡vamos!", xen: "One, two, three, let's go!", pic: "1️⃣2️⃣3️⃣" },
    { es: "cuatro y cinco", en: "four and five", xes: "Tengo cuatro libros y cinco plumas.", xen: "I have four books and five pens.", pic: "🖐️" },
    { es: "¿cuántos?", en: "how many?", xes: "¿Cuántos años tienes?", xen: "How many years old are you?", pic: "❓" },
    { es: "tengo … años", en: "I am … years old", xes: "Tengo ocho años.", xen: "I am eight years old.", pic: "🎂" },
    { es: "muchos", en: "many / a lot", xes: "Hay muchos gatos aquí.", xen: "There are many cats here.", pic: "🐱🐱🐱" },
  ] },
  { id: "u3", emoji: "👪", title: { en: "Family", es: "La familia" }, items: [
    { es: "la madre", en: "the mother", xes: "Mi madre se llama Rosa.", xen: "My mother is called Rosa.", pic: "👩" },
    { es: "el padre", en: "the father", xes: "Mi padre trabaja hoy.", xen: "My father works today.", pic: "👨" },
    { es: "el hermano", en: "the brother", xes: "Mi hermano es pequeño.", xen: "My brother is little.", pic: "👦" },
    { es: "la familia", en: "the family", xes: "Mi familia es grande.", xen: "My family is big.", pic: "👨‍👩‍👧" },
    { es: "los abuelos", en: "the grandparents", xes: "Mis abuelos viven lejos.", xen: "My grandparents live far away.", pic: "👵👴" },
  ] },
  { id: "u4", emoji: "🍽️", title: { en: "Food & ordering", es: "Comida y pedidos" }, items: [
    { es: "para mí", en: "for me", xes: "Un taco para mí, por favor.", xen: "A taco for me, please.", pic: "🌮" },
    { es: "la cuenta", en: "the bill", xes: "La cuenta, por favor.", xen: "The bill, please.", pic: "🧾" },
    { es: "delicioso", en: "delicious", xes: "¡Este pan es delicioso!", xen: "This bread is delicious!", pic: "😋" },
    { es: "tengo sed", en: "I'm thirsty", xes: "Tengo sed, quiero agua.", xen: "I'm thirsty, I want water.", pic: "🥤" },
    { es: "gracias", en: "thank you", xes: "Muchas gracias por todo.", xen: "Thank you very much for everything.", pic: "🙏" },
  ] },
  { id: "u5", emoji: "📅", title: { en: "Daily life", es: "La vida diaria" }, items: [
    { es: "hoy", en: "today", xes: "Hoy es un buen día.", xen: "Today is a good day.", pic: "📅" },
    { es: "mañana", en: "tomorrow", xes: "Mañana voy a la escuela.", xen: "Tomorrow I go to school.", pic: "🌄" },
    { es: "la escuela", en: "the school", xes: "La escuela está cerca.", xen: "The school is close.", pic: "🏫" },
    { es: "el trabajo", en: "the work / job", xes: "El trabajo empieza a las nueve.", xen: "Work starts at nine.", pic: "💼" },
    { es: "voy a", en: "I'm going to", xes: "Voy a casa ahora.", xen: "I'm going home now.", pic: "🚶" },
  ] },
  { id: "u6", emoji: "💛", title: { en: "Feelings: ser & estar", es: "Sentimientos: ser y estar" }, items: [
    { es: "estoy feliz", en: "I am happy", xes: "Hoy estoy muy feliz.", xen: "Today I am very happy.", pic: "😊" },
    { es: "estoy cansado", en: "I am tired", xes: "Estoy cansado después de correr.", xen: "I am tired after running.", pic: "😴" },
    { es: "soy de", en: "I am from", xes: "Soy de Toronto.", xen: "I am from Toronto.", pic: "🌍" },
    { es: "es difícil", en: "it is hard", xes: "El examen es difícil.", xen: "The exam is hard.", pic: "🧗" },
    { es: "está bien", en: "it's okay", xes: "No pasa nada, está bien.", xen: "It's nothing, it's okay.", pic: "👌" },
  ] },
  { id: "u7", emoji: "💚", title: { en: "Likes & dislikes", es: "Gustos" }, items: [
    { es: "me gusta", en: "I like", xes: "Me gusta la música.", xen: "I like music.", pic: "💚" },
    { es: "no me gusta", en: "I don't like", xes: "No me gusta el frío.", xen: "I do not like the cold.", pic: "🚫" },
    { es: "me encanta", en: "I love it", xes: "¡Me encanta bailar!", xen: "I love dancing!", pic: "🤩" },
    { es: "prefiero", en: "I prefer", xes: "Prefiero el té.", xen: "I prefer tea.", pic: "⚖️" },
    { es: "mi favorito", en: "my favorite", xes: "El azul es mi favorito.", xen: "Blue is my favorite.", pic: "⭐" },
  ] },
  { id: "u8", emoji: "❓", title: { en: "Question power", es: "Preguntas" }, items: [
    { es: "¿qué?", en: "what?", xes: "¿Qué es esto?", xen: "What is this?", pic: "❔" },
    { es: "¿quién?", en: "who?", xes: "¿Quién es ella?", xen: "Who is she?", pic: "🕵️" },
    { es: "¿cuándo?", en: "when?", xes: "¿Cuándo empieza la clase?", xen: "When does the class start?", pic: "⏰" },
    { es: "¿por qué?", en: "why?", xes: "¿Por qué estás triste?", xen: "Why are you sad?", pic: "🧐" },
    { es: "¿cómo?", en: "how?", xes: "¿Cómo se dice esto?", xen: "How do you say this?", pic: "🛠️" },
  ] },
];
const CURRICULUM = [
  { id: "c1", label: { en: "Foundations", es: "Fundamentos" },
    blurb: { en: "The survival core: the highest-frequency words that unlock everything else.", es: "Lo esencial: las palabras más frecuentes que abren todo lo demás." },
    units: ["u0", "u1", "u2"] },
  { id: "c2", label: { en: "Everyday life", es: "La vida diaria" },
    blurb: { en: "People, food, and the rhythm of a normal day.", es: "Personas, comida y el ritmo de un día normal." },
    units: ["u3", "u4", "u5"] },
  { id: "c3", label: { en: "Expression", es: "Expresión" },
    blurb: { en: "Feelings, opinions, and the questions that keep a conversation alive.", es: "Sentimientos, opiniones y las preguntas que mantienen viva una conversación." },
    units: ["u6", "u7", "u8"] },
];

const pathTerm = (item, target) => target === "es" ? item.es : item.en;
const gapWordFor = (item, target) => {
  const ex = (target === "es" ? item.xes : item.xen);
  const clean = (w) => w.replace(/[.,!?¡¿"'…:;]/g, "");
  const words = ex.split(/\s+/).map(clean).filter(Boolean);
  const termWords = (target === "es" ? item.es : item.en).split(/[^\p{L}]+/u).filter(w => w.length >= 3);
  for (const tw of termWords) {
    const hit = words.find(w => w.toLowerCase() === tw.toLowerCase());
    if (hit) return hit;
  }
  return words.reduce((a, b) => (b.length > a.length ? b : a), words[0] || "");
};
const pathMean = (item, target) => target === "es" ? item.en : item.es;
const pathEx = (item, target) => target === "es" ? item.xes : item.xen;
const pathExGloss = (item, target) => target === "es" ? item.xen : item.xes;

/* Composite learning progress: course mastery + tested skills + vocabulary bank
   + conversation practice, weighted. Every number comes from real activity. */
function learningProgress(member) {
  const clampPct = (n) => Math.max(0, Math.min(100, Math.round(n)));
  const skills = member.skills || {};
  // Skill scores (s) are already 0–100 — do not multiply by 100 again.
  const tested = SKILLS.map(k => skills[k]).filter(v => v && v.n > 0).map(v => v.s);
  const skillPct = tested.length ? tested.reduce((a, b) => a + b, 0) / tested.length : 0;
  let got = 0, total = 0;
  PATH_UNITS.forEach(u => u.items.forEach((_, i) => { total += 5; got += Math.min((member.path?.[u.id]?.[i]) || 0, 5); }));
  const coursePct = total ? (got / total) * 100 : 0;
  const words = member.deck?.length || 0;
  const vocabPct = Math.min(100, (words / 120) * 100);
  const talks = member.stats?.talks || 0;
  const talkPct = Math.min(100, (talks / 25) * 100);
  const overall = coursePct * 0.35 + skillPct * 0.35 + vocabPct * 0.15 + talkPct * 0.15;
  return {
    overall: clampPct(overall),
    course: clampPct(coursePct),
    skills: clampPct(skillPct),
    vocab: clampPct(vocabPct),
    talk: clampPct(talkPct),
    words,
    talks,
  };
}

/* Live voice styling: presets multiply into the persona's base voice, and for
   kids a boy/girl kid-voice profile overrides gender + shaping. All of it is
   resolved per-utterance, so changes apply in real time to the next line. */
const VOICE_STYLES = {
  natural:     { label: "Natural",     emoji: "✨", pitch: 1.0,  rate: 1.0  },
  cheerful:    { label: "Cheerful",    emoji: "😄", pitch: 1.07, rate: 1.05 },
  calm:        { label: "Calm",        emoji: "😌", pitch: 0.96, rate: 0.9  },
  storyteller: { label: "Storyteller", emoji: "📖", pitch: 1.03, rate: 0.86 },
  coach:       { label: "Coach",       emoji: "🔥", pitch: 0.99, rate: 1.09 },
};
const KID_VOICES = {
  boy:  { label: "Boy voice",  emoji: "🧒", gender: "m", pitch: 1.22, rate: 0.99, key: "kid_m" },
  girl: { label: "Girl voice", emoji: "👧", gender: "f", pitch: 1.3,  rate: 0.96, key: "kid_f" },
};
function voiceShape(member) {
  const persona = PERSONAS[member.personality] || PERSONAS.warm;
  const style = VOICE_STYLES[member.voiceStyle] || VOICE_STYLES.natural;
  const kv = member.ageBand === "child"
    ? KID_VOICES[member.kidVoice || (persona.gender === "f" ? "girl" : "boy")]
    : null;
  return {
    gender: kv ? kv.gender : persona.gender,
    voiceKey: kv ? kv.key : persona.gender,          // premium TTS voice selector (f/m/kid_f/kid_m)
    pitch: (kv ? kv.pitch : persona.voice.pitch || 1) * style.pitch,
    rate: (kv ? kv.rate : persona.voice.rate || 1) * style.rate,
    styleRate: style.rate,
  };
}

/** Expressive TTS. Engine ladder: OpenAI premium (gpt-4o-mini-tts, if key) →
    Kokoro HD (if enabled, EN) → browser voices with prosody AND per-segment
    language switching, so Spanish text always gets a Spanish voice. */
function useTTS(member, voices) {
  const [speaking, setSpeaking] = useState(false);
  const enabledRef = useRef(true);
  const sayIdRef = useRef(0);
  const audioRef = useRef(null);

  const stop = useCallback(() => {
    sayIdRef.current++;
    try { window.speechSynthesis?.cancel(); } catch {}
    try { if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; } } catch {}
    setSpeaking(false);
  }, []);

  const say = useCallback((text, { onEnd } = {}) => {
    try {
      if (!text || !enabledRef.current) { onEnd && onEnd(); return; }
      stop();
      const myId = ++sayIdRef.current;
      const clean = String(text).replace(/\(.*?\)/g, "").replace(/[*_#>\[\]]/g, "").replace(/\p{Extended_Pictographic}/gu, "").trim();
      if (!clean) { onEnd && onEnd(); return; }
      const persona = PERSONAS[member.personality] || PERSONAS.warm;
      const shape = voiceShape(member); // resolved fresh every line → style changes are live
      const speed = SPEEDS[member.speed || "normal"] || 1;

      const playBlob = async (blob, rate) => {
        const el = new Audio(URL.createObjectURL(blob));
        el.playbackRate = rate;
        el.onended = () => { if (myId === sayIdRef.current) { setSpeaking(false); onEnd && onEnd(); } };
        el.onerror = el.onended;
        audioRef.current = el;
        await el.play();
      };

      const speakSegments = () => {
        if (myId !== sayIdRef.current) return;
        if (!window.speechSynthesis) { setSpeaking(false); onEnd && onEnd(); return; }
        // per-language voices, both gender-matched to the persona
        const other = member.profile.target === "es" ? "en" : "es";
        const vTarget = pickVoice(voices, member.profile.target, member.voiceURI, shape.gender);
        const vOther = pickVoice(voices, other, null, shape.gender);
        const esVoice = member.profile.target === "es" ? vTarget : vOther;
        const enVoice = member.profile.target === "en" ? vTarget : vOther;
        const baseRate = shape.rate * speed;
        const basePitch = shape.pitch;
        const segs = expressiveSegments(clean);
        let i = 0;
        setSpeaking(true);
        const next = () => {
          if (myId !== sayIdRef.current) return;
          if (i >= segs.length) { setSpeaking(false); onEnd && onEnd(); return; }
          const sg = segs[i++];
          const isEs = looksSpanish(sg.text);
          const v = isEs ? (esVoice || enVoice) : (enVoice || esVoice);
          const u = new SpeechSynthesisUtterance(sg.text);
          if (v) u.voice = v;
          u.lang = isEs ? (esVoice?.lang || "es-MX") : (enVoice?.lang || "en-US");
          u.rate = Math.max(0.6, Math.min(1.6, baseRate * sg.rate));
          u.pitch = Math.max(0.5, Math.min(2, basePitch * sg.pitch));
          u.onend = () => { if (myId === sayIdRef.current) setTimeout(next, sg.pause || 0); };
          u.onerror = () => { if (myId === sayIdRef.current) next(); };
          window.speechSynthesis.speak(u);
        };
        next();
      };

      const tryKokoro = async () => {
        try {
          setSpeaking(true);
          const audio = await kokoroEngine.generate(clean, { voice: KOKORO_VOICES[shape.gender] || "af_heart" });
          if (myId !== sayIdRef.current) return;
          await playBlob(await audio.toBlob(), shape.rate * speed);
        } catch { if (myId === sayIdRef.current) speakSegments(); }
      };

      const localKey = getOpenAiTtsKey(); // premium TTS always calls OpenAI, so it needs the OpenAI key specifically, not whichever chat provider's key getApiKey() would return
      const premiumOn = isServer()
        ? (serverCaps.tts && member.premiumVoice !== false)
        : (localKey && localKey !== ttsBlockedKey && member.premiumVoice !== false);
      if (premiumOn) {
        (async () => {
          try {
            setSpeaking(true);
            let blob;
            if (isSupabase()) {
              blob = await supaTts(clean, shape.voiceKey, member.profile.target);
            } else if (isServer()) {
              const r = await fetch(SRV_URL() + "/api/tts", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: "Bearer " + SRV_TOKEN() },
                body: JSON.stringify({ text: clean, gender: shape.voiceKey, lang: member.profile.target }),
              });
              if (!r.ok) throw new Error(String(r.status));
              blob = await r.blob();
            } else blob = await openaiSpeakDirect(clean, shape.voiceKey, member.profile.target, localKey);
            if (myId !== sayIdRef.current) return;
            await playBlob(blob, speed * shape.styleRate); // neural voices: style affects pacing
          } catch (e) {
            if (e?.message === "401" || e?.message === "403") ttsBlockedKey = localKey;
            if (myId !== sayIdRef.current) return;
            if (member.hdVoice && kokoroEngine && member.profile.target === "en") tryKokoro();
            else speakSegments();
          }
        })();
        return;
      }

      if (member.hdVoice && kokoroEngine && member.profile.target === "en") { tryKokoro(); return; }
      speakSegments();
    } catch { setSpeaking(false); onEnd && onEnd(); }
  }, [member, voices, stop]);

  const setEnabled = (on) => { enabledRef.current = on; if (!on) stop(); };
  return { speaking, say, stop, setEnabled };
}

/** Speech-to-text via Web Speech API. Handlers live in a ref so the
    conversation loop never sees stale closures. onEnd(gotFinal) fires when a
    listening session ends — gotFinal=false means silence/no speech. */
function useSTT(langCode, handlersRef) {
  const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const supported = !!SR;
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recRef = useRef(null);
  const gotFinalRef = useRef(false);
  const listeningRef = useRef(false);
  const start = useCallback(() => {
    if (!SR || listeningRef.current) return;
    try {
      const rec = new SR();
      rec.lang = LANGS[langCode].sttHints[0];
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      gotFinalRef.current = false;
      rec.onresult = (e) => {
        let fin = "", inter = "", conf = 0, confN = 0;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) {
            fin += t;
            const cf = e.results[i][0].confidence;
            if (typeof cf === "number" && cf > 0) { conf += cf; confN++; }
          } else inter += t;
        }
        setInterim(inter);
        if (fin.trim()) {
          gotFinalRef.current = true;
          setInterim("");
          try { rec.stop(); } catch {}
          handlersRef.current?.onFinal?.(fin.trim(), confN ? conf / confN : null);
        }
      };
      rec.onend = () => {
        const g = gotFinalRef.current;
        gotFinalRef.current = false;
        listeningRef.current = false;
        setListening(false); setInterim("");
        handlersRef.current?.onEnd?.(g);
      };
      rec.onerror = (e) => {
        listeningRef.current = false;
        setListening(false); setInterim("");
        handlersRef.current?.onError?.(e?.error || "unknown");
      };
      recRef.current = rec;
      rec.start();
      listeningRef.current = true;
      setListening(true);
    } catch { listeningRef.current = false; setListening(false); }
  }, [SR, langCode, handlersRef]);
  const stop = useCallback(() => { try { recRef.current?.stop(); } catch {} }, []);
  const cancel = useCallback(() => { try { recRef.current?.abort?.(); } catch {} try { recRef.current?.stop?.(); } catch {} }, []);
  return { supported, listening, interim, start, stop, cancel, engine: "browser" };
}

/** Streaming STT over the server's ASR gateway (WebSocket). Same interface
    as useSTT, so the Talk loop can swap engines transparently. Streams
    MediaRecorder chunks up; receives interim/final frames back. */
function useStreamingSTT(langCode, handlersRef) {
  const supported = isServer() && !!serverCaps.streamingAsr && typeof window !== "undefined" && !!window.MediaRecorder;
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const wsRef = useRef(null), recRef = useRef(null), streamRef = useRef(null);
  const gotFinalRef = useRef(false), capRef = useRef(null);

  const teardown = useCallback(() => {
    clearTimeout(capRef.current);
    try { if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop(); } catch {}
    try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
    const ws = wsRef.current; wsRef.current = null;
    try { ws?.close(); } catch {}
    setListening(false); setInterim("");
  }, []);
  useEffect(() => teardown, [teardown]);

  const start = useCallback(async () => {
    if (!supported || wsRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ws = new WebSocket(SRV_URL().replace(/^http/, "ws") + `/api/asr/stream?token=${encodeURIComponent(SRV_TOKEN())}&lang=${langCode}`);
      wsRef.current = ws; gotFinalRef.current = false;
      ws.onopen = () => {
        const opts = window.MediaRecorder.isTypeSupported?.("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : undefined;
        const rec = new MediaRecorder(stream, opts);
        recRef.current = rec;
        rec.ondataavailable = (e) => { if (e.data.size && ws.readyState === 1) ws.send(e.data); };
        rec.start(250); // stream in ~4 chunks/sec
        setListening(true);
        capRef.current = setTimeout(() => stop(), 15000); // per-utterance cap
      };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === "interim") setInterim(m.text || "");
        else if (m.type === "final" && m.text) {
          gotFinalRef.current = true;
          const { text, confidence } = m;
          teardown();
          handlersRef.current?.onFinal?.(text, typeof confidence === "number" ? confidence : null);
        } else if (m.type === "error") { teardown(); handlersRef.current?.onError?.(m.message || "asr"); }
      };
      ws.onerror = () => { if (wsRef.current) { teardown(); handlersRef.current?.onError?.("network"); } };
      ws.onclose = () => { if (wsRef.current) { const g = gotFinalRef.current; teardown(); handlersRef.current?.onEnd?.(g); } };
    } catch (e) {
      teardown();
      handlersRef.current?.onError?.(e?.name === "NotAllowedError" ? "not-allowed" : "unavailable");
    }
  }, [supported, langCode, handlersRef, teardown]);

  const stop = useCallback(() => {
    try { if (wsRef.current?.readyState === 1) wsRef.current.send(JSON.stringify({ type: "stop" })); } catch {}
    try { if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop(); } catch {}
    setTimeout(() => { // if no final arrives, close out gracefully
      if (wsRef.current) { const g = gotFinalRef.current; teardown(); handlersRef.current?.onEnd?.(g); }
    }, 1500);
  }, [handlersRef, teardown]);

  /* cancel: hard-discard the utterance. wsRef is nulled BEFORE closing so the
     onclose/onmessage guards skip — no final, no onEnd, no phantom turn. */
  const cancel = useCallback(() => { teardown(); }, [teardown]);

  return { supported, listening, interim, start, stop, cancel, engine: "stream" };
}

/* ───────────────────────────── AI helper ───────────────────────────── */

async function askClaude(messages, { system, json = false, maxTokens = 1000 } = {}) {
  let msgs = Array.isArray(messages) ? [...messages] : [{ role: "user", content: messages }];
  if (system) {
    if (msgs[0]?.role === "user") msgs[0] = { ...msgs[0], content: `${system}\n\n---\n\n${msgs[0].content}` };
    else msgs = [{ role: "user", content: `${system}\n\nBegin now.` }, ...msgs];
  }
  let data;
  if (isSupabase()) {
    data = await supaAskAI(msgs, maxTokens); // {content:[{type,text}]} — same shape as server/'s /api/ai
  } else if (isServer()) {
    const res = await fetch(SRV_URL() + "/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + SRV_TOKEN() },
      body: JSON.stringify({ messages: msgs, maxTokens }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `API ${res.status}`);
    }
    data = await res.json();
  } else if (AI_PROVIDER() === "openai" && getApiKey()) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + getApiKey() },
      body: JSON.stringify({ model: "gpt-4o-mini", max_tokens: maxTokens, messages: msgs.map(m => ({ role: m.role, content: m.content })) }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error?.message || errBody.error || `API ${res.status}`);
    }
    data = await res.json();
  } else {
    const key = getApiKey();
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } : {}),
      },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: maxTokens, messages: msgs }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error?.message || errBody.error || `API ${res.status}`);
    }
    data = await res.json();
  }
  // normalize both response shapes: Anthropic content[] blocks or OpenAI choices[]
  const text = (data.content
    ? (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n")
    : (data.choices?.[0]?.message?.content || "")).trim();
  if (!json) return text;
  const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(clean); }
  catch {
    const a = clean.indexOf("{"), b = clean.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(clean.slice(a, b + 1));
    throw new Error("Bad JSON from model");
  }
}

function memberBrief(m) {
  const p = m.profile;
  const persona = PERSONAS[m.personality] || PERSONAS.warm;
  const weak = m.deck.filter(c => c.reps > 0 && c.lapses > 0).slice(0, 5).map(c => c.term);
  const due = m.deck.filter(c => c.due <= Date.now()).slice(0, 6).map(c => c.term);
  const kid = m.ageBand === "child";
  return `LEARNER CONTEXT PACK
Learner: ${m.name} · age band: ${m.ageBand} · native language: ${p.native} · learning: ${LANGS[p.target].name} · CEFR: ${p.level}
Goal: ${p.goal} · Interests: ${p.interests.join(", ") || "general"}
Words due for review (weave in when natural): ${due.join(", ") || "none"} · Struggles with: ${weak.join(", ") || "none yet"}
TUTOR PERSONA: ${persona.prompt}
VOICE-FIRST RULES: your words will be spoken aloud. Keep every reply to 1–2 SHORT sentences, spoken register, warm natural reactions, at most one question. No lists, no markdown, no emoji spam${kid ? ", one or two fun emoji are okay" : ""}.
LEVEL RULES: speak ${LANGS[p.target].name} at level ${p.level} plus a small stretch. ${p.level === "A1" || p.level === "A2" ? `Very short sentences; add a brief ${p.native} gloss in parentheses only when a phrase is likely new.` : `Stay almost entirely in ${LANGS[p.target].name}.`} Recast the learner's mistakes naturally inside your reply; never lecture mid-conversation.${kid ? `\nCHILD SAFETY: content must always be fully age-appropriate for a young child — kind, wholesome, nothing scary, violent, romantic, or adult. Never request personal details. If the child says something worrying, gently suggest they talk to a parent or trusted grown-up.` : ""}`;
}

/* ───────────────────────── storage & model helpers ───────────────────── */

async function loadHousehold() {
  try { const r = await window.storage.get(STORE); return r ? JSON.parse(r.value) : null; } catch { return null; }
}
async function saveHousehold(h) { try { await window.storage.set(STORE, JSON.stringify(h)); } catch (e) { console.error(e); } }
async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, "0")).join("");
}
const uid = () => Math.random().toString(36).slice(2, 9);
const todayStr = () => new Date().toDateString();

/* ─────────────── mic permission + expressive speech engine ────────────── */

/** Must be called from a user gesture. Triggers the browser's mic popup.
    force=true skips the cached permission query (which can report a stale
    "denied" after the user just changed the setting) and tests getUserMedia
    directly — the only reliable check after a settings change. */
async function ensureMicPermission(force = false) {
  try {
    if (!force && navigator.permissions?.query) {
      try {
        const st = await navigator.permissions.query({ name: "microphone" });
        if (st.state === "granted") return { ok: true, state: "granted" };
        if (st.state === "denied") return { ok: false, state: "denied" };
      } catch { /* Safari/FF may not support the query — fall through */ }
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); // ← the popup / the real test
    stream.getTracks().forEach(t => t.stop());
    return { ok: true, state: "granted" };
  } catch (e) {
    const denied = e?.name === "NotAllowedError" || e?.name === "SecurityError";
    return { ok: false, state: denied ? "denied" : "unavailable" };
  }
}

/** Split text into prosody segments: questions rise, exclamations brighten,
    interjections get their own beat, long sentences breathe at clauses,
    tiny pitch jitter keeps it from sounding flat. */
function expressiveSegments(text) {
  const sentences = text.match(/[^.!?…]+[.!?…]+["']?|[^.!?…]+$/g) || [text];
  const segs = [];
  const INTERJ = /^(mm+|oh|ah+|hmm+|wow|whoa|yay|hey|ooh|aha|¡?órale|¡?vaya|¡?guau|¡?uy|bueno|okay|ok)\b[,!]?\s*/i;
  for (let raw of sentences) {
    let s = raw.trim();
    if (!s) continue;
    const m = s.match(INTERJ);
    if (m && s.length > m[0].length + 2) {
      segs.push({ text: m[0].replace(/[,\s]+$/, "!"), pitch: 1.09, rate: 0.88, pause: 130 });
      s = s.slice(m[0].length).trim();
    }
    const isQ = /[?？]["']?$/.test(s);
    const isEx = /[!！]["']?$/.test(s);
    const base = { pitch: isQ ? 1.06 : isEx ? 1.07 : 1.0, rate: isQ ? 0.97 : isEx ? 1.04 : 1.0 };
    const clauses = s.length > 120 ? s.split(/,\s+/) : [s];
    clauses.forEach((c, i) => {
      const jitter = 0.99 + Math.random() * 0.025;
      segs.push({
        text: i < clauses.length - 1 ? c + "," : c,
        pitch: base.pitch * jitter,
        rate: base.rate * (0.99 + Math.random() * 0.025),
        pause: i < clauses.length - 1 ? 70 : 130,
      });
    });
  }
  return segs.length ? segs : [{ text, pitch: 1, rate: 1, pause: 0 }];
}

/** Light prosody for single lines (listening lab). */
function prosodyFor(text) {
  const isQ = /[?？]\s*$/.test(text), isEx = /[!！]\s*$/.test(text);
  const j = 0.985 + Math.random() * 0.035;
  return { pitch: (isQ ? 1.06 : isEx ? 1.07 : 1.0) * j, rate: isQ ? 0.97 : isEx ? 1.03 : 1.0 };
}

/* ── Optional HD neural voice: Kokoro-82M (Apache-2.0, open source) ──
   Loaded on demand; in sandboxed environments the model fetch may be blocked,
   in which case we fall back to the enhanced browser voice, honestly. */
let kokoroPromise = null, kokoroEngine = null;
function loadKokoro() {
  if (kokoroEngine) return Promise.resolve(kokoroEngine);
  if (!kokoroPromise) {
    kokoroPromise = (async () => {
      const mod = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.0/+esm");
      const tts = await mod.KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "wasm" });
      kokoroEngine = tts;
      return tts;
    })().catch(e => { kokoroPromise = null; throw e; });
  }
  return kokoroPromise;
}
const KOKORO_VOICES = { f: "af_heart", m: "am_michael" };

/* ── Premium voice: OpenAI TTS (gpt-4o-mini-tts) ──
   Used for the self-hosted/Supabase server proxy (api/tts.js) AND, in local
   "no backend" mode, called directly from the browser with the same OpenAI
   key already used for chat (getApiKey()) — no separate voice key needed. */
const OPENAI_TTS_VOICE = {
  f: "nova", m: "onyx", kid_f: "shimmer", kid_m: "fable",
};
const OPENAI_TTS_ACCENT = {
  es: "Speak in natural, native Spanish (neutral Latin American accent). Use authentic Spanish pronunciation — for example, pronounce the letter J as the Spanish H sound, not an English J. Warm, clear, conversational pace, like a friendly tutor.",
  en: "Speak naturally in English, warm and conversational pace, like a friendly tutor.",
};
let ttsBlockedKey = null; // a personal key that failed auth/network — skip until changed
async function openaiSpeakDirect(text, gender, lang, key) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: OPENAI_TTS_VOICE[gender] || OPENAI_TTS_VOICE.f,
      input: String(text).slice(0, 900),
      instructions: OPENAI_TTS_ACCENT[lang] || OPENAI_TTS_ACCENT.en,
      response_format: "mp3",
    }),
  });
  if (!res.ok) throw new Error(String(res.status));
  return await res.blob();
}

/** Heuristic: does this text chunk read as Spanish? Drives per-segment voice switching. */
function looksSpanish(t) {
  if (/[áéíóúñü¿¡]/i.test(t)) return true;
  const hits = (t.toLowerCase().match(/\b(el|la|los|las|un|una|que|qué|es|está|estás|hola|gracias|por|para|con|de|del|muy|sí|yo|tú|usted|cómo|dónde|bien|bueno|quiero|tienes|vamos|hoy|aquí)\b/g) || []).length;
  return hits >= 2;
}

/* Tiny synthesized UI sounds — no assets, very quiet, fail-silent. */
let sfxCtx = null;
function sfx(type) {
  try {
    if (!sfxCtx) sfxCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (sfxCtx.state === "suspended") sfxCtx.resume();
    const c = sfxCtx, t = c.currentTime;
    const notes = type === "chime" ? [[523.25, 0, 0.12], [783.99, 0.09, 0.18]]   // mic opens: soft up-chirp
      : type === "ding" ? [[880, 0, 0.1], [1318.5, 0.07, 0.22]]                   // star / correct
      : [[233, 0, 0.16]];                                                          // "soft": gentle, non-punishing
    notes.forEach(([f, off, dur]) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + off);
      g.gain.exponentialRampToValueAtTime(type === "soft" ? 0.05 : 0.08, t + off + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + off + dur);
      o.connect(g).connect(c.destination);
      o.start(t + off); o.stop(t + off + dur + 0.05);
    });
  } catch { /* no audio — fine */ }
}
const seedScore = lvl => ({ A1: 15, A2: 32, B1: 50, B2: 66 }[lvl] || 15);
const SKILLS = ["vocabulary", "grammar", "speaking", "comprehension"];
const SKILL_LABELS = { vocabulary: "Vocabulary", grammar: "Grammar", speaking: "Speaking", comprehension: "Comprehension" };
const KID_SKILL_LABELS = { vocabulary: "Word power", grammar: "Sentence power", speaking: "Talking power", comprehension: "Listening power" };
const cefrOf = s => (s < 22 ? "A1" : s < 40 ? "A2" : s < 58 ? "B1" : s < 75 ? "B2" : "C1");

function newMember({ id, name, avatar, ageBand, personality, profile, isParent }) {
  const s = seedScore(profile.level);
  return {
    id: id || uid(), name, avatar, ageBand, personality, isParent: !!isParent, profile,
    voiceURI: null, speed: "normal",
    stats: { xp: 0, streak: 0, lastDay: null, lessons: 0, talks: 0, stories: 0, lastGreet: null },
    deck: [],
    skills: Object.fromEntries(SKILLS.map(k => [k, { s, n: 0 }])),
    history: [{ t: todayStr(), avg: s }],
    guided: false,
  };
}
/** EWMA skill update from a 0..1 observation; snapshots daily history. */
function observe(member, skill, obs) {
  const cur = member.skills[skill] || { s: 15, n: 0 };
  const a = 0.18;
  const s = Math.max(2, Math.min(98, cur.s * (1 - a) + obs * 100 * a));
  const skills = { ...member.skills, [skill]: { s, n: cur.n + 1 } };
  const avg = SKILLS.reduce((t, k) => t + skills[k].s, 0) / SKILLS.length;
  const t = todayStr();
  let history = [...(member.history || [])];
  if (history.length && history[history.length - 1].t === t) history[history.length - 1] = { t, avg };
  else history = [...history, { t, avg }].slice(-40);
  return { ...member, skills, history };
}
const skillAvg = m => SKILLS.reduce((t, k) => t + (m.skills[k]?.s || 15), 0) / SKILLS.length;
const trendOf = m => {
  const h = m.history || [];
  if (h.length < 2) return 0;
  return h[h.length - 1].avg - h[Math.max(0, h.length - 8)].avg;
};

/* ───────────────────────────── primitives ───────────────────────────── */

const Fonts = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Albert+Sans:wght@400;500;600;700&display=swap');
    .f-display { font-family:'Fraunces', Georgia, serif; }
    .f-body { font-family:'Albert Sans', system-ui, sans-serif; }
    @keyframes breathe {0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.14);opacity:1}}
    @keyframes drift {0%{transform:translate(0,0)}33%{transform:translate(6px,-5px)}66%{transform:translate(-5px,4px)}100%{transform:translate(0,0)}}
    @keyframes rise {from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    @keyframes floaty {0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-8px) rotate(2deg)}}
    @keyframes pop {0%{transform:scale(.4);opacity:0}70%{transform:scale(1.15)}100%{transform:scale(1);opacity:1}}
    @keyframes pulse-ring {0%{box-shadow:0 0 0 0 rgba(217,91,63,.35)}70%{box-shadow:0 0 0 18px rgba(217,91,63,0)}100%{box-shadow:0 0 0 0 rgba(217,91,63,0)}}
    @keyframes confetti-fall {0%{transform:translateY(-6vh) rotate(0deg);opacity:1}100%{transform:translateY(108vh) rotate(340deg);opacity:.85}}
    .hscroll{display:flex;gap:12px;overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;scroll-snap-type:x proximity;padding:4px 0 12px;margin:0;max-width:100%;scrollbar-width:none}
    .hscroll::-webkit-scrollbar{display:none}
    .hscroll>*{scroll-snap-align:start;flex-shrink:0}
    @keyframes shake {0%,100%{transform:translateX(0)}20%{transform:translateX(-7px)}40%{transform:translateX(7px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}
    .shake{animation:shake .4s ease}
    @keyframes bounce-bar {0%,100%{height:7px}50%{height:26px}}
    .bar-fallback{animation:bounce-bar 1s ease-in-out infinite}
    .rise{animation:rise .35s ease both}.pop{animation:pop .4s ease both}.floaty{animation:floaty 3s ease-in-out infinite}
    @media (prefers-reduced-motion:reduce){.rise,.pop,.floaty,.orb-a,.orb-b{animation:none!important}}
    html,body,#root{overflow-x:hidden;max-width:100vw}
    ::selection{background:#D9A44133}
    button:focus-visible{outline:2px solid ${INK};outline-offset:2px}
  `}</style>
);

const Orb = ({ accent, size = 64, active = true, speaking = false }) => (
  <div style={{ width: size, height: size, position: "relative", flexShrink: 0 }} aria-hidden="true">
    <div className="orb-a" style={{
      position: "absolute", inset: 0, borderRadius: "50%",
      background: `radial-gradient(circle at 32% 30%, ${accent}, ${INK} 130%)`,
      animation: active ? `breathe ${speaking ? 0.9 : 2.6}s ease-in-out infinite` : "none",
    }} />
    <div className="orb-b" style={{
      position: "absolute", inset: size * 0.22, borderRadius: "50%",
      background: `radial-gradient(circle at 60% 65%, ${GOLD}55, transparent 70%)`,
      animation: active ? "drift 5s ease-in-out infinite" : "none",
    }} />
  </div>
);

const Btn = ({ children, onClick, accent = INK, ghost, small, disabled, full, style }) => (
  <button onClick={onClick} disabled={disabled} className="f-body" style={{
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
    padding: small ? "8px 14px" : "13px 22px", borderRadius: 14, fontWeight: 600,
    fontSize: small ? 14 : 15.5, border: ghost ? `1.5px solid ${LINE}` : "none",
    background: ghost ? "#fff" : accent, color: ghost ? INK : "#fff",
    cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1,
    width: full ? "100%" : undefined, transition: "transform .12s ease", ...style,
  }}
    onMouseDown={e => !disabled && (e.currentTarget.style.transform = "scale(.97)")}
    onMouseUp={e => (e.currentTarget.style.transform = "scale(1)")}
    onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
  >{children}</button>
);

const Card = ({ children, style, onClick }) => (
  <div onClick={onClick} className="rise" style={{
    background: "#fff", borderRadius: 20, border: `1px solid ${LINE}`, padding: 20,
    cursor: onClick ? "pointer" : "default", ...style,
  }}>{children}</div>
);

const Chip = ({ label, selected, onClick, accent }) => (
  <button onClick={onClick} className="f-body" style={{
    padding: "9px 15px", borderRadius: 999, fontSize: 14, fontWeight: 500,
    border: `1.5px solid ${selected ? accent : LINE}`,
    background: selected ? accent : "#fff", color: selected ? "#fff" : INK, cursor: "pointer",
  }}>{label}</button>
);

const Thinking = ({ accent, label }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "40px 0" }}>
    <Orb accent={accent} size={72} />
    <div className="f-body" style={{ color: FADE, fontSize: 14 }}>{label}</div>
  </div>
);

const ErrorBox = ({ retry }) => {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return (
    <Card style={{ textAlign: "center" }}>
      <div style={{ fontSize: 26, marginBottom: 6 }}>{offline ? "📡" : "⛅"}</div>
      <div className="f-body" style={{ fontSize: 15, marginBottom: 6 }}>
        {offline ? "You're offline — your tutor needs the internet." : "That didn't load — the tutor connection hiccuped."}
      </div>
      <div className="f-body" style={{ fontSize: 13, color: FADE, marginBottom: 12 }}>
        {offline ? "Your saved words, reviews, and progress still work offline." : "One tap usually fixes it."}
      </div>
      <Btn onClick={retry} ghost small><RefreshCw size={15} /> {offline ? "Try again" : "Retry"}</Btn>
    </Card>
  );
};

const inputStyle = {
  width: "100%", padding: "13px 15px", borderRadius: 14, border: `1.5px solid ${LINE}`,
  fontSize: 15.5, margin: "6px 0 16px", background: "#fff", color: INK, boxSizing: "border-box",
};
const optionStyle = {
  display: "block", width: "100%", textAlign: "left", padding: "12px 15px", marginBottom: 8,
  borderRadius: 12, border: `1.5px solid ${LINE}`, background: "#fff", fontSize: 15, cursor: "pointer", color: INK,
};
const pillStyle = {
  display: "inline-flex", alignItems: "center", gap: 5, background: "#fff",
  border: `1px solid ${LINE}`, borderRadius: 999, padding: "6px 11px", fontSize: 13.5, fontWeight: 600,
};

/* ───────────── mode gate: family server vs device-only ─────── */

function ModeGate({ onDone }) {
  const [url, setUrl] = useState("http://localhost:8787");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [expand, setExpand] = useState(false);

  const connect = async () => {
    setBusy(true); setErr("");
    try {
      const clean = url.trim().replace(/\/+$/, "");
      const r = await fetch(clean + "/api/health").then(x => x.json());
      if (!r.ok) throw new Error();
      try {
        localStorage.setItem("lingua-server-url", clean);
        localStorage.setItem("lingua-mode", "server");
      } catch {}
      try { serverCaps = await fetch(clean + "/api/config").then(x => x.json()); } catch {}
      onDone();
    } catch { setErr("Couldn't reach a Lingua server at that address."); }
    setBusy(false);
  };

  return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "56px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 30 }}>
        <Orb accent="#0E7C6B" size={44} />
        <div className="f-display" style={{ fontWeight: 700, fontSize: 24, letterSpacing: -0.5 }}>Lingua</div>
      </div>
      <h1 className="f-display" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.15, marginBottom: 8 }}>How should Lingua run?</h1>
      <Card onClick={() => setExpand(true)} style={{ marginBottom: 12, borderColor: expand ? "#0E7C6B" : LINE, borderWidth: expand ? 2 : 1 }}>
        <div className="f-body" style={{ fontWeight: 600, fontSize: 16 }}>🌐 Connect to your family's server</div>
        <div className="f-body" style={{ fontSize: 13.5, color: FADE, marginTop: 3 }}>
          Sync across every device · API keys stay on the server · real pronunciation scoring. Run it with <b>cd server && npm start</b>.
        </div>
        {expand && (
          <div className="rise" style={{ marginTop: 12 }} onClick={e => e.stopPropagation()}>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://api.lingua.family"
              className="f-body" style={{ ...inputStyle, margin: "0 0 8px" }} aria-label="Server address" />
            {err && <p className="f-body" style={{ color: "#A0453A", fontSize: 13, marginBottom: 8 }}>{err}</p>}
            <Btn small accent="#0E7C6B" disabled={busy || !url.trim()} onClick={connect}>
              {busy ? <Loader size={15} className="animate-spin" /> : <>Connect <ArrowRight size={15} /></>}
            </Btn>
          </div>
        )}
      </Card>
      <Card onClick={() => { try { localStorage.setItem("lingua-mode", "local"); } catch {} onDone(); }}>
        <div className="f-body" style={{ fontWeight: 600, fontSize: 16 }}>📱 This device only</div>
        <div className="f-body" style={{ fontSize: 13.5, color: FADE, marginTop: 3 }}>
          Everything stays on this device. You'll paste an Anthropic API key on the next screen.
        </div>
      </Card>
    </div>
  );
}

/* ───────────────── AI connection setup (standalone app) ─────── */

function ApiKeyGate({ onDone }) {
  const [key, setKey] = useState("");
  const [provider, setProvider] = useState("anthropic");
  const meta = provider === "openai"
    ? { name: "OpenAI", model: "GPT-4o mini", from: "platform.openai.com", ph: "sk-…" }
    : { name: "Anthropic", model: "Claude", from: "console.anthropic.com", ph: "sk-ant-…" };
  return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "56px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 30 }}>
        <Orb accent="#0E7C6B" size={44} />
        <div className="f-display" style={{ fontWeight: 700, fontSize: 24, letterSpacing: -0.5 }}>Lingua</div>
      </div>
      <h1 className="f-display" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.15, marginBottom: 10 }}>Connect your tutor's brain</h1>
      <p className="f-body" style={{ color: FADE, fontSize: 15, lineHeight: 1.55, marginBottom: 14 }}>
        Lessons, conversations, and stories are generated live by an AI model of your choice. Your key is stored
        only on this device and calls go straight from your browser to the provider — usage bills to your key.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <Chip label="Claude (Anthropic)" accent="#0E7C6B" selected={provider === "anthropic"} onClick={() => setProvider("anthropic")} />
        <Chip label="GPT (OpenAI)" accent="#0E7C6B" selected={provider === "openai"} onClick={() => setProvider("openai")} />
      </div>
      <p className="f-body" style={{ color: FADE, fontSize: 12.5, marginBottom: 10 }}>
        {meta.name} key — create one at <b>{meta.from}</b>. Tutoring runs on {meta.model}.
      </p>
      <input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={meta.ph}
        className="f-body" style={inputStyle} aria-label={`${meta.name} API key`} />
      <Btn full accent="#0E7C6B" disabled={key.trim().length < 12}
        onClick={() => {
          try {
            localStorage.setItem("lingua-ai-provider", provider);
            localStorage.setItem(provider === "openai" ? "lingua-openai-key" : "lingua-anthropic-key", key.trim());
          } catch {}
          onDone();
        }}>
        Save & start <ArrowRight size={16} />
      </Btn>
      <button onClick={() => { try { localStorage.setItem("lingua-skip-key", "1"); } catch {} onDone(); }}
        className="f-body" style={backLink}>
        Running inside Claude? Skip — use the built-in connection
      </button>
      <p className="f-body" style={{ fontSize: 11.5, color: "#9AA8A3", marginTop: 20, lineHeight: 1.5 }}>
        You can change or remove the key later from a parent profile. For production the blueprint routes all AI
        calls through a backend — a browser-held key is for personal use only.
      </p>
    </div>
  );
}

/* ─────────────────────────── Auth: welcome / sign up / sign in ───────── */

function AuthFlow({ household, onSignedIn, onCreated, remote, onRemoteAuth }) {
  const [view, setView] = useState("welcome"); // welcome | signup | signin
  const [accountType, setAccountType] = useState("family"); // family | individual
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const doSignup = async () => {
    setErr("");
    if (!name.trim()) return setErr("Add your name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setErr("That email doesn't look right.");
    if (pass.length < 6) return setErr("Password needs at least 6 characters.");
    setBusy(true);
    if (remote) {
      try {
        const r = await srv("/api/auth/signup", { method: "POST", body: { name: name.trim(), email: email.trim(), password: pass, type: accountType } });
        try { localStorage.setItem("lingua-token", r.token); } catch {}
        onRemoteAuth(r);
      } catch (e) { setErr(e.message); }
      setBusy(false);
      return;
    }
    const passHash = await sha256(pass);
    onCreated({ name: name.trim(), email: email.trim().toLowerCase(), passHash }, accountType);
  };
  const doSignin = async () => {
    setErr("");
    if (remote) {
      setBusy(true);
      try {
        const r = await srv("/api/auth/login", { method: "POST", body: { email: email.trim(), password: pass } });
        try { localStorage.setItem("lingua-token", r.token); } catch {}
        onRemoteAuth(r);
      } catch (e) { setErr(e.message); }
      setBusy(false);
      return;
    }
    if (!household?.account) return setErr("No account on this device yet — create one.");
    const h = await sha256(pass);
    if (email.trim().toLowerCase() !== household.account.email || h !== household.account.passHash)
      return setErr("Email or password doesn't match.");
    onSignedIn();
  };

  const field = (label, val, set, type = "text", placeholder = "") => (
    <div key={label}>
      <label className="f-body" style={{ fontSize: 13.5, fontWeight: 600, color: FADE }}>{label}</label>
      <div style={{ position: "relative" }}>
        <input value={val} onChange={e => set(e.target.value)} placeholder={placeholder}
          type={type === "password" && show ? "text" : type} className="f-body" style={inputStyle} />
        {type === "password" && (
          <button onClick={() => setShow(!show)} aria-label="Show password"
            style={{ position: "absolute", right: 12, top: 18, background: "none", border: "none", cursor: "pointer" }}>
            {show ? <EyeOff size={17} color={FADE} /> : <Eye size={17} color={FADE} />}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "56px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 30 }}>
        <Orb accent="#0E7C6B" size={44} active={view === "welcome"} />
        <div className="f-display" style={{ fontWeight: 700, fontSize: 24, letterSpacing: -0.5 }}>Lingua</div>
        {view === "welcome" && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => setView("signin")} className="f-body"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: FADE, fontSize: 14, fontWeight: 600, padding: 4 }}>
              Login
            </button>
            <button onClick={() => { setAccountType("classroom"); setView("signup"); }} className="f-body"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: FADE, fontSize: 14, fontWeight: 600, padding: 4 }}>
              I'm a teacher <ArrowUpRight size={14} />
            </button>
          </div>
        )}
      </div>

      {view === "welcome" && (
        <div className="rise">
          <h1 className="f-display" style={{ fontSize: 34, fontWeight: 600, lineHeight: 1.15, marginBottom: 10 }}>
            One tutor for the whole family
          </h1>
          <p className="f-body" style={{ color: FADE, fontSize: 15.5, lineHeight: 1.55, marginBottom: 26 }}>
            Real spoken conversations, lessons written just for you, story time for the kids —
            and progress every parent can see.
          </p>
          <Btn full accent="#0E7C6B" onClick={() => { setAccountType("family"); setView("signup"); }}>Join <ArrowRight size={16} /></Btn>
          <div style={{ height: 10 }} />
          <Btn full ghost onClick={() => setView("signin")}>I already have an account</Btn>
          <p className="f-body" style={{ textAlign: "center", fontSize: 12, color: "#9AA8A3", marginTop: 22 }}>lingua.family</p>
          <div style={{ height: 10 }} />
          <button onClick={() => { setAccountType("individual"); setView("signup"); }} className="f-body" style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%",
            padding: "13px 22px", borderRadius: 14, fontWeight: 600, fontSize: 15,
            border: "1.5px dashed " + LINE, background: "transparent", color: FADE, cursor: "pointer",
          }}>
            <User size={16} /> Just me — create an individual account
          </button>
          <p className="f-body" style={{ fontSize: 12, color: "#9AA8A3", marginTop: 22 }}>
            Demo build: your account lives privately in this app's storage on this device.
          </p>
        </div>
      )}

      {view === "signup" && (
        <div className="rise">
          <h1 className="f-display" style={{ fontSize: 28, fontWeight: 600, marginBottom: 6 }}>
            {accountType === "family" ? "Create your family account" : accountType === "classroom" ? "Create your classroom" : "Create your account"}
          </h1>
          <p className="f-body" style={{ color: FADE, fontSize: 14, marginBottom: 16 }}>
            {accountType === "family"
              ? "You'll set up your own profile first, then add family members — you manage the kids' profiles."
              : accountType === "classroom"
              ? "You'll set up your teacher profile, name your class, then add students — with a roster, live assessments, and assignments."
              : "A personal account, just for you. You can upgrade to a family account anytime from your profile."}
          </p>
          {field("Your name", name, setName, "text", "e.g. Dana")}
          {field("Email", email, setEmail, "email", "you@example.com")}
          {field("Password", pass, setPass, "password", "6+ characters")}
          {err && <p className="f-body" style={{ color: "#A0453A", fontSize: 13.5, marginBottom: 12 }}>{err}</p>}
          <Btn full accent="#0E7C6B" disabled={busy} onClick={doSignup}>
            {busy ? <Loader size={16} className="animate-spin" /> : <>Join <ArrowRight size={16} /></>}
          </Btn>
          <button onClick={() => { setErr(""); setView("welcome"); }} className="f-body" style={backLink}>Back</button>
        </div>
      )}

      {view === "signin" && (
        <div className="rise">
          <h1 className="f-display" style={{ fontSize: 28, fontWeight: 600, marginBottom: 18 }}>Welcome back</h1>
          {field("Email", email, setEmail, "email", "you@example.com")}
          {field("Password", pass, setPass, "password", "")}
          {err && <p className="f-body" style={{ color: "#A0453A", fontSize: 13.5, marginBottom: 12 }}>{err}</p>}
          <Btn full accent="#0E7C6B" onClick={doSignin}>Sign in <ArrowRight size={16} /></Btn>
          <button onClick={() => { setErr(""); setView("forgotpw"); }} className="f-body" style={backLink}>Forgot password?</button>
          <button onClick={() => { setErr(""); setView("welcome"); }} className="f-body" style={backLink}>Back</button>
        </div>
      )}

      {view === "forgotpw" && (
        <div className="rise">
          <h1 className="f-display" style={{ fontSize: 28, fontWeight: 600, marginBottom: 6 }}>Reset your password</h1>
          <p className="f-body" style={{ color: FADE, fontSize: 14, marginBottom: 16 }}>
            Enter your email and we'll send you a link to reset your password.
          </p>
          {field("Email", email, setEmail, "email", "you@example.com")}
          {err && <p className="f-body" style={{ color: "#A0453A", fontSize: 13.5, marginBottom: 12 }}>{err}</p>}
          <Btn full accent="#0E7C6B" disabled={busy} onClick={async () => {
            setErr("");
            if (!email) return setErr("Please enter your email");
            setBusy(true);
            try {
              const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${typeof window !== "undefined" ? window.location.origin : ""}/auth/callback?type=recovery`,
              });
              if (error) throw error;
              setView("resetsent");
            } catch (e) { setErr(e.message); }
            setBusy(false);
          }}>
            {busy ? <Loader size={16} className="animate-spin" /> : <>Send Reset Link <ArrowRight size={16} /></>}
          </Btn>
          <button onClick={() => { setErr(""); setView("signin"); }} className="f-body" style={backLink}>Back</button>
        </div>
      )}

      {view === "resetsent" && (
        <div className="rise">
          <div style={{ fontSize: 44, marginBottom: 16, textAlign: "center" }}>📧</div>
          <h1 className="f-display" style={{ fontSize: 28, fontWeight: 600, marginBottom: 10 }}>Check your email</h1>
          <p className="f-body" style={{ color: FADE, fontSize: 14, marginBottom: 12 }}>
            We've sent a password reset link to <strong>{email}</strong>.
          </p>
          <p className="f-body" style={{ color: FADE, fontSize: 14, marginBottom: 20 }}>
            The link expires in 1 hour. If you don't see it, check your spam folder.
          </p>
          <Btn full accent="#0E7C6B" onClick={() => { setErr(""); setView("signin"); }}>Back to sign in</Btn>
        </div>
      )}
    </div>
  );
}
const backLink = { display: "block", margin: "16px auto 0", background: "none", border: "none", color: FADE, cursor: "pointer", fontSize: 14 };

/* ─────────── Invite landing: an invited member's first arrival ───────── */
// Reached via /app/invite from Supabase invite email (new users) or magic-link
// OTP (existing accounts). New invitees must set a password; existing ones
// skip that. Both call accept-invite then SetupMember so the member object is
// built by the same newMember() path as locally-added members.

/** Auth methods from the session JWT `amr` claim (e.g. invite, otp, password). */
function sessionAuthMethods(session) {
  try {
    const part = session?.access_token?.split(".")[1];
    if (!part) return [];
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return (json.amr || []).map((a) => (typeof a === "string" ? a : a?.method)).filter(Boolean);
  } catch { return []; }
}

/** True when this invitee still needs a password before cross-device login works.
 *  Do NOT use account age: inviteUserByEmail creates the auth user at send time,
 *  so opening the email later looks "old" and wrongly skipped the password step. */
function inviteeNeedsPassword(user, session) {
  const flag = user?.user_metadata?.needs_password;
  if (flag === false) return false;
  if (flag === true) return true;
  const methods = sessionAuthMethods(session);
  if (methods.includes("invite")) return true;
  if (methods.some((m) => m === "otp" || m === "magiclink" || m === "password" || m === "email")) return false;
  // On /app/invite with no clear signal, prefer asking — skipping left people locked out.
  return true;
}

function InviteLanding({ onDone }) {
  const [step, setStep] = useState("loading"); // loading | password | profile
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        // PKCE / hash exchange can lag behind first paint on /app/invite.
        let user = (await supabase.auth.getUser()).data?.user;
        let session = (await supabase.auth.getSession()).data?.session;
        if (!user || !session) {
          await new Promise((resolve) => {
            const t = setTimeout(resolve, 4000);
            const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
              if (s?.user) { clearTimeout(t); subscription.unsubscribe(); resolve(); }
            });
          });
          user = (await supabase.auth.getUser()).data?.user;
          session = (await supabase.auth.getSession()).data?.session;
        }
        if (!user) { setErr("Sign-in link expired — ask for a new invite."); setStep("password"); return; }

        // Accept pending invite (existing accounts) or confirm trigger join (new).
        let memberSeed = null;
        try {
          const accepted = await supaAcceptPendingInvite();
          memberSeed = accepted.memberSeed || null;
        } catch (e) {
          // Fall back to reading an already-accepted invite (new-user trigger path).
          try {
            const { data } = await supabase
              .from("household_invites")
              .select("member_seed")
              .eq("email", (user.email || "").toLowerCase())
              .eq("status", "accepted")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            memberSeed = data?.member_seed || null;
          } catch {}
          if (!memberSeed && e.message) setErr(e.message);
        }

        setSeed({ id: user.id, name: memberSeed?.name || user.user_metadata?.name || "", ...memberSeed });
        setStep(inviteeNeedsPassword(user, session) ? "password" : "profile");
      } catch (e) {
        setErr(e.message || "Could not open invite");
        setStep("password");
      }
    })();
  }, []);

  const setPassword = async () => {
    setErr("");
    if (pass.length < 6) return setErr("Password needs at least 6 characters.");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: pass,
        data: { needs_password: false },
      });
      if (error) throw error;
      setStep("profile");
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  if (step === "loading") return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "56px 22px", textAlign: "center" }}>
      <Loader size={22} className="animate-spin" style={{ color: FADE }} />
    </div>
  );

  if (step === "password") return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "56px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 30 }}>
        <Orb accent="#0E7C6B" size={44} active />
        <div className="f-display" style={{ fontWeight: 700, fontSize: 24, letterSpacing: -0.5 }}>Lingua</div>
      </div>
      <h1 className="f-display" style={{ fontSize: 28, fontWeight: 600, marginBottom: 6 }}>You've been invited!</h1>
      <p className="f-body" style={{ color: FADE, fontSize: 14, marginBottom: 16 }}>
        Set a password so you can sign back in anytime.
      </p>
      <label className="f-body" style={{ fontSize: 13.5, fontWeight: 600, color: FADE }}>Password</label>
      <div style={{ position: "relative" }}>
        <input value={pass} onChange={e => setPass(e.target.value)} placeholder="6+ characters"
          type={show ? "text" : "password"} className="f-body" style={inputStyle} />
        <button onClick={() => setShow(!show)} aria-label="Show password"
          style={{ position: "absolute", right: 12, top: 18, background: "none", border: "none", cursor: "pointer" }}>
          {show ? <EyeOff size={17} color={FADE} /> : <Eye size={17} color={FADE} />}
        </button>
      </div>
      {err && <p className="f-body" style={{ color: "#A0453A", fontSize: 13.5, margin: "12px 0" }}>{err}</p>}
      <div style={{ height: 8 }} />
      <Btn full accent="#0E7C6B" disabled={busy} onClick={setPassword}>
        {busy ? <Loader size={16} className="animate-spin" /> : <>Continue <ArrowRight size={16} /></>}
      </Btn>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: MIST, color: INK }}>
      <Fonts />
      {err && <p className="f-body" style={{ color: "#A0453A", fontSize: 13.5, margin: "16px 22px" }}>{err}</p>}
      <SetupMember role="adult-member"
        defaults={{ id: seed?.id, name: seed?.name, target: seed?.target, native: seed?.native, goal: seed?.goal, interests: seed?.interests }}
        onDone={async (m) => { await supaJoinHousehold(m); onDone(); }} />
    </div>
  );
}

/* ──────────────── Member setup (parent's own + child profiles) ───────── */

function SetupMember({ role, context = "family", defaults = {}, onDone, onCancel }) {
  // role: 'parent' | 'child' | 'adult' | 'adult-member' (invited member completing their own profile)
  const isKidFlow = role === "child";
  const [step, setStep] = useState(0);
  const [m, setM] = useState({
    name: defaults.name || "", avatar: null,
    ageBand: role === "parent" || role === "adult" || role === "adult-member" ? "adult" : "child",
    target: defaults.target || null, native: defaults.native || "", level: null, goal: defaults.goal || null,
    interests: defaults.interests || [], personality: null,
  });
  const [placing, setPlacing] = useState(false);
  const [quiz, setQuiz] = useState(null);
  const [qi, setQi] = useState(0);
  const [score, setScore] = useState(0);
  const [qErr, setQErr] = useState(false);
  const accent = m.target ? LANGS[m.target].accent : "#0E7C6B";
  const kid = m.ageBand === "child";
  const avatars = m.ageBand === "adult" ? ADULT_AVATARS : KID_AVATARS;
  const interests = kid ? KID_INTERESTS : ADULT_INTERESTS;

  const finish = (lvl) => {
    onDone(newMember({
      id: defaults.id, name: m.name.trim(), avatar: m.avatar || avatars[0], ageBand: m.ageBand,
      personality: m.personality || personasFor(m.ageBand)[0][0],
      isParent: role === "parent",
      profile: {
        target: m.target, native: m.native.trim() || "English", level: lvl,
        goal: m.goal || (kid ? "For fun" : "For fun"), interests: m.interests,
      },
    }));
  };

  const startPlacement = async () => {
    setPlacing(true); setQErr(false);
    try {
      const r = await askClaude(
        `Create a 5-question placement quiz for a ${m.native}-speaking learner of ${LANGS[m.target].name}. Questions rise A1→B2, mixing vocabulary and grammar. Respond ONLY with JSON, no fences: {"items":[{"prompt":"...","options":["a","b","c","d"],"answer":0,"cefr":"A1"}]}`,
        { json: true, maxTokens: 900 });
      setQuiz(r.items); setQi(0); setScore(0);
    } catch { setQErr(true); }
    setPlacing(false);
  };
  const answerQuiz = (idx) => {
    sfx(idx === quiz[qi].answer ? "ding" : "soft");
    const s = score + (idx === quiz[qi].answer ? 1 : 0);
    if (qi < quiz.length - 1) { setScore(s); setQi(qi + 1); }
    else finish(s <= 1 ? "A1" : s === 2 ? "A2" : s <= 4 ? "B1" : "B2");
  };

  const steps = [];

  // step: identity
  steps.push(
    <div key="id">
      <h1 className="f-display" style={h1s}>{role === "parent" ? (context === "classroom" ? "Set up your teacher profile" : "Set up your profile") : role === "child" ? (context === "classroom" ? "Add a young student" : "Add a young learner") : (context === "classroom" ? "Add an adult student" : "Add a family member")}</h1>
      {role === "child" && (
        <p className="f-body" style={{ color: FADE, marginBottom: 16 }}>You'll manage this profile. They get their own kid-safe animal tutor — playful, gentle, and always age-appropriate.</p>
      )}
      <label className="f-body" style={lbl}>First name</label>
      <input value={m.name} onChange={e => setM({ ...m, name: e.target.value })} className="f-body" style={inputStyle} placeholder={role === "child" ? "e.g. Sofía" : "e.g. Dana"} />
      {role === "child" && (
        <>
          <label className="f-body" style={lbl}>Age group</label>
          <div style={{ display: "flex", gap: 8, margin: "6px 0 16px" }}>
            {["child", "teen"].map(b => (
              <Chip key={b} label={AGE_BANDS[b].label} accent="#0E7C6B" selected={m.ageBand === b} onClick={() => setM({ ...m, ageBand: b, personality: null, interests: [] })} />
            ))}
          </div>
        </>
      )}
      <label className="f-body" style={lbl}>Pick an avatar</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0 20px" }}>
        {avatars.map(a => (
          <button key={a} onClick={() => setM({ ...m, avatar: a })} aria-label={`Avatar ${a}`} style={{
            fontSize: 26, width: 52, height: 52, borderRadius: 16, cursor: "pointer",
            border: `2px solid ${m.avatar === a ? "#0E7C6B" : LINE}`, background: m.avatar === a ? "#E3F1EE" : "#fff",
          }}>{a}</button>
        ))}
      </div>
      <Btn full accent="#0E7C6B" disabled={!m.name.trim()} onClick={() => setStep(1)}>Continue <ArrowRight size={16} /></Btn>
    </div>
  );

  // step: language (+ native for adults)
  steps.push(
    <div key="lang">
      <h1 className="f-display" style={h1s}>{kid ? `What will ${m.name || "they"} learn?` : "Which language?"}</h1>
      {Object.entries(LANGS).map(([code, l]) => (
        <Card key={code} onClick={() => setM({ ...m, target: code })}
          style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12, borderColor: m.target === code ? l.accent : LINE, borderWidth: m.target === code ? 2 : 1 }}>
          <span style={{ fontSize: 30 }}>{l.flag}</span>
          <div style={{ flex: 1 }}>
            <div className="f-body" style={{ fontWeight: 600, fontSize: 17 }}>{l.name}</div>
            <div className="f-body" style={{ color: FADE, fontSize: 13.5 }}>with their own AI tutor</div>
          </div>
          {m.target === code && <Check size={18} color={l.accent} />}
        </Card>
      ))}
      <label className="f-body" style={lbl}>{kid || role === "child" ? "Language spoken at home" : "Your native language"}</label>
      <select value={m.native} onChange={e => setM({ ...m, native: e.target.value })} className="f-body"
        style={{ ...inputStyle, appearance: "auto", cursor: "pointer" }} aria-label="Native language">
        <option value="" disabled>Select a language…</option>
        <optgroup label="Popular">
          {POPULAR_NATIVE.map(l => <option key={"p-" + l} value={l}>{l}</option>)}
        </optgroup>
        <optgroup label="All languages">
          {ALL_NATIVE.map(l => <option key={l} value={l}>{l}</option>)}
        </optgroup>
      </select>
      <Btn full accent={accent} disabled={!m.target || !m.native.trim()} onClick={() => setStep(2)}>Continue <ArrowRight size={16} /></Btn>
    </div>
  );

  // step: goal (adults/teens) + interests
  steps.push(
    <div key="likes">
      <h1 className="f-display" style={h1s}>{kid ? `What does ${m.name || "your learner"} love?` : "Make it yours"}</h1>
      {!kid && (
        <>
          <div className="f-body" style={{ ...lbl, marginBottom: 8 }}>Why {m.target ? LANGS[m.target].name : "this language"}?</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
            {GOALS.map(g => <Chip key={g} label={g} accent={accent} selected={m.goal === g} onClick={() => setM({ ...m, goal: g })} />)}
          </div>
        </>
      )}
      <div className="f-body" style={{ ...lbl, marginBottom: 8 }}>Pick a few interests — lessons and stories are built from these</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 22 }}>
        {interests.map(i => (
          <Chip key={i} label={i} accent={accent} selected={m.interests.includes(i)}
            onClick={() => setM({ ...m, interests: m.interests.includes(i) ? m.interests.filter(x => x !== i) : [...m.interests, i] })} />
        ))}
      </div>
      <Btn full accent={accent} disabled={!kid && !m.goal} onClick={() => setStep(3)}>Continue <ArrowRight size={16} /></Btn>
    </div>
  );

  // step: tutor personality
  steps.push(
    <div key="persona">
      <h1 className="f-display" style={h1s}>Choose a tutor</h1>
      <p className="f-body" style={{ color: FADE, marginBottom: 16 }}>Each tutor has their own voice and style. You can change tutors anytime.</p>
      {personasFor(m.ageBand).map(([key, p]) => (
        <Card key={key} onClick={() => setM({ ...m, personality: key })}
          style={{ marginBottom: 10, padding: 16, borderColor: m.personality === key ? accent : LINE, borderWidth: m.personality === key ? 2 : 1, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 24 }}>{p.emoji}</span>
          <div className="f-body" style={{ fontWeight: 600, flex: 1 }}>{p.label}</div>
          {m.personality === key && <Check size={18} color={accent} />}
        </Card>
      ))}
      <Btn full accent={accent} disabled={!m.personality} onClick={() => setStep(4)}>Continue <ArrowRight size={16} /></Btn>
    </div>
  );

  // step: level
  steps.push(
    <div key="level">
      <h1 className="f-display" style={h1s}>{kid ? `Where is ${m.name || "your learner"} starting?` : "Where are you now?"}</h1>
      {placing ? <Thinking accent={accent} label="Preparing the placement…" /> :
        qErr ? <ErrorBox retry={startPlacement} /> :
        quiz ? (
          <Card>
            <div className="f-body" style={{ fontSize: 12.5, fontWeight: 700, color: accent, letterSpacing: 1, marginBottom: 10 }}>
              QUESTION {qi + 1} OF {quiz.length} · {quiz[qi].cefr}
            </div>
            <div className="f-body" style={{ fontSize: 17, fontWeight: 600, marginBottom: 16 }}>{quiz[qi].prompt}</div>
            {quiz[qi].options.map((o, i) => <button key={i} onClick={() => answerQuiz(i)} className="f-body" style={optionStyle}>{o}</button>)}
          </Card>
        ) : kid ? (
          <>
            {[["A1", "Brand new ✨", "First words and sounds"], ["A2", "Knows a little 🌱", "Some words and simple phrases"]].map(([id, label, desc]) => (
              <Card key={id} onClick={() => finish(id)} style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10, padding: 16 }}>
                <div style={{ flex: 1 }}>
                  <div className="f-body" style={{ fontWeight: 600 }}>{label}</div>
                  <div className="f-body" style={{ fontSize: 13, color: FADE }}>{desc}</div>
                </div>
                <ChevronRight size={16} color={FADE} />
              </Card>
            ))}
          </>
        ) : (
          <>
            {LEVELS.map(l => (
              <Card key={l.id} onClick={() => finish(l.id)} style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10, padding: 16 }}>
                <div className="f-display" style={{ fontWeight: 700, fontSize: 18, color: accent, width: 36 }}>{l.id}</div>
                <div style={{ flex: 1 }}>
                  <div className="f-body" style={{ fontWeight: 600 }}>{l.label}</div>
                  <div className="f-body" style={{ fontSize: 13, color: FADE }}>{l.desc}</div>
                </div>
                <ChevronRight size={16} color={FADE} />
              </Card>
            ))}
            <Btn full ghost onClick={startPlacement} style={{ marginTop: 8 }}><GraduationCap size={17} /> Not sure — quick placement (60s)</Btn>
          </>
        )}
    </div>
  );

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "36px 20px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
        <Orb accent={accent} size={38} active={false} />
        <div className="f-display" style={{ fontWeight: 700, fontSize: 20 }}>Lingua</div>
        <button onClick={() => step > 0 ? (setQuiz(null), setStep(step - 1)) : onCancel && onCancel()} className="f-body"
          style={{ marginLeft: "auto", background: "none", border: "none", color: FADE, cursor: "pointer", fontSize: 14 }}>
          {step > 0 ? "Back" : onCancel ? "Cancel" : ""}
        </button>
      </div>
      <div className="rise" key={step}>{steps[step]}</div>
    </div>
  );
}
const h1s = { fontSize: 28, fontWeight: 600, marginBottom: 14, lineHeight: 1.2 };
const lbl = { fontSize: 13.5, fontWeight: 600, color: FADE };

/* ──────────── Parent side: send an email invite to an adult/teen ─────── */

function InviteSend({ onCancel, onSent }) {
  const [phase, setPhase] = useState("form"); // form | profile-seed | done
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [prefill, setPrefill] = useState(false);
  const [coParent, setCoParent] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [doneMsg, setDoneMsg] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [copied, setCopied] = useState(false);

  const send = async (memberSeed) => {
    setErr(""); setBusy(true);
    try {
      const result = await supaInviteMember({
        email: email.trim(), name: name.trim(),
        ageBand: "adult", role: coParent ? "owner" : "member",
        memberSeed: memberSeed || undefined,
      });
      setDoneMsg(result?.message
        || (result?.existingUser
          ? "They already have an account — we emailed them a link to join."
          : result?.emailed === false
            ? "Invite created — send them the link below."
            : `Invite sent to ${email.trim()}.`));
      setInviteLink(result?.inviteLink || "");
      setPhase("done");
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  if (phase === "done") return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "56px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
        <Orb accent="#0E7C6B" size={38} active={false} />
        <div className="f-display" style={{ fontWeight: 700, fontSize: 20 }}>Lingua</div>
      </div>
      <h1 className="f-display" style={h1s}>Invite sent</h1>
      <p className="f-body" style={{ color: FADE, marginBottom: 24, lineHeight: 1.5 }}>{doneMsg}</p>
      {inviteLink && (
        <div style={{ marginBottom: 20 }}>
          <label className="f-body" style={{ ...lbl, marginTop: 0 }}>Invite link</label>
          <input readOnly value={inviteLink} className="f-body" style={{ ...inputStyle, fontSize: 12 }}
            onFocus={(e) => e.target.select()} />
          <Btn full accent="#0E7C6B" style={{ marginTop: 10 }}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(inviteLink);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                setErr("Couldn't copy — select the link and copy manually.");
              }
            }}>
            {copied ? "Copied" : "Copy link"}
          </Btn>
        </div>
      )}
      {err && <p className="f-body" style={{ color: "#A0453A", fontSize: 13.5, marginBottom: 12 }}>{err}</p>}
      <Btn full accent={inviteLink ? "#C9B8A0" : "#0E7C6B"} onClick={() => onSent()}>
        Done <ArrowRight size={16} />
      </Btn>
    </div>
  );

  if (phase === "profile-seed") return (
    <SetupMember role="adult-member" defaults={{ name }}
      onCancel={() => setPhase("form")}
      onDone={(m) => {
        const { id, ...memberSeed } = m; // id is assigned to the invitee's own auth.uid() on accept, not here
        send(memberSeed);
      }} />
  );

  return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "56px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
        <Orb accent="#0E7C6B" size={38} active={false} />
        <div className="f-display" style={{ fontWeight: 700, fontSize: 20 }}>Lingua</div>
        <button onClick={onCancel} className="f-body" style={{ marginLeft: "auto", background: "none", border: "none", color: FADE, cursor: "pointer", fontSize: 14 }}>Cancel</button>
      </div>
      <h1 className="f-display" style={h1s}>Invite a family member</h1>
      <p className="f-body" style={{ color: FADE, marginBottom: 16 }}>
        They'll get an email to join with their own login. New emails set a password; people who already use Lingua get a sign-in link instead.
      </p>
      <label className="f-body" style={lbl}>Their name</label>
      <input value={name} onChange={e => setName(e.target.value)} className="f-body" style={inputStyle} placeholder="e.g. Dana" />
      <label className="f-body" style={lbl}>Their email</label>
      <input value={email} onChange={e => setEmail(e.target.value)} type="email" className="f-body" style={inputStyle} placeholder="them@example.com" />

      <label className="f-body" style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0", cursor: "pointer" }}>
        <input type="checkbox" checked={prefill} onChange={e => setPrefill(e.target.checked)} />
        <span>Set up their profile now (language, level, interests)</span>
      </label>
      <label className="f-body" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, cursor: "pointer" }}>
        <input type="checkbox" checked={coParent} onChange={e => setCoParent(e.target.checked)} />
        <span>Give this person co-parent access <span style={{ color: FADE }}>(parental controls, manage other members — you can change this later)</span></span>
      </label>

      {err && <p className="f-body" style={{ color: "#A0453A", fontSize: 13.5, marginBottom: 12 }}>{err}</p>}
      <Btn full accent="#0E7C6B" disabled={busy || !name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)}
        onClick={() => prefill ? setPhase("profile-seed") : send(null)}>
        {busy ? <Loader size={16} className="animate-spin" /> : <>{prefill ? "Continue" : "Send invite"} <ArrowRight size={16} /></>}
      </Btn>
    </div>
  );
}

/* ───────────────────────────── member picker ─────────────────────────── */

function MemberPicker({ household, onPick, onAdd, onSignOut }) {
  const cls = household.type === "classroom";
  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "64px 22px", textAlign: "center" }}>
      <h1 className="f-display" style={{ fontSize: 32, fontWeight: 600, marginBottom: 6 }}>Who's learning?</h1>
      <p className="f-body" style={{ color: FADE, marginBottom: 34 }}>
        {cls ? <>{household.className} · code <b style={{ letterSpacing: 1 }}>{household.classCode}</b></> : "The tutor, voice, and lessons change for each person."}
      </p>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", justifyContent: "center" }}>
        {household.members.map(m => (
          <button key={m.id} onClick={() => onPick(m.id)} className="f-body pop" style={{ background: "none", border: "none", cursor: "pointer" }}>
            <div style={{
              width: 84, height: 84, borderRadius: 26, fontSize: 40, display: "flex", alignItems: "center", justifyContent: "center",
              background: m.ageBand === "child" ? KID_CARD : "#fff", border: `2px solid ${LANGS[m.profile.target].accent}`,
            }}>{m.avatar}</div>
            <div style={{ fontWeight: 600, marginTop: 8, fontSize: 15 }}>{m.name}</div>
            <div style={{ fontSize: 12, color: FADE }}>{LANGS[m.profile.target].flag} {m.profile.level}{m.isParent ? (cls ? " · Teacher" : " · Parent") : ""}</div>
          </button>
        ))}
        <button onClick={onAdd} className="f-body" style={{ background: "none", border: "none", cursor: "pointer" }}>
          <div style={{
            width: 84, height: 84, borderRadius: 26, display: "flex", alignItems: "center", justifyContent: "center",
            background: "#fff", border: `2px dashed ${LINE}`,
          }}><Plus size={26} color={FADE} /></div>
          <div style={{ fontWeight: 600, marginTop: 8, fontSize: 15, color: FADE }}>{cls ? "Add student" : "Add member"}</div>
        </button>
      </div>
      <button onClick={onSignOut} className="f-body" style={{ ...backLink, marginTop: 44 }}><LogOut size={13} style={{ verticalAlign: -2, marginRight: 5 }} />Sign out</button>
    </div>
  );
}

/* ─────────────────── guided, spoken onboarding tour ──────────────────── */

function GuidedTour({ member, tts, accent, onDone }) {
  const kid = member.ageBand === "child";
  const tut = tutorFor(member);
  const tn = tut.name;
  const steps = kid ? [
    { title: `Hi ${member.name}! I'm ${tn}! ${tut.emoji}`, text: `We're going to learn ${LANGS[member.profile.target].name} together and it's going to be SO fun!` },
    { title: "Story time 📖", text: "Tap Story and I'll tell you a magical story with pictures — you help me tell it!" },
    { title: "Talk to me! 🎤", text: "Tap the big circle once and just talk — I talk right back, like a phone call!" },
    { title: "Collect stars ⭐", text: "Every game and story earns stars. Ready? Let's go!" },
  ] : [
    { title: `Welcome, ${member.name} — I'm ${tn}.`, text: `I'm your personal ${LANGS[member.profile.target].name} tutor. Everything here is built around you, and I remember everything we do together.` },
    { title: "Your daily lesson", text: "Each day I write a fresh lesson around your interests and level. It's the fastest 8 minutes of progress you'll make." },
    { title: "Talk to me — literally", text: "The Talk tab is a real conversation: tap the mic once, then just speak — I answer out loud and listen again, hands-free. Corrections wait for the end." },
    { title: "Watch yourself grow", text: "Your profile shows a live assessment of your four core skills — it updates itself from everything you do. Let's start." },
  ];
  const [i, setI] = useState(0);
  useEffect(() => { tts.say(`${steps[i].title}. ${steps[i].text}`); return () => tts.stop(); }, [i]); // spoken, proactive
  return (
    <div style={{ position: "fixed", inset: 0, background: "#152521cc", zIndex: 80, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div className="rise" key={i} style={{ background: kid ? KID_BG : "#fff", borderRadius: "24px 24px 0 0", padding: 24, width: "100%", maxWidth: 520 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <Orb accent={accent} size={52} speaking={tts.speaking} />
          <div style={{ flex: 1 }}>
            <div className="f-display" style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>{steps[i].title}</div>
            <div className="f-body" style={{ fontSize: 15, color: "#3E4E49", lineHeight: 1.5 }}>{steps[i].text}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          <Btn ghost small onClick={() => { tts.stop(); onDone(); }}>Skip</Btn>
          <div style={{ flex: 1 }} />
          {steps.map((_, d) => <span key={d} style={{ width: 6, height: 6, borderRadius: 3, background: d === i ? accent : LINE, alignSelf: "center", margin: "0 2px" }} />)}
          <div style={{ flex: 1 }} />
          <Btn small accent={accent} onClick={() => i < steps.length - 1 ? setI(i + 1) : (tts.stop(), onDone())}>
            {i < steps.length - 1 ? "Next" : kid ? "Let's play!" : "Let's begin"} <ArrowRight size={14} />
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── parent PIN pad ────────────────────────── */

function PinPad({ mode, title, pinHash, onSuccess, onSet, onClose }) {
  // mode: 'verify' | 'create'
  const [pin, setPin] = useState("");
  const [stage, setStage] = useState(0); // create: 0 choose · 1 confirm
  const [first, setFirst] = useState("");
  const [err, setErr] = useState(false);
  const [checking, setChecking] = useState(false);

  const subtitle = mode === "verify" ? "Enter the parent PIN"
    : stage === 0 ? "Choose a 4-digit PIN" : "Enter it again to confirm";

  const fail = () => { setErr(true); setPin(""); setTimeout(() => setErr(false), 450); };

  const complete = async (full) => {
    setChecking(true);
    if (mode === "verify") {
      const h = await sha256(full);
      if (h === pinHash) { onSuccess(); } else fail();
    } else if (stage === 0) {
      setFirst(full); setPin(""); setStage(1);
    } else {
      if (full === first) { await onSet(full); } else { setStage(0); setFirst(""); fail(); }
    }
    setChecking(false);
  };

  const press = (d) => {
    if (checking) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) setTimeout(() => complete(next), 120);
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
  return (
    <div style={{ position: "fixed", inset: 0, background: "#152521d9", zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      role="dialog" aria-modal="true" aria-label={title}>
      <div className={`rise${err ? " shake" : ""}`} style={{ background: "#fff", borderRadius: 24, padding: "26px 24px", width: "100%", maxWidth: 320, textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
          <div style={{ width: 44, height: 44, borderRadius: 14, background: MIST, display: "flex", alignItems: "center", justifyContent: "center" }}>🔒</div>
        </div>
        <div className="f-display" style={{ fontSize: 19, fontWeight: 600 }}>{title}</div>
        <div className="f-body" style={{ fontSize: 13.5, color: err ? "#A0453A" : FADE, marginTop: 3, marginBottom: 16 }}>
          {err ? (mode === "create" ? "PINs didn't match — start over" : "Wrong PIN — try again") : subtitle}
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 12, marginBottom: 20 }} aria-label={`${pin.length} of 4 digits entered`}>
          {[0, 1, 2, 3].map(i => (
            <span key={i} style={{ width: 14, height: 14, borderRadius: 7, border: `1.5px solid ${pin.length > i ? INK : LINE}`, background: pin.length > i ? INK : "transparent", transition: "all .15s" }} />
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {keys.map((k, i) => k === "" ? <span key={i} /> : (
            <button key={i} className="f-body"
              onClick={() => k === "⌫" ? setPin(pin.slice(0, -1)) : press(k)}
              aria-label={k === "⌫" ? "Delete" : k}
              style={{ padding: "13px 0", borderRadius: 14, border: `1.5px solid ${LINE}`, background: "#fff", fontSize: 18, fontWeight: 600, cursor: "pointer", color: INK }}>
              {k}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="f-body" style={{ ...backLink, marginTop: 16 }}>Cancel</button>
      </div>
    </div>
  );
}

/* ─────────────── live mic level meter (waveform bars) ────────────────── */

function MicMeter({ active, accent }) {
  const barsRef = useRef([]);
  const [fallback, setFallback] = useState(false);
  const BINS = [2, 4, 6, 9, 12, 16, 20];

  useEffect(() => {
    if (!active) return;
    let raf, ctx, stream, stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.72;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const loop = () => {
          if (stopped) return;
          analyser.getByteFrequencyData(data);
          barsRef.current.forEach((el, i) => {
            if (!el) return;
            const v = data[BINS[i]] || 0;
            el.style.height = `${7 + (v / 255) * 30}px`;
            el.style.opacity = String(0.45 + v / 460);
          });
          raf = requestAnimationFrame(loop);
        };
        loop();
      } catch { setFallback(true); } // meter unavailable → gentle CSS bounce instead
    })();
    return () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      try { stream?.getTracks().forEach(t => t.stop()); } catch {}
      try { ctx?.close(); } catch {}
    };
  }, [active]);

  return (
    <div style={{ height: 40, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 4, marginTop: 8 }} aria-hidden="true">
      {active && BINS.map((_, i) => (
        <span key={i} ref={el => (barsRef.current[i] = el)}
          className={fallback ? "bar-fallback" : ""}
          style={{
            width: 5, height: 7, borderRadius: 3, background: accent, opacity: 0.45,
            transition: fallback ? "none" : "height .06s linear, opacity .06s linear",
            animationDelay: fallback ? `${i * 0.12}s` : undefined,
          }} />
      ))}
    </div>
  );
}

/* ─────── live voice style panel — changes apply to the next line ────── */

const KID_PRAISE = ["¡Increíble! 🌟", "You're on fire! 🔥", "¡Súper! 🎉", "Wow, so smart! 🧠", "¡Perfecto! ⭐", "Amazing job! 🦄"];
const STICKERS = ["🦄", "🐸", "🚀", "🌈", "🍩", "🐙", "🏆", "🪁", "🦖", "🧸", "🍉", "⚡"];

function Confetti({ burst }) {
  if (!burst) return null;
  const bits = ["🎉", "⭐", "✨", "🌟", "🎈"];
  return (
    <div key={burst} style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 70 }} aria-hidden="true">
      {Array.from({ length: 14 }).map((_, i) => (
        <span key={i} style={{
          position: "absolute", left: `${5 + i * 6.6}%`, top: "-6%", fontSize: 18 + (i % 3) * 9,
          animation: `confetti-fall ${0.9 + (i % 5) * 0.16}s ease-in forwards`, animationDelay: `${(i % 4) * 0.07}s`,
        }}>{bits[i % bits.length]}</span>
      ))}
    </div>
  );
}

function VoiceStylePanel({ member, update, tts, accent }) {
  const kid = member.ageBand === "child";
  const shapeNow = voiceShape(member);
  const preview = () => {
    const t = tutorFor(member);
    tts.say(member.profile.target === "es"
      ? `¡Hola! Soy ${t.name}. ¿Listo para practicar?`
      : `Hi! I'm ${t.name}. Ready to practice together?`);
  };
  const row = (title) => ({ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.5, color: FADE, margin: "10px 0 6px" });
  return (
    <div>
      <div className="f-body" style={row()}>TUTOR</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {personasFor(member.ageBand).map(([key, per]) => (
          <Chip key={key} label={`${per.emoji} ${per.name}`} accent={accent} selected={member.personality === key}
            onClick={() => update({ ...member, personality: key })} />
        ))}
      </div>
      {kid && (
        <>
          <div className="f-body" style={row()}>VOICE</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Object.entries(KID_VOICES).map(([key, kv]) => (
              <Chip key={key} label={`${kv.emoji} ${kv.label}`} accent={accent}
                selected={(member.kidVoice || (shapeNow.gender === "f" ? "girl" : "boy")) === key}
                onClick={() => update({ ...member, kidVoice: key })} />
            ))}
          </div>
        </>
      )}
      <div className="f-body" style={row()}>STYLE</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {Object.entries(VOICE_STYLES).map(([key, st]) => (
          <Chip key={key} label={`${st.emoji} ${st.label}`} accent={accent}
            selected={(member.voiceStyle || "natural") === key}
            onClick={() => update({ ...member, voiceStyle: key })} />
        ))}
      </div>
      <div className="f-body" style={row()}>SPEED</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {Object.keys(SPEEDS).map(sp => (
          <Chip key={sp} label={sp === "slow" ? "🐢 Slow" : sp === "normal" ? "▶️ Normal" : "⚡ Native"} accent={accent}
            selected={(member.speed || "normal") === sp}
            onClick={() => update({ ...member, speed: sp })} />
        ))}
      </div>
      <div style={{ marginTop: 14 }}>
        <Btn small ghost onClick={preview}><Volume2 size={15} /> Hear it now</Btn>
      </div>
    </div>
  );
}

/* ───────── "Say it" — client for the speech-scoring pipeline ──────── */

function PracticeSay({ target, lang, accent, onScore }) {
  const [phase, setPhase] = useState("idle"); // idle | rec | busy | done | err
  const [result, setResult] = useState(null);
  const recRef = useRef(null), chunksRef = useRef([]), srRef = useRef(null);
  const trRef = useRef({ t: "", c: null }), streamRef = useRef(null), timerRef = useRef(null);

  const stopAll = () => {
    try { srRef.current?.stop(); } catch {}
    try { if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop(); } catch {}
  };
  useEffect(() => () => { clearTimeout(timerRef.current); stopAll(); try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch {} }, []);

  const begin = async () => {
    const perm = await ensureMicPermission();
    if (!perm.ok) { setPhase("err"); return; }
    trRef.current = { t: "", c: null }; chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      recRef.current = rec;
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        try { stream.getTracks().forEach(t => t.stop()); } catch {}
        setPhase("busy");
        try {
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
          const audioB64 = blob.size > 0 && blob.size < 900000
            ? await new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => res(null); r.readAsDataURL(blob); })
            : null;
          const r = isSupabase()
            // no acoustic ASR proxy in Supabase mode — score straight off the browser's own transcript
            ? { ...scoreUtterance({ expected: target, heard: trRef.current.t, lang: lang === "es" ? "es" : "en", overallConf: trRef.current.c }), heard: trRef.current.t, provider: "browser" }
            : await srv("/api/speech/score", { method: "POST", body: { expected: target, lang, transcript: trRef.current.t, confidence: trRef.current.c, audioB64, mime: blob.type } });
          setResult(r); setPhase("done");
          sfx(r.overall >= 85 ? "ding" : "soft");
          onScore && onScore(r.overall / 100);
        } catch { setPhase("err"); }
      };
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR) {
        const sr = new SR();
        sr.lang = LANGS[lang].sttHints[0];
        sr.interimResults = false;
        sr.onresult = (e) => {
          const r0 = e.results[e.results.length - 1][0];
          trRef.current = { t: (trRef.current.t + " " + r0.transcript).trim(), c: typeof r0.confidence === "number" ? r0.confidence : trRef.current.c };
        };
        srRef.current = sr;
        try { sr.start(); } catch {}
      }
      rec.start();
      setPhase("rec");
      sfx("chime");
      timerRef.current = setTimeout(stopAll, 7000);
    } catch { setPhase("err"); }
  };

  const chipColor = (sc) => sc >= 85 ? { bg: "#E3F1EE", fg: "#0E7C6B" } : sc >= 60 ? { bg: "#FAF0DA", fg: "#8A6A1F" } : { bg: "#F9E4E0", fg: "#A0453A" };

  if (phase === "idle") return (
    <Btn small ghost onClick={begin} style={{ marginTop: 4 }}>🎯 Say it — get scored</Btn>
  );
  if (phase === "rec") return (
    <div className="rise" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
      <button onClick={() => { clearTimeout(timerRef.current); stopAll(); }} aria-label="Stop recording"
        style={{ width: 40, height: 40, borderRadius: "50%", border: "none", cursor: "pointer", background: "#C64F3B", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", animation: "pulse-ring 1.4s infinite" }}>
        <MicOff size={18} />
      </button>
      <span className="f-body" style={{ fontSize: 13.5, color: FADE }}>Say: “<b style={{ color: INK }}>{target}</b>” — tap to finish</span>
    </div>
  );
  if (phase === "busy") return (
    <div className="f-body" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13, color: FADE }}>
      <Loader size={15} className="animate-spin" /> Scoring your pronunciation…
    </div>
  );
  if (phase === "err") return (
    <div className="f-body" style={{ marginTop: 8, fontSize: 13, color: "#A0453A" }}>
      Couldn't score that one. <button onClick={() => setPhase("idle")} style={{ background: "none", border: "none", color: FADE, cursor: "pointer", fontSize: 13, textDecoration: "underline" }}>Try again</button>
    </div>
  );
  return (
    <div className="rise" style={{ marginTop: 10, background: MIST, borderRadius: 12, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span className="f-body" style={{ ...pillStyle, fontSize: 12.5, fontWeight: 700, color: result.overall >= 85 ? "#0E7C6B" : result.overall >= 60 ? "#8A6A1F" : "#A0453A" }}>
          🎯 {result.overall}/100
        </span>
        {result.provider === "elevenlabs" && <span className="f-body" style={{ fontSize: 11, color: FADE }}>acoustic scoring</span>}
        <button onClick={() => setPhase("idle")} className="f-body" style={{ marginLeft: "auto", background: "none", border: "none", color: FADE, cursor: "pointer", fontSize: 12.5 }}>
          <RotateCcw size={12} style={{ verticalAlign: -1 }} /> Again
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 6 }}>
        {result.words.map((w, i) => {
          const c = chipColor(w.score);
          return (
            <span key={i} className="f-body" title={w.heard ? `heard: “${w.heard}” · ${w.score}` : "missed"}
              style={{ background: c.bg, color: c.fg, borderRadius: 8, padding: "3px 8px", fontSize: 13.5, fontWeight: 600 }}>
              {w.expected}
            </span>
          );
        })}
      </div>
      {result.advice?.slice(0, 2).map((a, i) => (
        <div key={i} className="f-body" style={{ fontSize: 12.5, color: FADE, lineHeight: 1.45 }}>💡 {a}</div>
      ))}
    </div>
  );
}

/* ─────────────────────────── voice-first Talk ────────────────────────── */

function TalkView({ member, tts, accent, addWords, finish, observeSkill, update }) {
  const [voiceSheet, setVoiceSheet] = useState(false);
  const [coach, setCoach] = useState(true);          // Phase 2: live in-conversation correction
  const [coachFix, setCoachFix] = useState(null);    // {fix, tip} from the last learner turn
  const [fixPractice, setFixPractice] = useState(false);
  const coachRef = useRef(true); coachRef.current = coach;
  const p = member.profile;
  const kid = member.ageBand === "child";
  const tut = tutorFor(member);
  const scenarios = kid ? SCENARIOS_CHILD : SCENARIOS_ADULT;
  const [scenario, setScenario] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const [useKeys, setUseKeys] = useState(false);
  const [muted, setMuted] = useState(false);
  const [convoOn, setConvoOn] = useState(false);
  const [micErr, setMicErr] = useState(false);
  const [aiErr, setAiErr] = useState(null);
  const [debrief, setDebrief] = useState(null);
  const [debriefing, setDebriefing] = useState(false);

  const msgsRef = useRef(msgs); msgsRef.current = msgs;
  const busyRef = useRef(false);
  const mutedRef = useRef(false);
  const convoRef = useRef(false);
  const sttRef = useRef(null);
  const handlersRef = useRef({});

  useEffect(() => () => {
    convoRef.current = false;
    try { (sttRef.current?.cancel || sttRef.current?.stop)?.(); } catch {}
    tts.setEnabled(true); // never leave the app muted
  }, []);

  const sysFor = (sc) =>
    `${memberBrief(member)}\nLIVE VOICE CONVERSATION. Scenario: ${sc.label}. You LEAD — set the scene, play any characters, move things forward, gently stretch difficulty. React like a human ("Mm!", "¡No way!", a small laugh in words). One question max per turn. 1–2 short sentences ONLY.` +
    (coachRef.current ? `\nLIVE COACH MODE: if the learner's last message contained a language error (grammar, word choice, or a clearly wrong form — ignore typos and accents), append ONE final line in exactly this format: ⟦corrected version of their sentence|very short tip in ${member.profile.native === "es" ? "Spanish" : "English"}⟧ — at most one per turn, nothing when there is no real error. Never mention or read this line; it is machine-parsed.` : "");

  const resumeListen = useCallback(() => {
    if (convoRef.current && !busyRef.current) sttRef.current?.start();
  }, []);

  const send = useCallback(async (text, conf = null) => {
    if (!text.trim() || busyRef.current) return;
    const m = [...msgsRef.current, { role: "user", content: text.trim(), conf }];
    setMsgs(m); setTyped(""); setBusy(true); busyRef.current = true;
    if (typeof conf === "number") observeSkill("speaking", Math.max(0.2, Math.min(1, 0.35 + conf * 0.65)));
    setCoachFix(null); setFixPractice(false);
    let reply = "…sorry, say that again?";
    try {
      reply = await askClaude(m.map(({ role, content }) => ({ role, content })), { system: sysFor(scenario), maxTokens: 260 });
      setAiErr(null);
    } catch (e) {
      // Was a bare `catch {}` — any failure (missing API key, 503, network,
      // etc.) silently fell back to the same generic line, so testers only ever
      // saw "sorry, say that again?" and it looked like a mic/understanding
      // problem instead of a broken backend. Surface the real reason now.
      setAiErr(e?.message || "AI request failed");
    }
    // Live coach: peel the machine-parsed correction off the reply before speaking
    const cm = reply.match(/⟦([^|⟧]{1,160})\|([^⟧]{1,160})⟧/);
    if (cm) {
      reply = reply.replace(cm[0], "").trim() || "¡Muy bien!";
      if (coachRef.current) setCoachFix({ fix: cm[1].trim(), tip: cm[2].trim() });
    }
    setMsgs([...m, { role: "assistant", content: reply }]);
    setBusy(false); busyRef.current = false;
    if (!mutedRef.current) tts.say(reply, { onEnd: () => setTimeout(resumeListen, 150) });
    else setTimeout(resumeListen, 150);
  }, [scenario, tts, resumeListen, observeSkill]);

  const sttBrowser = useSTT(p.target, handlersRef);
  const sttStream = useStreamingSTT(p.target, handlersRef);
  const stt = sttStream.supported ? sttStream : sttBrowser;
  sttRef.current = stt;
  handlersRef.current = {
    onFinal: (t, conf) => send(t, conf),
    onEnd: (gotFinal) => { if (!gotFinal) setTimeout(resumeListen, 250); }, // silence → keep listening
    onError: (err) => {
      if (err === "not-allowed" || err === "service-not-allowed" || err === "audio-capture") {
        setConvoOn(false); convoRef.current = false; setMicErr(true); setUseKeys(true);
      } else setTimeout(resumeListen, 400);
    },
  };

  const [micState, setMicState] = useState("unknown"); // unknown | granted | denied | unavailable
  const [permUi, setPermUi] = useState(null);           // null | asking | denied | unavailable
  const [retryFailed, setRetryFailed] = useState(false);

  useEffect(() => { // silent probe so returning users skip the sheet
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: "microphone" })
        .then(st => { if (st.state === "granted" || st.state === "denied") setMicState(st.state); })
        .catch(() => {});
    }
  }, []);

  const wasListening = useRef(false);
  useEffect(() => {
    if (stt.listening && !wasListening.current) sfx("chime");
    wasListening.current = stt.listening;
  }, [stt.listening]);

  const beginConvo = () => {
    setUseKeys(false); setMicErr(false);
    tts.stop();
    setConvoOn(true); convoRef.current = true;
    setTimeout(() => sttRef.current?.start(), 60);
  };

  const startConvo = async () => {
    if (!stt.supported) { setUseKeys(true); return; }
    if (micState !== "granted") {
      setPermUi("asking");
      const r = await ensureMicPermission(); // fires the browser's Allow/Block popup
      setMicState(r.state);
      if (!r.ok) { setPermUi(r.state === "denied" ? "denied" : "unavailable"); return; }
      setPermUi(null);
    }
    beginConvo();
  };

  const retryAfterAllow = async () => {
    setPermUi("asking");
    const r = await ensureMicPermission(true); // force: bypass the stale cached state, test the mic for real
    setMicState(r.state);
    if (r.ok) { setRetryFailed(false); setPermUi(null); beginConvo(); }
    else { setRetryFailed(true); setPermUi(r.state === "denied" ? "denied" : "unavailable"); }
  };
  const stopConvo = () => {
    setConvoOn(false); convoRef.current = false;
    (sttRef.current?.cancel || sttRef.current?.stop)?.(); // discard — a pause must never auto-send a turn
    tts.stop();
  };
  const toggleMute = () => {
    const nv = !muted;
    setMuted(nv); mutedRef.current = nv;
    tts.setEnabled(!nv);
    if (nv) { tts.stop(); setTimeout(resumeListen, 100); } // stay in the loop, silently
  };

  const start = async (sc) => {
    setScenario(sc); setBusy(true); busyRef.current = true; setDebrief(null); setMsgs([]); setMicErr(false);
    let opener = kid ? "Hi! Ready to play?" : "Hi! Ready when you are.";
    try {
      opener = await askClaude("Open with one short, inviting spoken line.", { system: sysFor(sc), maxTokens: 120 });
      setAiErr(null);
    } catch (e) {
      setAiErr(e?.message || "AI request failed");
    }
    setMsgs([{ role: "assistant", content: opener }]);
    setBusy(false); busyRef.current = false;
    const autoMic = stt.supported && micState === "granted";
    if (autoMic) { setConvoOn(true); convoRef.current = true; }
    if (!mutedRef.current) tts.say(opener, { onEnd: () => setTimeout(resumeListen, 150) });
    else setTimeout(resumeListen, 150);
  };

  const endAndDebrief = async () => {
    stopConvo(); setDebriefing(true);
    const userTurns = msgs.filter(m => m.role === "user").length;
    try {
      const transcript = msgs.map(m => `${m.role === "user" ? "LEARNER" : "TUTOR"}: ${m.content}`).join("\n");
      const d = await askClaude(
        `Transcript:\n${transcript}\n\nGive a ${kid ? "super gentle, fun, child-friendly" : "warm"} coaching debrief. Respond ONLY with JSON, no fences:
{"praise":"1 specific sentence in ${p.native}","corrections":[{"you":"...","better":"natural ${LANGS[p.target].name}","why":"short, in ${p.native}"}],"newWords":[{"term":"...","translation":"${p.native}","example":"..."}],"tip":"one confidence sentence in ${p.native}"}
Max ${kid ? 1 : 3} corrections (empty array if none), max ${kid ? 2 : 3} newWords.`,
        { json: true, maxTokens: 600 });
      setDebrief(d);
      const obs = d.corrections?.length ? Math.max(0.25, 1 - d.corrections.length * 0.22) : 0.95;
      observeSkill("speaking", obs);
      if (userTurns >= 3) observeSkill("comprehension", 0.75);
      tts.say(d.praise);
    } catch {
      setDebrief({ praise: "Good session — the debrief didn't load, but the practice counts.", corrections: [], newWords: [], tip: "" });
    }
    setDebriefing(false);
  };

  const closeOut = () => {
    if (debrief?.newWords?.length) addWords(debrief.newWords);
    finish(15 + Math.min(msgs.filter(m => m.role === "user").length * 4, 40));
    setScenario(null); setMsgs([]); setDebrief(null);
  };

  const voiceSheetUi = (
    <>
      {voiceSheet && (
        <div onClick={() => setVoiceSheet(false)} style={{ position: "fixed", inset: 0, background: "#15252199", zIndex: 80, display: "flex", alignItems: "flex-end", justifyContent: "center" }} role="dialog" aria-modal="true" aria-label="Voice settings">
          <div onClick={e => e.stopPropagation()} className="rise" style={{ background: "#fff", borderRadius: "22px 22px 0 0", padding: "18px 20px 26px", width: "100%", maxWidth: 520 }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
              <div className="f-display" style={{ fontSize: 19, fontWeight: 600, flex: 1 }}>Voice, live 🎛️</div>
              <Btn small ghost onClick={() => setVoiceSheet(false)}>Done</Btn>
            </div>
            <p className="f-body" style={{ fontSize: 12.5, color: FADE, margin: "0 0 4px" }}>Changes apply to the very next thing {tut.name} says — even mid-conversation.</p>
            <div style={{ margin: "6px 0 2px" }}>
              <Chip label={coach ? "🩹 Live coaching: ON" : "🩹 Live coaching: OFF"} accent={accent} selected={coach} onClick={() => setCoach(c => !c)} />
            </div>
            <VoiceStylePanel member={member} update={update} tts={tts} accent={accent} />
          </div>
        </div>
      )}
    </>
  );

  if (!scenario) return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <h1 className="f-display" style={{ fontSize: 28, fontWeight: 600, marginBottom: 4, flex: 1 }}>{kid ? `Talk with ${tut.name}! ${tut.emoji}` : `Talk with ${tut.name}`}</h1>
        <button onClick={() => setVoiceSheet(true)} aria-label="Voice settings" style={{ ...roundBtn(40), flexShrink: 0 }}><SlidersHorizontal size={17} color={FADE} /></button>
      </div>
      <div style={{ display: "flex", gap: 8, margin: "6px 0 4px" }}>
        <Chip label={coach ? (kid ? `🩹 ${tut.name} helps right away: ON` : "🩹 Live coaching: ON") : "🩹 Live coaching: OFF"}
          accent={accent} selected={coach} onClick={() => setCoach(c => !c)} />
      </div>
      <p className="f-body" style={{ color: FADE, marginBottom: 18 }}>
        {kid ? `Pick an adventure and just talk — ${tut.name} talks back!` : `A real spoken conversation: ${tut.name} leads, plays every character, and saves corrections for the end.`}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {scenarios.map(s => (
          <Card key={s.id} onClick={() => start(s)} style={{ padding: 16, background: kid ? KID_CARD : "#fff", border: kid ? "none" : undefined }}>
            <div style={{ fontSize: 26, marginBottom: 6 }} className={kid ? "floaty" : ""}>{s.emoji}</div>
            <div className="f-body" style={{ fontWeight: 600, fontSize: 14.5 }}>{s.label}</div>
          </Card>
        ))}
      </div>
      {!stt.supported && <p className="f-body" style={{ fontSize: 12.5, color: "#9AA8A3", marginTop: 14 }}>Voice input needs Chrome or Edge — here you type instead, and {tut.name} still speaks aloud.</p>}
      {voiceSheetUi}
    </div>
  );

  if (debriefing) return <Thinking accent={accent} label={`${tut.name} is writing your debrief…`} />;

  if (debrief) {
    const confs = msgs.filter(m => m.role === "user" && typeof m.conf === "number").map(m => m.conf);
    const avgConf = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;
    return (
    <div className="rise">
      <h1 className="f-display" style={{ fontSize: 26, fontWeight: 600, marginBottom: 14 }}>{kid ? "You did it! 🌟" : "Your debrief"}</h1>
      <Card style={{ marginBottom: 12, background: LANGS[p.target].soft, border: "none" }}>
        <div className="f-body" style={{ fontSize: 15 }}>⭐ {debrief.praise}</div>
        {avgConf !== null && (
          <div className="f-body" style={{ fontSize: 13, color: FADE, marginTop: 6 }}>
            {kid ? `🎤 Talking clarity: ${"⭐".repeat(avgConf >= 0.85 ? 3 : avgConf >= 0.6 ? 2 : 1)} across ${confs.length} turn${confs.length > 1 ? "s" : ""}` : `🎯 Average speaking clarity: ${Math.round(avgConf * 100)}% across ${confs.length} spoken turn${confs.length > 1 ? "s" : ""}`}
          </div>
        )}
      </Card>
      {debrief.corrections?.map((c, i) => (
        <Card key={i} style={{ marginBottom: 10, padding: 16 }}>
          <div className="f-body" style={{ fontSize: 14, color: "#A0453A", textDecoration: "line-through" }}>{c.you}</div>
          <div className="f-body" style={{ fontSize: 15.5, fontWeight: 600, margin: "3px 0" }}>{c.better}
            <button onClick={() => tts.say(c.better)} aria-label="Hear it" style={iconBtn}><Volume2 size={14} color={FADE} /></button>
          </div>
          <div className="f-body" style={{ fontSize: 13, color: FADE }}>{c.why}</div>
          {isServer() && <PracticeSay target={c.better} lang={p.target} accent={accent} onScore={(sc) => observeSkill("speaking", sc)} />}
        </Card>
      ))}
      {debrief.corrections?.length === 0 && <Card style={{ marginBottom: 10 }}><div className="f-body" style={{ fontSize: 14.5 }}>No corrections — clean session. 🎯</div></Card>}
      {debrief.newWords?.length > 0 && (
        <Card style={{ marginBottom: 10, padding: 16 }}>
          <div className="f-body" style={{ fontSize: 12.5, fontWeight: 700, color: accent, letterSpacing: 1, marginBottom: 8 }}>NEW WORDS → {kid ? "YOUR TREASURE CHEST" : "YOUR DECK"}</div>
          {debrief.newWords.map((w, i) => <div key={i} className="f-body" style={{ fontSize: 14.5, marginBottom: 4 }}><b>{w.term}</b> — {w.translation}</div>)}
        </Card>
      )}
      {debrief.tip && <p className="f-body" style={{ fontSize: 13.5, color: FADE, margin: "4px 2px 14px" }}>💪 {debrief.tip}</p>}
      <Btn full accent={accent} onClick={closeOut}><Star size={16} /> {kid ? "Collect stars!" : "Finish & claim XP"}</Btn>
    </div>
    );
  }

  const lastTutor = [...msgs].reverse().find(m => m.role === "assistant");
  const lastUser = [...msgs].reverse().find(m => m.role === "user");
  const statusLabel = busy ? `${tut.name.toUpperCase()} IS THINKING…`
    : tts.speaking ? `${tut.name.toUpperCase()} IS TALKING`
    : stt.listening ? "LISTENING — GO AHEAD"
    : convoOn ? "YOUR TURN — SPEAK ANYTIME"
    : kid ? "TAP THE BIG CIRCLE TO TALK!" : "TAP THE MIC TO START";

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "68vh" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 22 }}>{scenario.emoji}</span>
        <div className="f-body" style={{ fontWeight: 600, flex: 1 }}>{scenario.label}</div>
        <Btn ghost small onClick={endAndDebrief} disabled={!msgs.some(m => m.role === "user")}>End & debrief</Btn>
      </div>

      {/* voice stage */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "8px 4px" }}>
        <Orb accent={accent} size={kid ? 130 : 110} speaking={tts.speaking || stt.listening} active={true} />
        <MicMeter active={stt.listening} accent={accent} />
        <div className="f-body" style={{ marginTop: 4, fontSize: 12.5, fontWeight: 700, letterSpacing: 1, color: stt.listening ? accent : FADE }}>
          {statusLabel}
        </div>
        {lastTutor && (
          <div className="f-display rise" key={lastTutor.content} style={{ fontSize: kid ? 21 : 19, fontWeight: 600, lineHeight: 1.4, margin: "14px 0 6px", maxWidth: 420 }}>
            “{lastTutor.content}”
            <button onClick={() => tts.say(lastTutor.content)} aria-label="Replay" style={iconBtn}><Volume2 size={16} color={FADE} /></button>
          </div>
        )}
        {(stt.interim || lastUser) && (
          <div className="f-body" style={{ fontSize: 14.5, color: stt.interim ? accent : FADE, marginTop: 6, minHeight: 20 }}>
            {stt.interim ? <i>“{stt.interim}…”</i> : <>You: “{lastUser.content}”</>}
          </div>
        )}
        {!stt.interim && typeof lastUser?.conf === "number" && (
          <div className="rise f-body" key={msgs.length} style={{
            ...pillStyle, marginTop: 8, fontSize: 12.5,
            color: lastUser.conf >= 0.85 ? "#0E7C6B" : lastUser.conf >= 0.6 ? "#8A6A1F" : "#A0453A",
            borderColor: lastUser.conf >= 0.85 ? "#0E7C6B44" : lastUser.conf >= 0.6 ? "#D9A44166" : "#C64F3B55",
          }}>
            {kid
              ? <>🎤 {"⭐".repeat(lastUser.conf >= 0.85 ? 3 : lastUser.conf >= 0.6 ? 2 : 1)} {lastUser.conf >= 0.85 ? "Super clear talking!" : lastUser.conf >= 0.6 ? "Nice and clear!" : "Try a little louder!"}</>
              : <>🎯 Clarity {Math.round(lastUser.conf * 100)}% {lastUser.conf >= 0.85 ? "— crisp" : lastUser.conf >= 0.6 ? "— good" : "— try slower & louder"}</>}
          </div>
        )}
        {coachFix && (
          <div className="rise" style={{ marginTop: 12, maxWidth: 420, width: "100%", background: "#FBEAE4", border: "1px solid #E8C4B8", borderRadius: 16, padding: "12px 14px", textAlign: "left" }}>
            <div className="f-body" style={{ fontSize: 12, fontWeight: 700, letterSpacing: .5, color: "#A0453A", marginBottom: 4 }}>
              {kid ? `${tut.emoji} ${tut.name.toUpperCase()} SAYS TRY:` : "🩹 QUICK FIX"}
            </div>
            <div className="f-body" style={{ fontSize: 15, fontWeight: 600 }}>
              “{coachFix.fix}”
              <button onClick={() => tts.say(coachFix.fix)} aria-label="Hear the correct version" style={iconBtn}><Volume2 size={15} color="#A0453A" /></button>
            </div>
            <div className="f-body" style={{ fontSize: 12.5, color: "#8A5245", marginTop: 3 }}>{coachFix.tip}</div>
            {!fixPractice ? (
              <div style={{ marginTop: 8 }}>
                <Btn small ghost onClick={() => { stopConvo(); setFixPractice(true); }}>🎯 {kid ? "Say it with me!" : "Say it — get scored"}</Btn>
              </div>
            ) : (
              <div style={{ marginTop: 8 }}>
                <PracticeSay target={coachFix.fix} lang={p.target} accent={accent}
                  onScore={(sc) => { observeSkill("speaking", Math.max(0.2, sc / 100)); if (sc >= 60) sfx("ding"); }} />
                <Btn small ghost onClick={() => { setCoachFix(null); setFixPractice(false); startConvo(); }} style={{ marginTop: 6 }}>Back to the conversation →</Btn>
              </div>
            )}
          </div>
        )}
        {micErr && <div className="f-body" style={{ fontSize: 12.5, color: "#A0453A", marginTop: 8 }}>Microphone access was blocked — you can type below, and {tut.name} will still talk.</div>}
        {aiErr && <div className="f-body" style={{ fontSize: 12.5, color: "#A0453A", marginTop: 8 }}>AI backend error: {aiErr} — check that the AI provider key is set on the server.</div>}
      </div>

      {/* controls */}
      {!useKeys && stt.supported ? (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, paddingBottom: 4 }}>
            <button onClick={() => setVoiceSheet(true)} aria-label="Voice settings" style={roundBtn()}><SlidersHorizontal size={19} color={FADE} /></button>
            <button onClick={() => { stopConvo(); setUseKeys(true); }} aria-label="Type instead" style={roundBtn()}><Keyboard size={19} color={FADE} /></button>
            <button
              onClick={() => (convoOn ? stopConvo() : startConvo())}
              aria-label={convoOn ? "Pause conversation" : "Start conversation"}
              style={{
                width: 84, height: 84, borderRadius: "50%", border: "none", cursor: "pointer",
                background: convoOn ? "#C64F3B" : accent, color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                animation: stt.listening ? "pulse-ring 1.4s infinite" : "none",
                transition: "background .2s",
              }}>
              {convoOn ? <MicOff size={32} /> : <Mic size={32} />}
            </button>
            <button onClick={toggleMute} aria-label={muted ? "Unmute tutor voice" : "Mute tutor voice"} aria-pressed={muted}
              style={{ ...roundBtn(), background: muted ? "#C64F3B" : "#fff", borderColor: muted ? "#C64F3B" : LINE }}>
              {muted ? <VolumeX size={19} color="#fff" /> : <Volume2 size={19} color={FADE} />}
            </button>
          </div>
          <p className="f-body" style={{ fontSize: 12, color: "#9AA8A3", textAlign: "center", margin: "2px 0 0" }}>
            {convoOn
              ? (kid ? "Just talk — then listen. Tap the red button when you're done." : "Speak naturally — the mic reopens after each reply. Tap to pause.")
              : (kid ? "One tap starts the whole chat!" : "One tap starts a hands-free conversation.")}
            {stt.engine === "stream" ? " · live server transcription" : ""}
            {muted ? ` · ${tut.name} is muted (replies show as text).` : ""}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          {stt.supported && <button onClick={startConvo} aria-label="Use voice" style={roundBtn(48)}><Mic size={19} color={FADE} /></button>}
          <input value={typed} onChange={e => setTyped(e.target.value)} onKeyDown={e => e.key === "Enter" && send(typed)}
            placeholder={`Reply in ${LANGS[p.target].name}…`} className="f-body" style={{ ...inputStyle, margin: 0, flex: 1 }} aria-label="Your reply" />
          <Btn accent={accent} onClick={() => send(typed)} disabled={busy || !typed.trim()} style={{ padding: "13px 16px" }} aria-label="Send">
            {busy ? <Loader size={17} className="animate-spin" /> : <Send size={17} />}
          </Btn>
        </div>
      )}

      {voiceSheetUi}

      {permUi && (
        <div style={{ position: "fixed", inset: 0, background: "#152521d9", zIndex: 85, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} role="dialog" aria-modal="true">
          <div className="rise" style={{ background: "#fff", borderRadius: 24, padding: "26px 24px", width: "100%", maxWidth: 340, textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>{permUi === "asking" ? "🎙️" : permUi === "denied" ? "🔇" : "😕"}</div>
            {permUi === "asking" && (
              <>
                <div className="f-display" style={{ fontSize: 20, fontWeight: 600, marginBottom: 6 }}>Can we use your microphone?</div>
                <p className="f-body" style={{ fontSize: 14.5, color: FADE, lineHeight: 1.55 }}>
                  Your browser is asking right now — look for the popup {kid ? "and press the Allow button! ☝️" : "(usually near the address bar) and choose Allow."}
                </p>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, margin: "14px 0 4px" }}>
                  <Loader size={16} className="animate-spin" color={accent} />
                  <span className="f-body" style={{ fontSize: 13, color: FADE }}>Waiting for permission…</span>
                </div>
              </>
            )}
            {permUi === "denied" && (
              <>
                <div className="f-display" style={{ fontSize: 20, fontWeight: 600, marginBottom: 6 }}>The microphone is blocked</div>
                <p className="f-body" style={{ fontSize: 14, color: FADE, lineHeight: 1.55, marginBottom: retryFailed ? 8 : 14 }}>
                  To talk out loud: tap the 🔒 or 🎙️ icon in your browser's address bar, set Microphone to <b>Allow</b>, then come back here.
                </p>
                {retryFailed && (
                  <p className="f-body" style={{ fontSize: 13, color: "#A0453A", lineHeight: 1.5, marginBottom: 14 }}>
                    Still blocked. Some browsers only apply the change after a reload — reload this page, then tap the mic again.
                  </p>
                )}
                <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                  <Btn small accent={accent} onClick={retryAfterAllow}>I've allowed it</Btn>
                  {retryFailed && <Btn small ghost onClick={() => { try { window.location.reload(); } catch {} }}><RefreshCw size={14} /> Reload</Btn>}
                  <Btn small ghost onClick={() => { setPermUi(null); setUseKeys(true); }}>Type instead</Btn>
                </div>
              </>
            )}
            {permUi === "unavailable" && (
              <>
                <div className="f-display" style={{ fontSize: 20, fontWeight: 600, marginBottom: 6 }}>No microphone found</div>
                <p className="f-body" style={{ fontSize: 14, color: FADE, lineHeight: 1.55, marginBottom: 14 }}>
                  This device or window can't access a microphone right now. You can type — {tut.name} will still talk out loud.
                </p>
                <Btn small accent={accent} onClick={() => { setPermUi(null); setUseKeys(true); }}>Type instead</Btn>
              </>
            )}
            {permUi === "asking" && (
              <button onClick={() => setPermUi(null)} className="f-body" style={{ ...backLink, marginTop: 10 }}>Cancel</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
const iconBtn = { background: "none", border: "none", cursor: "pointer", padding: 0, marginLeft: 8, verticalAlign: -2 };
const roundBtn = (s = 46) => ({ width: s, height: s, borderRadius: "50%", border: `1.5px solid ${LINE}`, background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" });

/* ─────────────────────────── Story mode (child) ──────────────────────── */

function StoryView({ member, tts, accent, addWords, finish, observeSkill }) {
  const p = member.profile;
  const tut = tutorFor(member);
  const [story, setStory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);
  const [si, setSi] = useState(0);
  const [answered, setAnswered] = useState(null);
  const [stars, setStars] = useState(0);
  const [done, setDone] = useState(false);

  const generate = async () => {
    setLoading(true); setErr(false); setStory(null); setSi(0); setStars(0); setDone(false);
    try {
      const s = await askClaude(
        `${memberBrief(member)}\n\nWrite a 5-scene interactive picture story for this child about one of their interests. Respond ONLY with JSON, no fences:
{"title":"fun title in ${p.native}","scenes":[{"emoji":["3-5 emoji that paint the scene"],"bg":["#hex","#hex"],"text":"1-2 VERY short ${LANGS[p.target].name} sentences (level ${p.level})","gloss":"${p.native} meaning","question":null or {"prompt":"playful question in ${p.native} about the scene or a ${LANGS[p.target].name} word in it","options":["3 short options"],"answer":0}}],"words":[{"term":"${LANGS[p.target].name} word from the story","translation":"${p.native}","example":"short line"}],"ending":"one happy closing line in ${p.native}"}
Scenes 2 and 4 must include a question; others null. Soft pastel bg colors. Wholesome, silly, magical — never scary. 2 words.`,
        { json: true, maxTokens: 1300 });
      setStory(s);
      tts.say(`${s.title}!`);
    } catch { setErr(true); }
    setLoading(false);
  };

  useEffect(() => {
    if (story && !done) {
      const sc = story.scenes[si];
      tts.say(sc.text);
    }
  }, [story, si, done]);

  const answer = (i) => {
    if (answered !== null) return;
    setAnswered(i);
    const ok = i === story.scenes[si].question.answer;
    sfx(ok ? "ding" : "soft");
    observeSkill("comprehension", ok ? 1 : 0.3);
    if (ok) { setStars(s => s + 1); tts.say(p.native.toLowerCase().startsWith("span") ? "¡Sí! ¡Muy bien!" : "Yes! Amazing!"); }
  };

  const next = () => {
    setAnswered(null);
    if (si < story.scenes.length - 1) setSi(si + 1);
    else {
      setDone(true);
      addWords(story.words || []);
      tts.say(story.ending);
    }
  };

  if (!story && !loading && !err) return (
    <div style={{ textAlign: "center", paddingTop: 20 }}>
      <div className="floaty" style={{ fontSize: 64 }}>📖</div>
      <h1 className="f-display" style={{ fontSize: 28, fontWeight: 600, margin: "10px 0 6px" }}>{`Story time with ${tut.name}`}</h1>
      <p className="f-body" style={{ color: FADE, marginBottom: 20 }}>A brand-new picture story, made just for {member.name} — {tut.name} reads it out loud!</p>
      <Btn accent={accent} onClick={generate}><Wand2 size={17} /> Make me a story!</Btn>
    </div>
  );
  if (loading) return <Thinking accent={accent} label={`${tut.name} is dreaming up your story… ✨`} />;
  if (err) return <ErrorBox retry={generate} />;

  if (done) return (
    <Card className="pop" style={{ textAlign: "center", background: KID_CARD, border: "none" }}>
      <div style={{ fontSize: 52 }} className="pop">🌟</div>
      <h2 className="f-display" style={{ fontSize: 24, fontWeight: 600, margin: "8px 0 4px" }}>The end!</h2>
      <p className="f-body" style={{ fontSize: 15, marginBottom: 8 }}>{story.ending}</p>
      <p className="f-body" style={{ fontSize: 14, color: "#6B5B3E", marginBottom: 6 }}>{stars} star{stars !== 1 ? "s" : ""} earned · new words in your treasure chest:</p>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 16 }}>
        {(story.words || []).map(w => (
          <span key={w.term} className="f-body" style={{ background: "#fff", borderRadius: 999, padding: "6px 12px", fontSize: 13.5, fontWeight: 600 }}>
            {w.term} · {w.translation}
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <Btn ghost small onClick={generate}><Wand2 size={15} /> Another story!</Btn>
        <Btn small accent={accent} onClick={() => finish(20 + stars * 10)}><Star size={15} /> Collect {2 + stars} stars</Btn>
      </div>
    </Card>
  );

  const sc = story.scenes[si];
  return (
    <div>
      <div className="f-body" style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: FADE, marginBottom: 8 }}>
        <span>{story.title}</span><span>Scene {si + 1}/{story.scenes.length} · ⭐ {stars}</span>
      </div>
      <div key={si} className="pop" style={{
        borderRadius: 24, padding: "34px 20px", textAlign: "center",
        background: `linear-gradient(150deg, ${sc.bg?.[0] || "#FFE3B3"}, ${sc.bg?.[1] || "#FFD1DC"})`,
      }}>
        <div style={{ fontSize: 52, letterSpacing: 6, marginBottom: 6 }}>
          {(sc.emoji || []).map((e, i) => (
            <span key={i} className="floaty" style={{ display: "inline-block", animationDelay: `${i * 0.35}s` }}>{e}</span>
          ))}
        </div>
        <div className="f-display" style={{ fontSize: 21, fontWeight: 600, lineHeight: 1.4, color: "#3A3226" }}>
          {sc.text}
          <button onClick={() => tts.say(sc.text)} aria-label="Read again" style={iconBtn}><Volume2 size={17} color="#3A3226" /></button>
        </div>
        <div className="f-body" style={{ fontSize: 14, color: "#6B5B3E", marginTop: 6 }}>{sc.gloss}</div>
      </div>

      {sc.question ? (
        <Card style={{ marginTop: 12 }}>
          <div className="f-body" style={{ fontWeight: 600, fontSize: 15.5, marginBottom: 10 }}>{tut.emoji} {sc.question.prompt}</div>
          {sc.question.options.map((o, i) => {
            const show = answered !== null, isAns = i === sc.question.answer;
            return (
              <button key={i} onClick={() => answer(i)} className="f-body" style={{
                ...optionStyle,
                borderColor: show && isAns ? accent : show && i === answered ? "#C64F3B" : LINE,
                background: show && isAns ? LANGS[p.target].soft : "#fff",
              }}>{show && isAns ? "✅ " : show && i === answered ? "❌ " : ""}{o}</button>
            );
          })}
          {answered !== null && <Btn full accent={accent} onClick={next} style={{ marginTop: 6 }}>Keep going! <ArrowRight size={16} /></Btn>}
        </Card>
      ) : (
        <Btn full accent={accent} onClick={next} style={{ marginTop: 12 }}>Next <ArrowRight size={16} /></Btn>
      )}
    </div>
  );
}

/* ───────────────────────────── Lesson ─────────────────────────────── */

function LessonView({ member, update, tts, accent, addWords, finish, exit, observeSkill, assignedTopic }) {
  const p = member.profile;
  const kid = member.ageBand === "child";
  const [lesson, setLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [stage, setStage] = useState(0);
  const [vi, setVi] = useState(0);
  const [ei, setEi] = useState(0);
  const [picked, setPicked] = useState(null);
  const [correct, setCorrect] = useState(0);

  const generate = useCallback(async () => {
    setLoading(true); setErr(false);
    try {
      const l = await askClaude(
        `${memberBrief(member)}\n\nGenerate today's ${kid ? "playful mini-" : ""}lesson ${assignedTopic ? `on the topic the teacher assigned: "${assignedTopic}" — build the whole lesson around it, flavored with the learner's interests` : "themed on the learner's interests"}. Respond ONLY with JSON, no fences:
{"title":"short title in ${p.native}","intro":"2 ${kid ? "excited, kid-friendly" : "warm"} sentences in ${p.native}","vocab":[{"term":"...","emoji":"one emoji","ipa":"IPA","translation":"${p.native}","example":"short ${LANGS[p.target].name} sentence","exampleGloss":"${p.native}"}],"exercises":[{"prompt":"question, may include a ___ blank","options":["4 options"],"answer":0,"explain":"1 sentence in ${p.native}"}],"culture":"one fun ${kid ? "kid-friendly " : ""}fact in ${p.native}, 1-2 sentences"}
Exactly ${kid ? 4 : 5} vocab items at level ${p.level}, exactly ${kid ? 3 : 4} exercises practicing them. Never test a word before teaching it.`,
        { json: true, maxTokens: 1300 });
      setLesson(l);
      tts.say(l.intro);
    } catch { setErr(true); }
    setLoading(false);
  }, []);
  useEffect(() => { generate(); return () => tts.stop(); }, [generate]);

  const pick = (i) => {
    if (picked !== null) return;
    setPicked(i);
    const ok = i === lesson.exercises[ei].answer;
    if (ok) setCorrect(c => c + 1);
    sfx(ok ? "ding" : "soft");
    observeSkill("grammar", ok ? 1 : 0.2);
    observeSkill("vocabulary", ok ? 0.9 : 0.3);
    if (kid) tts.say(ok ? "Woohoo!" : "Almost! Look!");
  };
  const nextEx = () => {
    setPicked(null);
    if (ei < lesson.exercises.length - 1) setEi(ei + 1);
    else setStage(3);
  };
  const complete = () => {
    addWords(lesson.vocab.map(v => ({ term: v.term, translation: v.translation, example: v.example })));
    finish(30 + correct * 5);
  };

  const tutorName = tutorFor(member).name;
  if (loading) return <Screen exit={exit} title="Today's lesson"><Thinking accent={accent} label={`${tutorName} is writing today's lesson…`} /></Screen>;
  if (err || !lesson) return <Screen exit={exit} title="Today's lesson"><ErrorBox retry={generate} /></Screen>;

  const seg = ["Warm-up", "Words", "Practice", "Done"];
  return (
    <Screen exit={exit} title={lesson.title}>
      <div style={{ display: "flex", gap: 4, marginBottom: 18 }}>
        {seg.map((s, i) => <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= stage ? accent : LINE }} />)}
      </div>

      {stage === 0 && (
        <Card style={kid ? { background: KID_CARD, border: "none" } : {}}>
          <Orb accent={accent} size={52} speaking={tts.speaking} />
          <p className="f-body" style={{ fontSize: 16.5, lineHeight: 1.55, margin: "16px 0 6px" }}>{lesson.intro}</p>
          <p className="f-body" style={{ fontSize: 13.5, color: kid ? "#6B5B3E" : FADE, marginBottom: 18 }}>{lesson.vocab.length} new words · {lesson.exercises.length} {kid ? "games" : "exercises"}</p>
          <Btn full accent={accent} onClick={() => setStage(1)}>{kid ? "Let's play!" : "Let's begin"} <ArrowRight size={16} /></Btn>
        </Card>
      )}

      {stage === 1 && (
        <Card key={vi} style={{ textAlign: "center" }}>
          <div className="f-body" style={{ fontSize: 12.5, fontWeight: 700, color: accent, letterSpacing: 1 }}>WORD {vi + 1} OF {lesson.vocab.length}</div>
          <div style={{ fontSize: 40, margin: "10px 0 0" }} className={kid ? "floaty" : ""}>{lesson.vocab[vi].emoji}</div>
          <div className="f-display" style={{ fontSize: 34, fontWeight: 600, margin: "6px 0 2px" }}>{lesson.vocab[vi].term}</div>
          {!kid && <div className="f-body" style={{ color: FADE, fontFamily: "ui-monospace, monospace", fontSize: 14 }}>{lesson.vocab[vi].ipa}</div>}
          <div className="f-body" style={{ fontSize: 17, margin: "10px 0 4px" }}>{lesson.vocab[vi].translation}</div>
          <div style={{ background: MIST, borderRadius: 14, padding: "12px 14px", margin: "12px 0" }}>
            <div className="f-body" style={{ fontSize: 15.5, fontWeight: 500 }}>{lesson.vocab[vi].example}</div>
            <div className="f-body" style={{ fontSize: 13.5, color: FADE, marginTop: 3 }}>{lesson.vocab[vi].exampleGloss}</div>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <Btn ghost small onClick={() => tts.say(`${lesson.vocab[vi].term}. ${lesson.vocab[vi].example}`)}><Volume2 size={16} /> Hear it</Btn>
            <Btn small accent={accent} onClick={() => vi < lesson.vocab.length - 1 ? setVi(vi + 1) : setStage(2)}>
              {vi < lesson.vocab.length - 1 ? "Next" : kid ? "Play games!" : "Practice"} <ArrowRight size={15} />
            </Btn>
          </div>
          {isServer() && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
              <PracticeSay target={lesson.vocab[vi].term} lang={p.target} accent={accent} onScore={(sc) => observeSkill("speaking", Math.max(0.2, sc / 100))} />
            </div>
          )}
        </Card>
      )}

      {stage === 2 && (
        <Card key={ei}>
          <div className="f-body" style={{ fontSize: 12.5, fontWeight: 700, color: accent, letterSpacing: 1, marginBottom: 10 }}>{kid ? "GAME" : "PRACTICE"} {ei + 1} OF {lesson.exercises.length}</div>
          <div className="f-body" style={{ fontSize: 17, fontWeight: 600, marginBottom: 14 }}>{lesson.exercises[ei].prompt}</div>
          {lesson.exercises[ei].options.map((o, i) => {
            const isAns = i === lesson.exercises[ei].answer, show = picked !== null;
            return (
              <button key={i} onClick={() => pick(i)} className="f-body" style={{
                ...optionStyle,
                borderColor: show && isAns ? accent : show && i === picked ? "#C64F3B" : LINE,
                background: show && isAns ? LANGS[p.target].soft : "#fff",
              }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {show && isAns && <Check size={16} color={accent} />}
                  {show && i === picked && !isAns && <X size={16} color="#C64F3B" />}
                  {o}
                </span>
              </button>
            );
          })}
          {picked !== null && (
            <div className="rise">
              <p className="f-body" style={{ fontSize: 14, color: FADE, margin: "8px 0 12px" }}>
                <CornerDownRight size={13} style={{ verticalAlign: -2 }} /> {lesson.exercises[ei].explain}
              </p>
              <Btn full accent={accent} onClick={nextEx}>{ei < lesson.exercises.length - 1 ? "Next" : "Finish"} <ArrowRight size={16} /></Btn>
            </div>
          )}
        </Card>
      )}

      {stage === 3 && (
        <Card style={{ textAlign: "center", background: kid ? KID_CARD : "#fff", border: kid ? "none" : undefined }}>
          <div style={{ display: "flex", justifyContent: "center" }}><Orb accent={GOLD} size={64} /></div>
          <h2 className="f-display" style={{ fontSize: 26, fontWeight: 600, margin: "14px 0 4px" }}>{kid ? "You're a star! 🌟" : "Lesson complete"}</h2>
          <p className="f-body" style={{ color: kid ? "#6B5B3E" : FADE, marginBottom: 4 }}>{correct}/{lesson.exercises.length} correct · {lesson.vocab.length} words saved</p>
          <p className="f-body" style={{ fontSize: 14, background: "#ffffffaa", borderRadius: 12, padding: "10px 14px", margin: "14px 0", textAlign: "left" }}>
            <b>{kid ? "Fun fact!" : "Culture note."}</b> {lesson.culture}
          </p>
          <Btn full accent={accent} onClick={complete}><Star size={16} /> {kid ? `Collect ${Math.ceil((30 + correct * 5) / 10)} stars` : `Claim ${30 + correct * 5} XP`}</Btn>
        </Card>
      )}
    </Screen>
  );
}

const Screen = ({ title, exit, children }) => (
  <div>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <button onClick={exit} className="f-body" aria-label="Exit" style={{ background: "none", border: "none", color: FADE, cursor: "pointer", fontSize: 14, padding: 4 }}>✕</button>
      <div className="f-display" style={{ fontWeight: 600, fontSize: 18 }}>{title}</div>
    </div>
    {children}
  </div>
);

/* ─────────────────────────── Listening Lab ───────────────────────────── */

const CHANNELS = [
  { id: "convo", emoji: "🗣️", label: "Overheard conversation", speakers: 2 },
  { id: "call", emoji: "☎️", label: "Phone call", speakers: 2 },
  { id: "podcast", emoji: "🎙️", label: "Podcast clip", speakers: 2 },
  { id: "voicemail", emoji: "📱", label: "Voicemail", speakers: 1 },
  { id: "news", emoji: "📰", label: "News brief", speakers: 1 },
];

const shuffle = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };

function CourseView({ member, update, patch, tts, accent, addWords, finish, exit, observeSkill }) {
  const p = member.profile;
  const t = p.target, n = p.native === "es" ? "es" : "en";
  const kid = member.ageBand === "child";
  const prog = member.path || {};
  const itemM = (u, i) => (prog[u.id]?.[i]) || 0; // mastery stage 0..5: hear → pick → fill → build → say
  const unitDone = (u) => u.items.every((_, i) => itemM(u, i) >= 5);
  const unitPct = (u) => Math.min(100, Math.round(u.items.reduce((a, _, i) => a + Math.min(itemM(u, i), 5), 0) / (u.items.length * 5) * 100));
  const unlocked = (idx) => idx === 0 || unitDone(PATH_UNITS[idx - 1]);

  const [unit, setUnit] = useState(null);
  const [queue, setQueue] = useState([]);   // [{i}] item indices to work through
  const [misses, setMisses] = useState(0);
  const [picked, setPicked] = useState(null);
  const [order, setOrder] = useState([]);   // builder: tapped words
  const [pool, setPool] = useState([]);     // builder: remaining chips
  const [buildWrong, setBuildWrong] = useState(0);
  const [fillPick, setFillPick] = useState(null);
  const [fillWrong, setFillWrong] = useState(0);
  const [streak, setStreak] = useState(0);
  const [burst, setBurst] = useState(0);
  const [wonSticker, setWonSticker] = useState(null);
  const [creative, setCreative] = useState(null); // {prompt} | {feedback, pass}
  const [creativeDraft, setCreativeDraft] = useState("");
  const [creativeBusy, setCreativeBusy] = useState(false);

  // Functional patch so concurrent skill/word updates never wipe path progress.
  const setMastery = (u, i, m) => {
    const apply = (mem) => ({
      ...mem,
      path: { ...(mem.path || {}), [u.id]: { ...((mem.path || {})[u.id] || {}), [i]: m } },
    });
    if (patch) patch(apply);
    else update(apply(member));
  };

  const openUnit = (u) => {
    const q = u.items.map((_, i) => i).filter(i => itemM(u, i) < 5);
    setUnit(u); setQueue(q); setMisses(0); setStreak(0); resetExercise();
  };
  const resetExercise = () => { setPicked(null); setOrder([]); setPool([]); setBuildWrong(0); setFillPick(null); setFillWrong(0); };

  const cur = unit && queue.length ? { i: queue[0], item: unit.items[queue[0]], m: itemM(unit, queue[0]) } : null;

  useEffect(() => { // builder setup when entering the build stage
    if (cur && cur.m === 3 && pool.length === 0 && order.length === 0) {
      setPool(shuffle(pathEx(cur.item, t).replace(/[.!?¡¿,]/g, "").split(/\s+/)));
    }
  }, [cur?.i, cur?.m]);

  useEffect(() => { // input before output: every stage opens with audio
    if (!cur) return;
    const tm = setTimeout(() => {
      if (cur.m === 0 || cur.m === 2) tts.say(pathEx(cur.item, t));
      else if (cur.m === 1) tts.say(pathTerm(cur.item, t));
    }, 350);
    return () => clearTimeout(tm);
  }, [cur?.i, cur?.m]);

  const advance = (passed) => {
    if (!cur) return;
    sfx(passed ? "ding" : "soft");
    setStreak(st => passed ? st + 1 : 0);
    if (passed && kid) setBurst(b => b + 1);
    let q = queue.slice(1);
    const m2 = passed ? cur.m + 1 : cur.m;
    if (passed) {
      if (m2 < 5) q = [...q, cur.i];                 // interleaved: next stage comes back around
    } else {
      setMisses(x => x + 1);
      q = [...q.slice(0, 2), cur.i, ...q.slice(2)];  // spaced retry — soon, not instantly
    }
    resetExercise();
    setQueue(q);
    if (!q.length) {
      // One atomic write: final mastery (+ optional sticker). A second update(member)
      // used to overwrite path and leave the last item short of mastery 5 — next unit stayed locked.
      const apply = (mem) => {
        let next = {
          ...mem,
          path: { ...(mem.path || {}), [unit.id]: { ...((mem.path || {})[unit.id] || {}), [cur.i]: m2 } },
        };
        if (kid) {
          const owned = mem.stickers || [];
          const avail = STICKERS.filter(x => !owned.includes(x));
          if (avail.length) {
            const pick = avail[Math.floor(Math.random() * avail.length)];
            setWonSticker(pick);
            next = { ...next, stickers: [...owned, pick] };
          }
        }
        return next;
      };
      if (patch) patch(apply);
      else update(apply(member));
      beginCreative();
    } else if (passed) {
      setMastery(unit, cur.i, m2);
    }
  };

  const beginCreative = async () => {
    if (!navigator.onLine || !hasAiAccess()) { finish(25); return; }
    setCreativeBusy(true);
    try {
      const two = shuffle(unit.items).slice(0, 2).map(it => pathTerm(it, t)).join('" y "');
      const c = await askClaude(
        `${memberBrief(member)}\nThe learner just mastered the unit "${unit.title.en}". Respond ONLY with JSON, no fences: {"prompt":"one short creative challenge in ${p.native} asking them to write or say ONE ${LANGS[t].name} sentence using \"${two}\" — make it playful and personal${kid ? ", kid-friendly, from their animal tutor" : ""}"}`,
        { json: true, maxTokens: 200 });
      setCreative({ prompt: c.prompt });
    } catch { finish(25); }
    setCreativeBusy(false);
  };

  const judgeCreative = async () => {
    if (!creativeDraft.trim()) return;
    setCreativeBusy(true);
    try {
      const r = await askClaude(
        `${memberBrief(member)}\nChallenge given: "${creative.prompt}"\nLearner's ${LANGS[t].name} answer: "${creativeDraft}"\nRespond ONLY with JSON, no fences: {"pass":true/false,"feedback":"2 short encouraging sentences in ${p.native}; if there's an error, give the corrected sentence"}`,
        { json: true, maxTokens: 220 });
      setCreative({ ...creative, done: true, pass: !!r.pass, feedback: r.feedback });
      observeSkill("grammar", r.pass ? 1 : 0.4);
      sfx(r.pass ? "chime" : "soft");
    } catch { setCreative({ ...creative, done: true, pass: true, feedback: "" }); }
    setCreativeBusy(false);
  };

  /* ── unit map: curriculum chapters with scrollable unit cards ── */
  if (!unit) {
    const flat = PATH_UNITS;
    const flatIdx = (uid) => flat.findIndex(x => x.id === uid);
    const currentIdx = flat.findIndex((u, i) => unlocked(i) && !unitDone(u));
    const unitsDone = flat.filter(unitDone).length;
    const itemsMastered = flat.reduce((a, u) => a + u.items.filter((_, i) => itemM(u, i) >= 5).length, 0);
    const itemsTotal = flat.reduce((a, u) => a + u.items.length, 0);
    const chapterState = (c) => {
      const us = c.units.map(uid => flat[flatIdx(uid)]);
      const done = us.filter(unitDone).length;
      const open = unlocked(flatIdx(c.units[0]));
      return { done, total: us.length, open };
    };
    return (
      <Screen exit={exit} title={kid ? "Course adventure 🗺️" : "Course path"}>
        <Card style={{ padding: 16, marginBottom: 20, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8, minWidth: 0 }}>
            <div className="f-body" style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: FADE, flex: 1, minWidth: 0 }}>
              {kid ? "🗺️ MY QUEST" : "CURRICULUM"}
            </div>
            <div className="f-body" style={{ fontSize: 12.5, color: FADE, flexShrink: 0, textAlign: "right" }}>
              {unitsDone}/{flat.length} units · {itemsMastered}/{itemsTotal} {kid ? "words won" : "items mastered"}
            </div>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: "#E8EEEB", overflow: "hidden" }} role="progressbar" aria-valuenow={itemsMastered} aria-valuemin={0} aria-valuemax={itemsTotal}>
            <div style={{ height: 8, borderRadius: 4, width: `${itemsTotal ? Math.min(100, (itemsMastered / itemsTotal) * 100) : 0}%`, maxWidth: "100%", background: `linear-gradient(90deg, ${accent}, ${GOLD})`, transition: "width .5s" }} />
          </div>
          {!kid && <p className="f-body" style={{ fontSize: 12.5, color: FADE, margin: "10px 0 0" }}>
            Frequency-first, taught inside real sentences: hear → pick → fill → build → say. Mastery unlocks the next unit.
          </p>}
        </Card>

        {CURRICULUM.map((c, ci) => {
          const st = chapterState(c);
          return (
            <div key={c.id} style={{ marginBottom: 26 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <div className="f-body" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.4, color: st.open ? accent : "#9AA8A3" }}>
                  {kid ? `WORLD ${ci + 1}` : `CHAPTER ${ci + 1}`}
                </div>
                <div className="f-body" style={{ fontSize: 11.5, color: FADE, marginLeft: "auto" }}>
                  {st.done}/{st.total} {st.done === st.total ? "✓" : ""}
                </div>
              </div>
              <h2 className="f-display" style={{ fontSize: 21, fontWeight: 600, margin: "3px 0 2px", color: st.open ? INK : "#9AA8A3" }}>{c.label[n]}</h2>
              <p className="f-body" style={{ fontSize: 12.5, color: FADE, margin: "0 0 10px" }}>{c.blurb[n]}</p>
              <div className="hscroll">
                {c.units.map(uid => {
                  const idx = flatIdx(uid);
                  const u = flat[idx];
                  const open = unlocked(idx), done = unitDone(u), pct = unitPct(u);
                  const current = idx === currentIdx;
                  return (
                    <div key={uid} role="button" tabIndex={open ? 0 : -1}
                      aria-label={`Unit ${idx + 1}: ${u.title[n]}${done ? ", complete" : open ? `, ${pct}% done` : ", locked"}`}
                      onClick={() => open && openUnit(u)}
                      onKeyDown={(e) => { if (open && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openUnit(u); } }}
                      style={{
                        width: 158, background: "#fff", borderRadius: 18, padding: "16px 14px 14px",
                        border: current ? `2px solid ${accent}` : done ? "1.5px solid #BBDCD4" : "1.5px solid #DCE5E1",
                        boxShadow: current ? "0 10px 26px rgba(14,124,107,.18)" : "0 2px 8px rgba(21,37,33,.05)",
                        cursor: open ? "pointer" : "default", opacity: open ? 1 : .55, position: "relative",
                      }}>
                      {done && <span style={{ position: "absolute", top: 10, right: 10, fontSize: 14 }}>✅</span>}
                      {!open && <span style={{ position: "absolute", top: 10, right: 10, fontSize: 13 }}>🔒</span>}
                      <div style={{
                        width: 46, height: 46, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 24, background: done ? "#E3F1EE" : current ? `${accent}1A` : "#F1F5F3", marginBottom: 10,
                      }}>{u.emoji}</div>
                      <div className="f-body" style={{ fontSize: 11, fontWeight: 700, letterSpacing: .6, color: "#9AA8A3" }}>UNIT {idx + 1}</div>
                      <div className="f-body" style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.25, minHeight: 34, margin: "2px 0 8px" }}>{u.title[n]}</div>
                      <div style={{ height: 5, borderRadius: 3, background: "#E8EEEB", overflow: "hidden" }}>
                        <div style={{ height: 5, borderRadius: 3, width: `${Math.min(100, Math.max(0, pct))}%`, maxWidth: "100%", background: done ? "#0E7C6B" : accent, transition: "width .3s" }} />
                      </div>
                      <div className="f-body" style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: FADE, marginTop: 5 }}>
                        <span>{u.items.length} {kid ? "words" : "items"}</span><span>{pct}%</span>
                      </div>
                      {current && (
                        <div className="f-body" style={{
                          marginTop: 9, textAlign: "center", background: accent, color: "#fff",
                          borderRadius: 999, padding: "5px 0", fontSize: 11, fontWeight: 700, letterSpacing: .5,
                        }}>{pct > 0 ? "CONTINUE" : "START"} →</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </Screen>
    );
  }

  /* ── unit complete: creative round or exit ── */
  if (!cur) return (
    <Screen exit={() => setUnit(null)} title={`${unit.emoji} ${unit.title[n]}`}>
      {creativeBusy && <Thinking accent={accent} label={creative ? "Reading your answer…" : "One creative challenge…"} />}
      {!creativeBusy && creative && !creative.done && (<div>
        <div className="f-body" style={{ fontSize: 12.5, fontWeight: 700, color: "#8A6A1F", marginBottom: 8 }}>✨ CREATIVE ROUND</div>
        <Card style={{ padding: 16, marginBottom: 12, background: "#FAF0DA" }}>
          <p className="f-body" style={{ fontSize: 15 }}>{creative.prompt}</p>
        </Card>
        <textarea value={creativeDraft} onChange={e => setCreativeDraft(e.target.value)} rows={2}
          placeholder={LANGS[t].name + "…"} className="f-body" style={{ ...inputStyle, resize: "none" }} />
        <div style={{ display: "flex", gap: 8 }}>
          <Btn accent={accent} onClick={judgeCreative} disabled={!creativeDraft.trim()}>Check it <Send size={14} /></Btn>
          <Btn ghost onClick={() => finish(25)}>Skip</Btn>
        </div>
      </div>)}
      {!creativeBusy && creative?.done && (<div style={{ textAlign: "center", paddingTop: 20 }}>
        <div style={{ fontSize: 52 }}>{creative.pass ? "🌟" : "💪"}</div>
        <h2 className="f-display" style={{ fontSize: 24, fontWeight: 600, margin: "10px 0 8px" }}>{creative.pass ? (kid ? "Amazing sentence!" : "Unit mastered") : "So close!"}</h2>
        {creative.feedback && <p className="f-body" style={{ color: FADE, fontSize: 14, marginBottom: 16 }}>{creative.feedback}</p>}
        <Btn full accent={accent} onClick={() => finish(creative.pass ? 30 : 25)}>Collect XP <Star size={15} /></Btn>
      </div>)}
      {!creativeBusy && !creative && (<div style={{ textAlign: "center", paddingTop: 26 }}>
        {kid && <Confetti burst={1} />}
        <div style={{ fontSize: 52 }}>{wonSticker || "🎓"}</div>
        <h2 className="f-display" style={{ fontSize: 24, fontWeight: 600, margin: "10px 0 8px" }}>{kid ? "Level beaten!" : "Unit complete"}</h2>
        {wonSticker && <p className="f-body" style={{ fontSize: 15, color: "#8A6A1F", marginBottom: 10 }}>You won a <b>{wonSticker}</b> sticker for your collection!</p>}
        <Btn full accent={accent} onClick={() => finish(25)}>Collect {kid ? "stars" : "25 XP"} <Star size={15} /></Btn>
      </div>)}
    </Screen>
  );

  /* ── exercise machine ── */
  const term = pathTerm(cur.item, t), mean = pathMean(cur.item, t);
  const ex = pathEx(cur.item, t), exG = pathExGloss(cur.item, t);
  const gap = gapWordFor(cur.item, t);
  const remaining = queue.length;
  const distractors = (k) => shuffle(unit.items.filter((_, i) => i !== cur.i)).slice(0, k).map(it => pathMean(it, t));
  const mcqItems = cur.m === 1 ? shuffle([cur.item, ...shuffle(unit.items.filter((_, i) => i !== cur.i)).slice(0, 2)]) : [];
  const gapChips = cur.m === 2
    ? shuffle([gap, ...shuffle(unit.items.filter((_, i) => i !== cur.i)).slice(0, 2).map(it => gapWordFor(it, t))])
    : [];
  const highlight = (text, word) => {
    const idx = text.toLowerCase().indexOf(word.toLowerCase());
    if (idx < 0) return text;
    return (<>{text.slice(0, idx)}<span style={{ color: accent, fontWeight: 700 }}>{text.slice(idx, idx + word.length)}</span>{text.slice(idx + word.length)}</>);
  };
  const gapped = (text, word) => {
    const idx = text.toLowerCase().indexOf(word.toLowerCase());
    if (idx < 0) return text;
    return (<>{text.slice(0, idx)}<span style={{ borderBottom: `2.5px solid ${accent}`, minWidth: 56, display: "inline-block", textAlign: "center", color: fillPick ? (fillPick === gap ? "#0E7C6B" : "#C64F3B") : "transparent" }}>{fillPick || word}</span>{text.slice(idx + word.length)}</>);
  };

  return (
    <Screen exit={() => setUnit(null)} title={`${unit.emoji} ${unit.title[n]}`}>
      {kid && <Confetti burst={burst} />}
      {kid && streak >= 2 && (
        <div className="rise f-body" key={streak} style={{ textAlign: "center", fontSize: 15, fontWeight: 700, color: "#8A6A1F", marginBottom: 8 }}>
          {KID_PRAISE[streak % KID_PRAISE.length]} {streak} in a row!
        </div>
      )}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 4, marginBottom: 8 }} aria-label="Stage progress">
          {["Hear", "Pick", "Fill", "Build", "Say"].map((st, i) => (
            <div key={st} style={{ flex: 1, textAlign: "center" }}>
              <div style={{ height: 5, borderRadius: 3, background: i < cur.m ? "#0E7C6B" : i === cur.m ? accent : "#DCE5E1" }} />
              <span className="f-body" style={{ fontSize: 10, fontWeight: 700, letterSpacing: .4, color: i === cur.m ? accent : i < cur.m ? "#0E7C6B" : "#9AA8A3" }}>{st.toUpperCase()}</span>
            </div>
          ))}
        </div>
        <div className="f-body" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, fontWeight: 700, color: FADE }}>
          <span style={{ display: "flex", gap: 4 }} aria-label="Items in this unit">
            {unit.items.map((_, i) => {
              const m = itemM(unit, i);
              return <span key={i} style={{ width: 9, height: 9, borderRadius: "50%", background: m >= 5 ? "#0E7C6B" : i === cur.i ? accent : m > 0 ? "#D9A441" : "#DCE5E1", outline: i === cur.i ? `2px solid ${accent}44` : "none" }} />;
            })}
          </span>
          <span>{streak >= 2 ? `🔥 ${streak} in a row · ` : ""}{remaining} to go</span>
        </div>
      </div>

      {cur.m === 0 && (<div>
        <p className="f-body" style={{ fontSize: 13, color: FADE, marginBottom: 10 }}>{kid ? "Listen! Your new words live inside this sentence: 👂" : "New language arrives inside a real sentence — listen first."}</p>
        <Card style={{ padding: 20, textAlign: "center", marginBottom: 14 }}>
          <div style={{ fontSize: kid ? 54 : 44, marginBottom: 8 }}>{cur.item.pic}</div>
          <div className="f-display" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.35 }}>
            “{highlight(ex, gap)}”
          </div>
          <div className="f-body" style={{ fontSize: 13, color: FADE, marginTop: 6 }}>{exG}</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
            <Btn small ghost onClick={() => tts.say(ex)}><Volume2 size={14} /> Again</Btn>
            <Btn small ghost onClick={() => tts.say(term)}><Volume2 size={14} /> Just “{term}”</Btn>
          </div>
          <div className="f-body" style={{ fontSize: 14, marginTop: 14, padding: "10px 12px", background: "#F1F5F3", borderRadius: 12 }}>
            <b style={{ color: accent }}>{term}</b> = {mean}
          </div>
        </Card>
        <Btn full accent={accent} onClick={() => advance(true)}>{kid ? "I heard it! ⭐" : "Got it"} <ArrowRight size={15} /></Btn>
      </div>)}

      {cur.m === 1 && (<div>
        <h2 className="f-display" style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>
          🔊 “{term}”
          <button onClick={() => tts.say(term)} aria-label="Hear it again" style={iconBtn}><Volume2 size={16} color={FADE} /></button>
        </h2>
        <p className="f-body" style={{ fontSize: 13.5, color: FADE, marginBottom: 14 }}>Pick the picture that matches:</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {mcqItems.map((it, i) => {
            const right = it === cur.item;
            return (
              <Card key={i} onClick={() => { if (picked === null) { setPicked(it); setTimeout(() => advance(right), 750); } }} style={{
                padding: "16px 8px", textAlign: "center",
                border: picked === null ? "1.5px solid #DCE5E1" : right ? "2px solid #0E7C6B" : picked === it ? "2px solid #C64F3B" : "1.5px solid #DCE5E1",
                background: picked !== null && right ? "#E3F1EE" : "#fff",
              }}>
                <div style={{ fontSize: kid ? 40 : 34 }}>{it.pic}</div>
                <div className="f-body" style={{ fontSize: 12.5, marginTop: 6, color: FADE }}>{pathMean(it, t)}</div>
              </Card>
            );
          })}
        </div>
      </div>)}

      {cur.m === 2 && (<div>
        <h2 className="f-display" style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Complete the sentence</h2>
        <p className="f-body" style={{ fontSize: 13.5, color: FADE, marginBottom: 12 }}>“{exG}”</p>
        <Card style={{ padding: 18, marginBottom: 14, textAlign: "center" }}>
          <div style={{ fontSize: 34, marginBottom: 6 }}>{cur.item.pic}</div>
          <div className="f-display" style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.4 }}>“{gapped(ex, gap)}”</div>
          <Btn small ghost onClick={() => tts.say(ex)} style={{ marginTop: 10 }}><Volume2 size={13} /> Hear the whole thing</Btn>
        </Card>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          {gapChips.map((w, i) => (
            <Chip key={i} label={w} accent={accent} selected={fillPick === w}
              onClick={() => {
                if (fillPick === gap) return;
                setFillPick(w);
                if (w.toLowerCase() === gap.toLowerCase()) {
                  sfx("ding");
                  setTimeout(() => { tts.say(ex); }, 150);
                  setTimeout(() => advance(true), 1400);
                } else if (fillWrong >= 1) {
                  setTimeout(() => { setFillPick(gap); setTimeout(() => advance(false), 1200); }, 500);
                } else { setFillWrong(1); sfx("soft"); setTimeout(() => setFillPick(null), 700); }
              }} />
          ))}
        </div>
        {fillWrong >= 1 && fillPick === null && <p className="f-body" style={{ fontSize: 12.5, color: "#8A6A1F", marginTop: 10, textAlign: "center" }}>Listen once more — the sound gives it away. 👂</p>}
      </div>)}

      {cur.m === 3 && (<div>
        <h2 className="f-display" style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Build the sentence</h2>
        <p className="f-body" style={{ fontSize: 13.5, color: FADE, marginBottom: 12 }}>“{exG}”</p>
        <Card style={{ padding: 14, minHeight: 54, marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {order.map((w, i) => <Chip key={i} label={w} accent={accent} selected onClick={() => { setOrder(order.filter((_, j) => j !== i)); setPool([...pool, w]); }} />)}
            {!order.length && <span className="f-body" style={{ fontSize: 12.5, color: "#9AA8A3" }}>Tap the words in order…</span>}
          </div>
        </Card>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
          {pool.map((w, i) => <Chip key={i} label={w} accent={accent} onClick={() => { setOrder([...order, w]); setPool(pool.filter((_, j) => j !== i)); }} />)}
        </div>
        {!pool.length && order.length > 0 && (
          <Btn full accent={accent} onClick={() => {
            const want = ex.replace(/[.!?¡¿,]/g, "").split(/\s+/).join(" ").toLowerCase();
            const got = order.join(" ").toLowerCase();
            if (got === want) advance(true);
            else if (buildWrong >= 1) { setPicked("show"); }
            else { setBuildWrong(1); sfx("soft"); setPool(shuffle([...order])); setOrder([]); }
          }}>Check <Check size={15} /></Btn>
        )}
        {buildWrong >= 1 && picked !== "show" && <p className="f-body" style={{ fontSize: 12.5, color: "#8A6A1F", marginTop: 8 }}>Not quite — try once more. Tip: listen first. <button onClick={() => tts.say(ex)} style={iconBtn}><Volume2 size={13} color={FADE} /></button></p>}
        {picked === "show" && (<div style={{ marginTop: 10 }}>
          <p className="f-body" style={{ fontSize: 14 }}>It goes: <b>“{ex}”</b></p>
          <Btn small accent={accent} style={{ marginTop: 8 }} onClick={() => advance(false)}>Okay — I'll see it again soon</Btn>
        </div>)}
      </div>)}

      {cur.m === 4 && (<div>
        <h2 className="f-display" style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Now say it</h2>
        <Card style={{ padding: 16, marginBottom: 12 }}>
          <div className="f-display" style={{ fontSize: 18, fontWeight: 600 }}>
            “{ex}”
            <button onClick={() => tts.say(ex)} aria-label="Hear it" style={iconBtn}><Volume2 size={15} color={FADE} /></button>
          </div>
          <div className="f-body" style={{ fontSize: 12.5, color: FADE, marginTop: 3 }}>{exG}</div>
        </Card>
        <PracticeSay key={"c" + cur.i} target={ex} lang={t} accent={accent}
          onScore={(sc) => { observeSkill("speaking", Math.max(0.2, sc / 100)); }} />
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Btn accent={accent} onClick={() => { addWords([{ term, translation: mean, example: ex }]); advance(true); }}>Done — next <ArrowRight size={14} /></Btn>
        </div>
      </div>)}
    </Screen>
  );
}

function GuidedTrainer({ pack, member, voices, accent, addWords, finish, exit, observeSkill }) {
  const p = member.profile;
  const t = p.target, n = p.native === "es" ? "es" : "en";
  const kid = member.ageBand === "child";
  const [step, setStep] = useState("listen"); // listen | quiz | echo | role | done
  const [lineIdx, setLineIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [peek, setPeek] = useState(false);
  const [speed, setSpeed] = useState("normal");
  const [qi, setQi] = useState(0);
  const [picked, setPicked] = useState(null);
  const [correct, setCorrect] = useState(0);
  const [ei, setEi] = useState(0);          // echo index into keyLines
  const [ri, setRi] = useState(0);          // role index into lines
  const [reveal, setReveal] = useState(false);
  const [scores, setScores] = useState([]);
  const stopRef = useRef(false);

  const line = (l) => (t === "es" ? l.es : l.en);
  const gloss = (l) => (t === "es" ? l.en : l.es);
  const keyLines = pack.lines.filter(l => l.k);
  const roleLines = pack.lines;

  const stopAudio = useCallback(() => {
    stopRef.current = true;
    try { window.speechSynthesis?.cancel(); } catch {}
    setPlaying(false); setLineIdx(-1);
  }, []);
  useEffect(() => () => stopAudio(), [stopAudio]);

  const speakLines = (idxs, done) => {
    if (!window.speechSynthesis) { done?.(); return; }
    stopAudio(); stopRef.current = false; setPlaying(true);
    const vF = pickVoice(voices, t, null, "f");
    const vM = pickVoice(voices, t, null, "m");
    const sv = [vF || vM, (vM && vM !== vF) ? vM : (vF || vM)];
    const same = sv[0] === sv[1];
    const rate = (SPEEDS[speed] || 1) * 0.95;
    const go = (k) => {
      if (stopRef.current || k >= idxs.length) { setPlaying(false); setLineIdx(-1); if (!stopRef.current) done?.(); return; }
      const i = idxs[k]; setLineIdx(i);
      const u = new SpeechSynthesisUtterance(line(pack.lines[i]));
      const v = sv[pack.lines[i].s] || sv[0];
      if (v) u.voice = v;
      u.lang = v?.lang || LANGS[t].tts;
      const pros = prosodyFor(line(pack.lines[i]));
      u.rate = rate * pros.rate;
      u.pitch = (same ? [1.0, 1.18][pack.lines[i].s] : 1) * pros.pitch;
      u.onend = () => setTimeout(() => go(k + 1), 300);
      u.onerror = () => { setPlaying(false); setLineIdx(-1); };
      window.speechSynthesis.speak(u);
    };
    go(0);
  };
  const playAll = () => speakLines(pack.lines.map((_, i) => i));
  const playOne = (i) => speakLines([i]);

  const answer = (i) => {
    if (picked !== null) return;
    setPicked(i);
    const ok = i === pack.quiz[qi].a;
    if (ok) setCorrect(c => c + 1);
    sfx(ok ? "ding" : "soft");
    observeSkill("comprehension", ok ? 1 : 0.25);
  };

  const finishAll = () => {
    addWords(pack.words.map(w => ({ term: t === "es" ? w.es : w.en, translation: t === "es" ? w.en : w.es, example: w.ex })));
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    finish(18 + (avg >= 80 ? 6 : 0));
  };

  const StepDots = () => {
    const order = ["listen", "quiz", "echo", "role"];
    return (
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {order.map(o => <div key={o} style={{ height: 5, flex: 1, borderRadius: 3, background: order.indexOf(o) <= order.indexOf(step === "done" ? "role" : step) ? accent : "#DCE5E1" }} />)}
      </div>
    );
  };

  return (
    <Screen exit={() => { stopAudio(); exit(); }} title={`${pack.emoji} ${pack.title[n]}`}>
      <StepDots />
      {step === "listen" && (<div>
        <p className="f-body" style={{ color: FADE, fontSize: 14, marginBottom: 12 }}>{pack.scene[n]} {kid ? "Listen with big ears! 👂" : "Listen first — the transcript stays hidden until you've tried."}</p>
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <Btn small accent={accent} onClick={playAll} disabled={playing}><Play size={14} /> {playing ? "Playing…" : "Play the conversation"}</Btn>
          <Chip label="🐢 Slow" accent={accent} selected={speed === "slow"} onClick={() => setSpeed(sp => sp === "slow" ? "normal" : "slow")} />
          <Chip label={peek ? "Hide text" : "Peek text"} accent={accent} selected={peek} onClick={() => setPeek(v => !v)} />
        </div>
        <Card style={{ padding: 14 }}>
          {pack.lines.map((l, i) => (
            <div key={i} onClick={() => playOne(i)} style={{ display: "flex", gap: 10, padding: "7px 4px", borderRadius: 10, background: lineIdx === i ? "#E3F1EE" : "transparent", cursor: "pointer", alignItems: "baseline" }}>
              <span style={{ fontSize: 13 }}>{l.s === 0 ? "🗣️" : "🫵"}</span>
              <div style={{ flex: 1 }}>
                <div className="f-body" style={{ fontSize: 14.5, fontWeight: l.s === 1 ? 600 : 400, filter: peek || lineIdx === i ? "none" : "blur(5px)" }}>{line(l)}</div>
                {peek && <div className="f-body" style={{ fontSize: 12, color: FADE }}>{gloss(l)}</div>}
              </div>
              <Volume2 size={13} color={FADE} />
            </div>
          ))}
        </Card>
        <Btn full accent={accent} onClick={() => { stopAudio(); setStep("quiz"); }} style={{ marginTop: 14 }}>I've listened — quiz me <ArrowRight size={15} /></Btn>
      </div>)}

      {step === "quiz" && (<div>
        <div className="f-body" style={{ fontSize: 12.5, fontWeight: 700, color: FADE, marginBottom: 8 }}>UNDERSTANDING · {qi + 1}/{pack.quiz.length}</div>
        <h2 className="f-display" style={{ fontSize: 20, fontWeight: 600, marginBottom: 14 }}>{pack.quiz[qi].q[n]}</h2>
        {pack.quiz[qi].opts[n].map((o, i) => (
          <Card key={i} onClick={() => answer(i)} style={{
            padding: 14, marginBottom: 8,
            border: picked === null ? "1.5px solid #DCE5E1" : i === pack.quiz[qi].a ? "1.5px solid #0E7C6B" : picked === i ? "1.5px solid #C64F3B" : "1.5px solid #DCE5E1",
            background: picked !== null && i === pack.quiz[qi].a ? "#E3F1EE" : "#fff",
          }}><span className="f-body" style={{ fontSize: 14.5 }}>{o}</span></Card>
        ))}
        {picked !== null && (
          <Btn full accent={accent} style={{ marginTop: 8 }} onClick={() => {
            setPicked(null);
            if (qi < pack.quiz.length - 1) setQi(qi + 1); else setStep("echo");
          }}>{qi < pack.quiz.length - 1 ? "Next" : "Now say it yourself"} <ArrowRight size={15} /></Btn>
        )}
        <Btn small ghost onClick={playAll} style={{ marginTop: 10 }}><Play size={13} /> Replay the clip</Btn>
      </div>)}

      {step === "echo" && (<div>
        <div className="f-body" style={{ fontSize: 12.5, fontWeight: 700, color: FADE, marginBottom: 8 }}>ECHO THE KEY LINES · {ei + 1}/{keyLines.length}</div>
        <p className="f-body" style={{ fontSize: 13.5, color: FADE, marginBottom: 10 }}>{kid ? "Copy the line like a parrot! 🦜" : "Hear it, then say it back — you're scored word by word."}</p>
        <Card style={{ padding: 16, marginBottom: 12 }}>
          <div className="f-display" style={{ fontSize: 19, fontWeight: 600 }}>
            “{line(keyLines[ei])}”
            <button onClick={() => speakLines([pack.lines.indexOf(keyLines[ei])])} aria-label="Hear it" style={iconBtn}><Volume2 size={16} color={FADE} /></button>
          </div>
          <div className="f-body" style={{ fontSize: 12.5, color: FADE, marginTop: 4 }}>{gloss(keyLines[ei])}</div>
        </Card>
        <PracticeSay key={"e" + ei} target={line(keyLines[ei])} lang={t} accent={accent}
          onScore={(sc) => { setScores(a => [...a, sc]); observeSkill("speaking", Math.max(0.2, sc / 100)); }} />
        <Btn full accent={accent} style={{ marginTop: 12 }} onClick={() => {
          if (ei < keyLines.length - 1) setEi(ei + 1); else { setStep("role"); setRi(0); setReveal(false); }
        }}>{ei < keyLines.length - 1 ? "Next line" : "Final step: play your role"} <ArrowRight size={15} /></Btn>
      </div>)}

      {step === "role" && (() => {
        const l = roleLines[ri];
        const mine = l.s === 1;
        return (<div>
          <div className="f-body" style={{ fontSize: 12.5, fontWeight: 700, color: FADE, marginBottom: 8 }}>YOUR TURN — YOU ARE 🫵 · line {ri + 1}/{roleLines.length}</div>
          <p className="f-body" style={{ fontSize: 13.5, color: FADE, marginBottom: 10 }}>{kid ? "Now YOU are in the story!" : "The app plays the other speaker. When it's your line, say it — the hint tells you what to say."}</p>
          <Card style={{ padding: 16, marginBottom: 12, background: mine ? "#FFF" : "#F7FAF9" }}>
            {mine ? (<>
              <div className="f-body" style={{ fontSize: 12, fontWeight: 700, color: "#8A6A1F", marginBottom: 4 }}>SAY THIS (in {LANGS[t].name}):</div>
              <div className="f-body" style={{ fontSize: 15.5, fontWeight: 600 }}>{gloss(l)}</div>
              {reveal && <div className="f-display" style={{ fontSize: 17, marginTop: 8, color: "#0E7C6B" }}>“{line(l)}”</div>}
            </>) : (<>
              <div className="f-body" style={{ fontSize: 12, fontWeight: 700, color: FADE, marginBottom: 4 }}>🗣️ THE OTHER SPEAKER:</div>
              <div className="f-display" style={{ fontSize: 17 }}>
                “{line(l)}”
                <button onClick={() => playOne(ri)} aria-label="Hear it" style={iconBtn}><Volume2 size={15} color={FADE} /></button>
              </div>
              <div className="f-body" style={{ fontSize: 12.5, color: FADE, marginTop: 3 }}>{gloss(l)}</div>
            </>)}
          </Card>
          {mine ? (<>
            <PracticeSay key={"r" + ri} target={line(l)} lang={t} accent={accent}
              onScore={(sc) => { setScores(a => [...a, sc]); observeSkill("speaking", Math.max(0.2, sc / 100)); }} />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <Btn small ghost onClick={() => setReveal(true)}>Show me the line</Btn>
              <Btn small accent={accent} onClick={() => { setReveal(false); if (ri < roleLines.length - 1) setRi(ri + 1); else setStep("done"); }}>
                {ri < roleLines.length - 1 ? "Next" : "Finish"} <ArrowRight size={14} /></Btn>
            </div>
          </>) : (
            <Btn full accent={accent} onClick={() => { playOne(ri); setTimeout(() => { if (ri < roleLines.length - 1) setRi(ri + 1); else setStep("done"); }, 400); }}>
              Play & continue <ArrowRight size={15} /></Btn>
          )}
        </div>);
      })()}

      {step === "done" && (<div style={{ textAlign: "center", paddingTop: 30 }}>
        <div style={{ fontSize: 52 }}>{kid ? "🎉" : "🏁"}</div>
        <h2 className="f-display" style={{ fontSize: 24, fontWeight: 600, margin: "10px 0 6px" }}>{kid ? "You did the whole story!" : "Conversation trained"}</h2>
        <p className="f-body" style={{ color: FADE, fontSize: 14, marginBottom: 6 }}>
          Understanding: {correct}/{pack.quiz.length} · Lines spoken: {scores.length}
          {scores.length ? ` · avg clarity ${Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)}%` : ""}
        </p>
        <p className="f-body" style={{ color: FADE, fontSize: 13, marginBottom: 18 }}>3 phrases from this conversation were added to your review deck.</p>
        <Btn full accent={accent} onClick={finishAll}>Collect {18}+ XP <Star size={15} /></Btn>
      </div>)}
    </Screen>
  );
}

function ListeningLab({ member, voices, accent, addWords, finish, exit, observeSkill }) {
  const [guided, setGuided] = useState(null);
  const p = member.profile;
  const [channel, setChannel] = useState(null);
  const [clip, setClip] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);
  const [stage, setStage] = useState("listen"); // listen | quiz | results
  const [playing, setPlaying] = useState(false);
  const [lineIdx, setLineIdx] = useState(-1);
  const [speed, setSpeed] = useState("normal");
  const [showScript, setShowScript] = useState(false);
  const [listens, setListens] = useState(0);
  const [audioFail, setAudioFail] = useState(false);
  const [qi, setQi] = useState(0);
  const [picked, setPicked] = useState(null);
  const [correct, setCorrect] = useState(0);
  const stopRef = useRef(false);

  const generate = async (ch) => {
    setChannel(ch); setLoading(true); setErr(false); setClip(null);
    setStage("listen"); setListens(0); setShowScript(false); setQi(0); setPicked(null); setCorrect(0);
    try {
      setAudioFail(false);
      const c = await askClaude(
        `${memberBrief(member)}\n\nWrite a short ${LANGS[p.target].name} listening clip in the format "${ch.label}" (${ch.speakers} speaker${ch.speakers > 1 ? "s" : ""}), themed on the learner's interests. Respond ONLY with JSON, no fences:
{"title":"short title in ${p.native}","scene":"one-line setup in ${p.native} (who/where — no spoilers)","speakers":["first name"${ch.speakers > 1 ? ',"first name"' : ""}],"lines":[{"s":0,"text":"one short natural ${LANGS[p.target].name} sentence","gloss":"${p.native} meaning"}],"questions":[{"prompt":"comprehension question in ${p.native}","options":["4 options in ${p.native}"],"answer":0,"explain":"1 sentence in ${p.native}"}],"words":[{"term":"useful ${LANGS[p.target].name} word from the clip","translation":"${p.native}","example":"short line"}]}
${ch.speakers > 1 ? '"s" alternates 0/1 between speakers.' : '"s" is always 0.'} 6–9 lines, spoken register, level ${p.level} plus a small stretch. Exactly 3 questions that require actually understanding the clip (not guessable from options alone). Exactly 3 words.`,
        { json: true, maxTokens: 1300 });
      setClip(c);
      if (!window.speechSynthesis) setShowScript(true); // no audio on this device: reading mode
    } catch { setErr(true); }
    setLoading(false);
  };

  const stopAudio = useCallback(() => {
    stopRef.current = true;
    try { window.speechSynthesis?.cancel(); } catch {}
    setPlaying(false); setLineIdx(-1);
  }, []);
  useEffect(() => () => stopAudio(), [stopAudio]);

  const playAll = () => {
    if (!clip || !window.speechSynthesis) return;
    stopAudio();
    stopRef.current = false;
    setPlaying(true);
    const vF = pickVoice(voices, p.target, null, "f");
    const vM = pickVoice(voices, p.target, null, "m");
    const speakerVoices = [vF || vM, (vM && vM !== vF) ? vM : (vF || vM)];
    const sameVoice = speakerVoices[0] === speakerVoices[1];
    const rate = (SPEEDS[speed] || 1) * 0.95;
    const pitches = sameVoice ? [1.0, 1.18] : [1.0, 1.0];
    const speakLine = (i) => {
      if (stopRef.current || i >= clip.lines.length) {
        setPlaying(false); setLineIdx(-1);
        if (!stopRef.current) setListens(n => n + 1);
        return;
      }
      setLineIdx(i);
      const u = new SpeechSynthesisUtterance(clip.lines[i].text);
      const v = speakerVoices[clip.lines[i].s] || speakerVoices[0];
      if (v) u.voice = v;
      u.lang = v?.lang || LANGS[p.target].tts;
      const pros = prosodyFor(clip.lines[i].text);
      u.rate = rate * pros.rate;
      u.pitch = (pitches[clip.lines[i].s] || 1) * pros.pitch;
      u.onend = () => setTimeout(() => speakLine(i + 1), 260);
      u.onerror = () => { setPlaying(false); setLineIdx(-1); setAudioFail(true); setShowScript(true); };
      window.speechSynthesis.speak(u);
    };
    speakLine(0);
  };

  const answer = (i) => {
    if (picked !== null) return;
    setPicked(i);
    const ok = i === clip.questions[qi].answer;
    if (ok) setCorrect(c => c + 1);
    sfx(ok ? "ding" : "soft");
    observeSkill("comprehension", ok ? 1 : 0.25);
  };
  const nextQ = () => {
    setPicked(null);
    if (qi < clip.questions.length - 1) setQi(qi + 1);
    else { addWords(clip.words || []); setStage("results"); }
  };

  if (guided) return (
    <GuidedTrainer pack={guided} member={member} voices={voices} accent={accent}
      addWords={addWords} finish={finish} observeSkill={observeSkill} exit={() => setGuided(null)} />
  );

  if (!channel) return (
    <Screen exit={exit} title="Listening lab">
      <div className="f-body" style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: .6, color: FADE, marginBottom: 8 }}>GUIDED TRAINING</div>
      <p className="f-body" style={{ color: FADE, fontSize: 13.5, marginBottom: 10 }}>
        Coached conversations in four steps: listen, prove you understood, echo the key lines, then play your role out loud.
      </p>
      {GUIDED_CONVOS.filter(g => member.ageBand === "child" ? g.band === "child" : g.band === "adult").map(g => (
        <Card key={g.id} onClick={() => setGuided(g)} style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10, padding: 16 }}>
          <span style={{ fontSize: 24 }}>{g.emoji}</span>
          <div style={{ flex: 1 }}>
            <div className="f-body" style={{ fontWeight: 600 }}>{g.title[member.profile.native === "es" ? "es" : "en"]}</div>
            <div className="f-body" style={{ fontSize: 12.5, color: FADE }}>Level {g.level} · listen → quiz → echo → your turn</div>
          </div>
          <ChevronRight size={16} color={FADE} />
        </Card>
      ))}
      <div className="f-body" style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: .6, color: FADE, margin: "18px 0 8px" }}>FRESH CLIPS</div>
      <p className="f-body" style={{ color: FADE, fontSize: 13.5, marginBottom: 10 }}>
        A brand-new clip at your level, themed on your interests — no transcript until you've answered.
      </p>
      {CHANNELS.map(ch => (
        <Card key={ch.id} onClick={() => generate(ch)} style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10, padding: 16 }}>
          <span style={{ fontSize: 24 }}>{ch.emoji}</span>
          <div style={{ flex: 1 }}>
            <div className="f-body" style={{ fontWeight: 600 }}>{ch.label}</div>
            <div className="f-body" style={{ fontSize: 12.5, color: FADE }}>{ch.speakers === 2 ? "Two voices" : "One voice"} · ~45 seconds</div>
          </div>
          <ChevronRight size={16} color={FADE} />
        </Card>
      ))}
      {!window.speechSynthesis && <p className="f-body" style={{ fontSize: 12.5, color: "#9AA8A3", marginTop: 10 }}>Audio isn't available in this browser — use "Peek text" to read instead.</p>}
    </Screen>
  );

  if (loading) return <Screen exit={exit} title="Listening lab"><Thinking accent={accent} label="Recording your clip…" /></Screen>;
  if (err || !clip) return <Screen exit={exit} title="Listening lab"><ErrorBox retry={() => generate(channel)} /></Screen>;

  if (stage === "results") return (
    <Screen exit={exit} title={clip.title}>
      <Card style={{ textAlign: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "center" }}><Orb accent={GOLD} size={58} /></div>
        <h2 className="f-display" style={{ fontSize: 24, fontWeight: 600, margin: "12px 0 4px" }}>{correct}/{clip.questions.length} correct</h2>
        <p className="f-body" style={{ color: FADE, fontSize: 14 }}>{listens} full listen{listens !== 1 ? "s" : ""} · 3 words saved to your deck</p>
      </Card>
      <Card style={{ padding: 16, marginBottom: 12 }}>
        <div className="f-body" style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 1, color: accent, marginBottom: 10 }}>FULL TRANSCRIPT</div>
        {clip.lines.map((l, i) => (
          <div key={i} style={{ marginBottom: 9 }}>
            <div className="f-body" style={{ fontSize: 14.5, fontWeight: 600 }}>
              <span style={{ color: accent }}>{clip.speakers[l.s] || clip.speakers[0]}:</span> {l.text}
            </div>
            <div className="f-body" style={{ fontSize: 12.5, color: FADE }}>{l.gloss}</div>
          </div>
        ))}
      </Card>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn full ghost onClick={() => generate(channel)}><RotateCcw size={15} /> Another clip</Btn>
        <Btn full accent={accent} onClick={() => finish(20 + correct * 6)}><Star size={15} /> Claim {20 + correct * 6} XP</Btn>
      </div>
    </Screen>
  );

  if (stage === "quiz") {
    const q = clip.questions[qi];
    return (
      <Screen exit={exit} title={clip.title}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <Btn ghost small onClick={playAll} disabled={playing}><Play size={14} /> Replay clip</Btn>
        </div>
        <Card>
          <div className="f-body" style={{ fontSize: 12.5, fontWeight: 700, color: accent, letterSpacing: 1, marginBottom: 10 }}>QUESTION {qi + 1} OF {clip.questions.length}</div>
          <div className="f-body" style={{ fontSize: 17, fontWeight: 600, marginBottom: 14 }}>{q.prompt}</div>
          {q.options.map((o, i) => {
            const show = picked !== null, isAns = i === q.answer;
            return (
              <button key={i} onClick={() => answer(i)} className="f-body" style={{
                ...optionStyle,
                borderColor: show && isAns ? accent : show && i === picked ? "#C64F3B" : LINE,
                background: show && isAns ? LANGS[p.target].soft : "#fff",
              }}>{o}</button>
            );
          })}
          {picked !== null && (
            <div className="rise">
              <p className="f-body" style={{ fontSize: 14, color: FADE, margin: "8px 0 12px" }}>
                <CornerDownRight size={13} style={{ verticalAlign: -2 }} /> {q.explain}
              </p>
              <Btn full accent={accent} onClick={nextQ}>{qi < clip.questions.length - 1 ? "Next" : "See results"} <ArrowRight size={16} /></Btn>
            </div>
          )}
        </Card>
      </Screen>
    );
  }

  return (
    <Screen exit={() => { stopAudio(); exit(); }} title={clip.title}>
      <Card style={{ padding: 14, marginBottom: 12, background: LANGS[p.target].soft, border: "none" }}>
        <div className="f-body" style={{ fontSize: 13.5 }}>{channel.emoji} {clip.scene}</div>
      </Card>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "18px 0 8px" }}>
        <Orb accent={accent} size={104} speaking={playing} />
        <div className="f-body" style={{ marginTop: 12, fontSize: 12.5, fontWeight: 700, letterSpacing: 1, color: FADE }}>
          {playing ? `PLAYING · ${(clip.speakers[clip.lines[Math.max(0, lineIdx)]?.s] || "").toUpperCase()}` : listens > 0 ? `${listens} FULL LISTEN${listens > 1 ? "S" : ""}` : "PRESS PLAY & JUST LISTEN"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 16 }}>
          <button onClick={() => setSpeed(speed === "slow" ? "normal" : "slow")} className="f-body" aria-label="Toggle speed"
            style={{ ...pillStyle, cursor: "pointer", fontSize: 12.5 }}>{speed === "slow" ? "🐢 Slow" : "1× Normal"}</button>
          <button onClick={playing ? stopAudio : playAll} aria-label={playing ? "Stop" : "Play"}
            style={{ width: 72, height: 72, borderRadius: "50%", border: "none", cursor: "pointer", background: playing ? "#C64F3B" : accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {playing ? <X size={28} /> : <Play size={28} style={{ marginLeft: 3 }} />}
          </button>
          <button onClick={() => setShowScript(!showScript)} className="f-body" aria-label="Toggle transcript"
            style={{ ...pillStyle, cursor: "pointer", fontSize: 12.5, opacity: showScript ? 1 : 0.75 }}>{showScript ? "Hide text" : "Peek text"}</button>
        </div>
      </div>

      {showScript && (
        <Card style={{ padding: 14, marginTop: 6, marginBottom: 6 }}>
          {clip.lines.map((l, i) => (
            <div key={i} className="f-body" style={{ fontSize: 14, marginBottom: 5, opacity: lineIdx === i ? 1 : 0.65, fontWeight: lineIdx === i ? 600 : 400 }}>
              <span style={{ color: accent, fontWeight: 600 }}>{clip.speakers[l.s] || clip.speakers[0]}:</span> {l.text}
            </div>
          ))}
          <p className="f-body" style={{ fontSize: 11.5, color: "#9AA8A3", marginTop: 6 }}>Try your next listen without the text — that's where the growth is.</p>
        </Card>
      )}

      {playing && (
        <div style={{ display: "flex", gap: 5, justifyContent: "center", marginTop: 12 }} aria-label="Playback progress">
          {clip.lines.map((_, i) => <span key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: i <= lineIdx ? accent : "#DCE5E1", transition: "background .2s" }} />)}
        </div>
      )}
      {audioFail && <p className="f-body" style={{ fontSize: 12.5, color: "#8A6A1F", textAlign: "center", marginTop: 10 }}>🔇 Audio hiccup on this device — no problem, the transcript is open. Read it, then take the quiz.</p>}
      <Btn full accent={accent} onClick={() => { stopAudio(); setStage("quiz"); }} style={{ marginTop: 10 }}>
        I'm ready — quiz me <ArrowRight size={16} />
      </Btn>
      {listens === 0 && !audioFail && !showScript && !!window.speechSynthesis && <p className="f-body" style={{ fontSize: 12, color: "#9AA8A3", textAlign: "center", marginTop: 8 }}>Best after one full listen — but you're the boss.</p>}
    </Screen>
  );
}

/* ─────────────────────────── Review & Translate ──────────────────────── */

function ReviewView({ member, tts, accent, grade, finish, observeSkill }) {
  const kid = member.ageBand === "child";
  const due = member.deck.filter(c => c.due <= Date.now());
  const [flip, setFlip] = useState(false);
  const [done, setDone] = useState(0);
  const card = due[0];

  if (!card) return (
    <Card style={{ textAlign: "center", padding: 36, background: kid ? KID_CARD : "#fff", border: kid ? "none" : undefined }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}><Orb accent={accent} size={54} active={false} /></div>
      <div className="f-display" style={{ fontSize: 22, fontWeight: 600, marginBottom: 6 }}>{done > 0 ? (kid ? "All done! 🎉" : "Review complete") : "Nothing to review yet"}</div>
      <div className="f-body" style={{ color: kid ? "#6B5B3E" : FADE, fontSize: 14.5 }}>
        {done > 0 ? `${done} word${done > 1 ? "s" : ""} practiced. ` : member.deck.length === 0 ? (kid ? "Play a story or lesson to fill your treasure chest!" : "Finish a lesson to start your deck.") : `${member.deck.length} words saved — more come due soon.`}
      </div>
      {done > 0 && <div style={{ marginTop: 16 }}><Btn accent={accent} onClick={() => finish(done * 3)}><Star size={15} /> {kid ? "Collect stars" : `Claim ${done * 3} XP`}</Btn></div>}
    </Card>
  );

  const doGrade = (g) => {
    grade(card.id, g);
    sfx(g === "again" ? "soft" : "ding");
    observeSkill("vocabulary", g === "again" ? 0.2 : g === "good" ? 0.7 : 1);
    setFlip(false); setDone(d => d + 1);
  };

  return (
    <div>
      <div className="f-body" style={{ fontSize: 13, color: FADE, marginBottom: 10 }}>{due.length} to go · {done} done</div>
      <Card style={{ textAlign: "center", minHeight: 190, display: "flex", flexDirection: "column", justifyContent: "center", background: kid ? KID_CARD : "#fff", border: kid ? "none" : undefined }}>
        <div className="f-display" style={{ fontSize: 30, fontWeight: 600 }}>{card.term}
          <button onClick={() => tts.say(card.term)} aria-label="Hear word" style={iconBtn}><Volume2 size={16} color={FADE} /></button>
        </div>
        {flip ? (
          <div className="rise">
            <div className="f-body" style={{ fontSize: 18, marginTop: 10 }}>{card.translation}</div>
            {card.example && <div className="f-body" style={{ fontSize: 14, color: kid ? "#6B5B3E" : FADE, marginTop: 6, fontStyle: "italic" }}>{card.example}</div>}
          </div>
        ) : (
          <div className="f-body" style={{ color: kid ? "#6B5B3E" : FADE, fontSize: 14, marginTop: 10 }}>{kid ? "What does it mean? Say it out loud!" : "Say the meaning out loud, then reveal."}</div>
        )}
      </Card>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        {!flip ? <Btn full accent={accent} onClick={() => setFlip(true)}>Reveal</Btn> : (
          <>
            <Btn full ghost onClick={() => doGrade("again")} style={{ color: "#A0453A" }}>{kid ? "Oops" : "Again"}</Btn>
            <Btn full ghost onClick={() => doGrade("good")}>{kid ? "Got it" : "Good"}</Btn>
            <Btn full accent={accent} onClick={() => doGrade("easy")}>Easy</Btn>
          </>
        )}
      </div>
    </div>
  );
}

function TranslateView({ member, tts, accent, addWords }) {
  const p = member.profile;
  const [text, setText] = useState("");
  const [dir, setDir] = useState("to");
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  const go = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setErr(false); setRes(null);
    const src = dir === "to" ? p.native : LANGS[p.target].name;
    const dst = dir === "to" ? LANGS[p.target].name : p.native;
    try {
      const r = await askClaude(
        `Translate from ${src} to ${dst} for a ${p.level} learner: "${text.trim()}"
Respond ONLY with JSON, no fences:
{"translation":"best natural translation","breakdown":[{"part":"chunk","gloss":"${p.native} meaning / grammar role"}],"variants":{"formal":"…","informal":"…","slang":"regional/slang, name region"},"note":"one usage/culture note in ${p.native}"}
Breakdown 2–5 chunks; variants in ${LANGS[p.target].name}.`,
        { json: true, maxTokens: 700 });
      setRes(r);
      tts.say(r.translation);
    } catch { setErr(true); }
    setBusy(false);
  };

  return (
    <div>
      <h1 className="f-display" style={{ fontSize: 28, fontWeight: 600, marginBottom: 14 }}>Translate & understand</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <Chip label={`${p.native} → ${LANGS[p.target].name}`} selected={dir === "to"} accent={accent} onClick={() => setDir("to")} />
        <Chip label={`${LANGS[p.target].name} → ${p.native}`} selected={dir === "from"} accent={accent} onClick={() => setDir("from")} />
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="Type a phrase or sentence…"
        className="f-body" style={{ ...inputStyle, resize: "vertical", margin: "0 0 10px" }} aria-label="Text to translate" />
      <Btn full accent={accent} onClick={go} disabled={busy || !text.trim()}>
        {busy ? <><Loader size={16} className="animate-spin" /> Translating…</> : <><Languages size={16} /> Translate</>}
      </Btn>
      {err && <div style={{ marginTop: 14 }}><ErrorBox retry={go} /></div>}
      {res && (
        <div className="rise" style={{ marginTop: 16 }}>
          <Card style={{ marginBottom: 10 }}>
            <div className="f-display" style={{ fontSize: 22, fontWeight: 600 }}>{res.translation}
              <button onClick={() => tts.say(res.translation)} aria-label="Hear translation" style={iconBtn}><Volume2 size={17} color={FADE} /></button>
            </div>
            <div style={{ marginTop: 12 }}>
              {res.breakdown?.map((b, i) => (
                <div key={i} style={{ display: "flex", gap: 10, marginBottom: 5 }}>
                  <span className="f-body" style={{ fontWeight: 600, fontSize: 14, color: accent }}>{b.part}</span>
                  <span className="f-body" style={{ fontSize: 14, color: FADE }}>{b.gloss}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card style={{ marginBottom: 10, padding: 16 }}>
            {[["Formal", res.variants?.formal], ["Informal", res.variants?.informal], ["Slang", res.variants?.slang]].map(([k, v]) => v && (
              <div key={k} style={{ marginBottom: 7 }}>
                <span className="f-body" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 1, color: FADE }}>{k.toUpperCase()}</span>
                <div className="f-body" style={{ fontSize: 15 }}>{v}</div>
              </div>
            ))}
            {res.note && <div className="f-body" style={{ fontSize: 13.5, color: FADE, marginTop: 6 }}>💡 {res.note}</div>}
          </Card>
          <Btn full ghost onClick={() => { addWords([{ term: dir === "to" ? res.translation : text.trim(), translation: dir === "to" ? text.trim() : res.translation, example: res.variants?.informal || "" }]); setRes(null); setText(""); }}>
            <Plus size={16} /> Save to my deck
          </Btn>
        </div>
      )}
    </div>
  );
}

/* ──────────────── self-updating assessment + profile + family ────────── */

function AssessmentCard({ member, kidLabels = false }) {
  const avg = skillAvg(member);
  const trend = trendOf(member);
  const labels = kidLabels ? KID_SKILL_LABELS : SKILL_LABELS;
  const TrendIcon = trend > 1.5 ? TrendingUp : trend < -1.5 ? TrendingDown : Minus;
  const accent = LANGS[member.profile.target].accent;
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <div className="f-body" style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 1, color: FADE, flex: 1 }}>LIVE ASSESSMENT</div>
        <span className="f-body" style={{ ...pillStyle, padding: "4px 10px", fontSize: 12.5 }}>
          {cefrOf(avg)} <TrendIcon size={13} color={trend > 1.5 ? "#2E8B6A" : trend < -1.5 ? "#A0453A" : FADE} />
        </span>
      </div>
      {SKILLS.map(k => {
        const s = member.skills[k]?.s || 15;
        return (
          <div key={k} style={{ marginBottom: 9 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span className="f-body" style={{ fontSize: 13, fontWeight: 600 }}>{labels[k]}</span>
              <span className="f-body" style={{ fontSize: 12, color: FADE }}>{cefrOf(s)} · {Math.round(s)}</span>
            </div>
            <div style={{ height: 7, borderRadius: 4, background: MIST, overflow: "hidden" }} role="progressbar" aria-valuenow={Math.round(s)} aria-valuemin={0} aria-valuemax={100} aria-label={labels[k]}>
              <div style={{ width: `${s}%`, height: "100%", borderRadius: 4, background: `linear-gradient(90deg, ${accent}, ${GOLD})`, transition: "width .6s ease" }} />
            </div>
          </div>
        );
      })}
      <p className="f-body" style={{ fontSize: 11.5, color: "#9AA8A3", marginTop: 8 }}>
        Updates itself from every lesson, story, review, and conversation.
      </p>
    </Card>
  );
}

function ProfileView({ member, household, accent, tts, voices, update, reset, switchMember, signOut, upgrade, pin }) {
  const kid = member.ageBand === "child";
  const individual = household.type === "individual";
  const p = member.profile, s = member.stats;
  const stars = Math.floor(s.xp / 10);
  const [confirmLang, setConfirmLang] = useState(null);
  const [hdStatus, setHdStatus] = useState(kokoroEngine ? "ready" : member.hdVoice ? "loading" : null);
  useEffect(() => { // resume a pending HD load if the toggle was already on
    if (member.hdVoice && !kokoroEngine) {
      setHdStatus("loading");
      loadKokoro().then(() => setHdStatus("ready")).catch(() => { setHdStatus("unavailable"); update({ ...member, hdVoice: false }); });
    }
  }, []);
  const langVoices = voices.filter(v => (v.lang || "").toLowerCase().startsWith(p.target === "es" ? "es" : "en"));

  const changeLang = (code) => {
    const seeded = newMember({ name: member.name, avatar: member.avatar, ageBand: member.ageBand, personality: member.personality, isParent: member.isParent, profile: { ...p, target: code, level: kid ? "A1" : p.level } });
    update({ ...member, profile: seeded.profile, deck: [], skills: seeded.skills, history: seeded.history });
    setConfirmLang(null);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
        <div style={{ fontSize: 44 }}>{member.avatar}</div>
        <div style={{ flex: 1 }}>
          <div className="f-display" style={{ fontSize: 24, fontWeight: 600 }}>{member.name}</div>
          <div className="f-body" style={{ color: FADE, fontSize: 14 }}>{LANGS[p.target].flag} {LANGS[p.target].name} · {p.level} · {AGE_BANDS[member.ageBand].label}</div>
        </div>
        {!individual && (
          <button onClick={switchMember} className="f-body" aria-label="Switch member" style={{ ...pillStyle, cursor: "pointer", border: `1px solid ${LINE}` }}><Users size={14} /> Switch</button>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <span className="f-body" style={pillStyle}><Flame size={14} color={GOLD} /> {s.streak} day streak</span>
        <span className="f-body" style={pillStyle}><Star size={14} color={GOLD} /> {kid ? `${stars} stars` : `${s.xp} XP`}</span>
        <span className="f-body" style={pillStyle}><Layers size={14} color={accent} /> {member.deck.length} words</span>
      </div>

      <div style={{ marginBottom: 12 }}><AssessmentCard member={member} kidLabels={kid} /></div>

      {/* tutor & voice settings */}
      <Card style={{ padding: 16, marginBottom: 12 }}>
        <div className="f-body" style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 1, color: FADE, marginBottom: 10 }}><Settings size={12} style={{ verticalAlign: -1 }} /> TUTOR & VOICE</div>
        <div className="f-body" style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Personality</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {personasFor(member.ageBand).map(([key, per]) => (
            <Chip key={key} label={per.label} accent={accent} selected={member.personality === key}
              onClick={() => { update({ ...member, personality: key }); }} />
          ))}
        </div>
        <div className="f-body" style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Speaking speed</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {["slow", "normal", "native"].map(sp => (
            <Chip key={sp} label={sp[0].toUpperCase() + sp.slice(1)} accent={accent} selected={(member.speed || "normal") === sp}
              onClick={() => update({ ...member, speed: sp })} />
          ))}
        </div>
        {kid && (
          <>
            <div className="f-body" style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Kid voice</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              {Object.entries(KID_VOICES).map(([key, kv]) => (
                <Chip key={key} label={`${kv.emoji} ${kv.label}`} accent={accent}
                  selected={(member.kidVoice || (voiceShape(member).gender === "f" ? "girl" : "boy")) === key}
                  onClick={() => update({ ...member, kidVoice: key })} />
              ))}
            </div>
          </>
        )}
        <div className="f-body" style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Voice style</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {Object.entries(VOICE_STYLES).map(([key, st]) => (
            <Chip key={key} label={`${st.emoji} ${st.label}`} accent={accent} selected={(member.voiceStyle || "natural") === key}
              onClick={() => update({ ...member, voiceStyle: key })} />
          ))}
        </div>
        {langVoices.length === 0 && (
          <p className="f-body" style={{ fontSize: 12, color: "#A0453A", marginBottom: 10, lineHeight: 1.5 }}>
            ⚠️ No {LANGS[p.target].name} voices are installed in this browser — pronunciation will sound wrong. Add one in your OS speech settings, or use the premium voice below.
          </p>
        )}
        {langVoices.length > 0 && (
          <>
            <div className="f-body" style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Voice</div>
            <select value={member.voiceURI || ""} onChange={e => update({ ...member, voiceURI: e.target.value || null })}
              className="f-body" style={{ ...inputStyle, margin: "0 0 10px" }} aria-label="Tutor voice">
              <option value="">Best available</option>
              {langVoices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}
            </select>
          </>
        )}
        <Btn ghost small onClick={() => { const t = tutorFor(member); tts.say(p.target === "es" ? `¡Hola! Soy ${t.name}. Mucho gusto.` : `Hi! I'm ${t.name}. It's great to meet you.`); }}>
          <Volume2 size={15} /> Preview voice
        </Btn>

        <div style={{ borderTop: `1px solid ${MIST}`, marginTop: 14, paddingTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div className="f-body" style={{ fontSize: 13, fontWeight: 600 }}>HD neural voice <span style={{ fontSize: 11, color: FADE, fontWeight: 500 }}>· open source (Kokoro-82M) · English · beta</span></div>
              <div className="f-body" style={{ fontSize: 12, color: hdStatus === "unavailable" ? "#A0453A" : FADE }}>
                {hdStatus === "loading" ? "Downloading the voice model — this can take a minute…"
                  : hdStatus === "ready" ? "Ready — the tutor now speaks with a neural voice."
                  : hdStatus === "unavailable" ? "Couldn't load here (network restrictions) — using the enhanced browser voice instead."
                  : "Runs a small open-source speech model right in your browser."}
              </div>
            </div>
            <button role="switch" aria-checked={!!member.hdVoice} aria-label="HD neural voice"
              onClick={async () => {
                const on = !member.hdVoice;
                update({ ...member, hdVoice: on });
                if (on && !kokoroEngine) {
                  setHdStatus("loading");
                  try { await loadKokoro(); setHdStatus("ready"); sfx("ding"); }
                  catch { setHdStatus("unavailable"); update({ ...member, hdVoice: false }); }
                } else if (on) setHdStatus("ready");
                else setHdStatus(null);
              }}
              style={{ width: 44, height: 26, borderRadius: 13, border: "none", cursor: "pointer", background: member.hdVoice ? accent : LINE, position: "relative", transition: "background .2s", flexShrink: 0 }}>
              <span style={{ position: "absolute", top: 3, left: member.hdVoice ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
            </button>
          </div>
        </div>

        {!kid && isServer() && (
          <div style={{ borderTop: `1px solid ${MIST}`, marginTop: 12, paddingTop: 12 }}>
            <div className="f-body" style={{ fontSize: 13, fontWeight: 600 }}>Premium voice <span style={{ fontSize: 11, color: FADE, fontWeight: 500 }}>· provided by your server{serverCaps.tts ? "" : " (not configured)"}</span></div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
              <div className="f-body" style={{ fontSize: 12, color: FADE, flex: 1 }}>
                {serverCaps.tts ? "Human-quality OpenAI voice, key held server-side." : "Ask the server admin to set OPENAI_API_KEY to enable it."}
              </div>
              {serverCaps.tts && (
                <button role="switch" aria-checked={member.premiumVoice !== false} aria-label="Premium voice"
                  onClick={() => update({ ...member, premiumVoice: member.premiumVoice === false })}
                  style={{ width: 44, height: 26, borderRadius: 13, border: "none", cursor: "pointer", background: member.premiumVoice !== false ? accent : LINE, position: "relative", transition: "background .2s", flexShrink: 0 }}>
                  <span style={{ position: "absolute", top: 3, left: member.premiumVoice !== false ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
                </button>
              )}
            </div>
          </div>
        )}
        {!kid && !isServer() && (
          <div style={{ borderTop: `1px solid ${MIST}`, marginTop: 12, paddingTop: 12 }}>
            <div className="f-body" style={{ fontSize: 13, fontWeight: 600 }}>Premium voice <span style={{ fontSize: 11, color: FADE, fontWeight: 500 }}>· OpenAI · speaks Spanish & English natively</span></div>
            {!getOpenAiTtsKey() ? (
              <p className="f-body" style={{ fontSize: 12, color: FADE, margin: "4px 0 8px", lineHeight: 1.5 }}>
                {AI_PROVIDER() === "openai"
                  ? "Add your OpenAI API key in setup to unlock this — it's the same key used for the AI tutor, no separate key needed."
                  : "Premium voice always uses OpenAI, even with Claude as your AI tutor. Add an OpenAI API key in setup to unlock it."}
              </p>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                <div className="f-body" style={{ fontSize: 12, color: FADE, flex: 1 }}>
                  {member.premiumVoice !== false ? `${tutorFor(member).name} speaks with a human OpenAI voice.` : "premium voice is off for this profile."}
                  {" "}If a reply falls back to the browser voice, the key or network was rejected.
                </div>
                <button role="switch" aria-checked={member.premiumVoice !== false} aria-label="Premium voice"
                  onClick={() => update({ ...member, premiumVoice: member.premiumVoice === false })}
                  style={{ width: 44, height: 26, borderRadius: 13, border: "none", cursor: "pointer", background: member.premiumVoice !== false ? accent : LINE, position: "relative", transition: "background .2s", flexShrink: 0 }}>
                  <span style={{ position: "absolute", top: 3, left: member.premiumVoice !== false ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
                </button>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* language switcher */}
      <Card style={{ padding: 16, marginBottom: 12 }}>
        <div className="f-body" style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 1, color: FADE, marginBottom: 10 }}>LEARNING LANGUAGE</div>
        <div style={{ display: "flex", gap: 8 }}>
          {Object.entries(LANGS).map(([code, l]) => (
            <Chip key={code} label={`${l.flag} ${l.name}`} accent={l.accent} selected={p.target === code}
              onClick={() => code !== p.target && setConfirmLang(code)} />
          ))}
        </div>
        {confirmLang && (
          <div className="rise" style={{ marginTop: 12, background: MIST, borderRadius: 12, padding: 12 }}>
            <p className="f-body" style={{ fontSize: 13.5, marginBottom: 10 }}>Switch to {LANGS[confirmLang].name}? This starts a fresh journey — the current deck and assessment are replaced.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <Btn small accent={LANGS[confirmLang].accent} onClick={() => changeLang(confirmLang)}>Switch</Btn>
              <Btn small ghost onClick={() => setConfirmLang(null)}>Cancel</Btn>
            </div>
          </div>
        )}
      </Card>

      <Card style={{ padding: 16, marginBottom: 12 }}>
        <div className="f-body" style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 1, color: FADE, marginBottom: 8 }}>MILESTONES</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[[s.lessons >= 1, "🌱 First lesson"], [s.talks >= 1, "💬 First talk"], [(s.stories || 0) >= 1, "📖 First story"], [s.streak >= 3, "🔥 3-day streak"], [member.deck.length >= 20, "📚 20 words"]].map(([ok, label]) => (
            <span key={label} className="f-body" style={{ fontSize: 13, padding: "6px 11px", borderRadius: 999, background: ok ? LANGS[p.target].soft : MIST, color: ok ? INK : "#A8B5B0", fontWeight: 600 }}>{label}</span>
          ))}
        </div>
      </Card>

      {member.isParent && !kid && (
        <Card style={{ padding: 16, marginBottom: 12 }}>
          <div className="f-body" style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 1, color: FADE, marginBottom: 6 }}>🔒 {household.type === "classroom" ? "TEACHER CONTROLS" : "PARENTAL CONTROLS"}</div>
          <p className="f-body" style={{ fontSize: 13.5, color: FADE, lineHeight: 1.5, marginBottom: 12 }}>
            {pin.has
              ? `A ${household.type === "classroom" ? "teacher" : "parent"} PIN protects opening ${household.type === "classroom" ? "your profile" : "parent profiles"}, adding or removing ${household.type === "classroom" ? "students" : "members"}, and deleting the account.`
              : `Set a 4-digit PIN so ${household.type === "classroom" ? "students" : "kids"} on this device can't open your profile, manage ${household.type === "classroom" ? "the roster" : "members"}, or delete the account.`}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {pin.has ? (
              <>
                <Btn small ghost onClick={pin.change}>Change PIN</Btn>
                <Btn small ghost onClick={pin.remove} style={{ color: "#A0453A" }}>Remove PIN</Btn>
              </>
            ) : (
              <Btn small accent={accent} onClick={pin.set}>Set parent PIN</Btn>
            )}
          </div>
          <button onClick={() => { try { ["lingua-anthropic-key", "lingua-openai-key", "lingua-ai-provider", "lingua-skip-key", "lingua-mode", "lingua-server-url", "lingua-token"].forEach(k => localStorage.removeItem(k)); } catch {} window.location.reload(); }}
            className="f-body" style={{ background: "none", border: "none", color: FADE, fontSize: 12, cursor: "pointer", padding: 0, marginTop: 10, display: "block" }}>
            ⚙️ Change connection (server / API key)
          </button>
        </Card>
      )}

      {individual && member.isParent && (
        <Card style={{ padding: 16, marginBottom: 12, background: LANGS[p.target].soft, border: "none" }}>
          <div className="f-body" style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 1, color: FADE, marginBottom: 6 }}><Users size={12} style={{ verticalAlign: -1 }} /> FAMILY</div>
          <p className="f-body" style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 12 }}>
            Learning is better together. Upgrade to a family account to add kids (with kid-safe animal tutors and story mode) or other adults — and track everyone's progress.
          </p>
          <Btn small accent={accent} onClick={upgrade}><Plus size={15} /> Upgrade & add a member</Btn>
        </Card>
      )}

      {!kid && (
        <Btn full ghost onClick={signOut} style={{ marginBottom: member.isParent ? 10 : 0 }}><LogOut size={15} /> Sign out</Btn>
      )}

      {!kid && member.isParent && (
        <Btn full ghost onClick={reset} style={{ color: "#A0453A" }}><Trash2 size={15} /> {individual ? "Delete account & start over" : household.type === "classroom" ? "Delete classroom & start over" : "Delete household & start over"}</Btn>
      )}
    </div>
  );
}

/* ─────────────────────── weekly progress digest ──────────────────────── */

function WeeklyDigest({ members, household, accent, viewerNative, onSave }) {
  const cached = household.digest?.day === todayStr() ? household.digest.data : null;
  const [data, setData] = useState(cached);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const cls = household.type === "classroom";

  const generate = async () => {
    setBusy(true); setErr(false);
    try {
      const lines = members.map(m => {
        const weak = m.deck.filter(c => c.lapses > 0).sort((a, b) => b.lapses - a.lapses).slice(0, 3).map(c => c.term);
        const due = m.deck.filter(c => c.due <= Date.now()).length;
        const sk = SKILLS.map(k => `${SKILL_LABELS[k]} ${Math.round(m.skills[k]?.s || 15)}`).join(", ");
        return `${m.name} (${AGE_BANDS[m.ageBand].label}, learning ${LANGS[m.profile.target].name}, ${m.profile.level}): streak ${m.stats.streak}d, ${m.stats.lessons} lessons, ${m.stats.talks} talks, ${m.stats.stories || 0} stories total; skills [${sk}] trend ${trendOf(m) >= 0 ? "+" : ""}${trendOf(m).toFixed(1)}; deck ${m.deck.length} words (${due} due); struggles: ${weak.join(", ") || "none"}`;
      }).join("\n");
      const d = await askClaude(
        `You are writing a warm, concrete weekly progress digest for a ${cls ? "teacher about their students" : "parent about their family's language learning"}. Write in ${viewerNative}. Data:\n${lines}\n\nRespond ONLY with JSON, no fences:
{"headline":"one upbeat, specific sentence about the ${cls ? "class" : "family"} overall","members":[{"name":"exact name from data","summary":"2 warm, specific sentences grounded ONLY in the data (no invented events)","tip":"1 concrete, actionable suggestion for this week"}]}
One entry per person, in the same order. Never invent activity that isn't in the data; if someone was inactive, say so kindly and suggest a tiny restart.`,
        { json: true, maxTokens: 900 });
      setData(d);
      onSave({ day: todayStr(), data: d });
    } catch { setErr(true); }
    setBusy(false);
  };

  return (
    <Card style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <div className="f-body" style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 1, color: FADE, flex: 1 }}>📬 WEEKLY DIGEST</div>
        {data && !busy && <Btn small ghost onClick={generate}><RefreshCw size={13} /> Refresh</Btn>}
      </div>
      {busy ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
          <Orb accent={accent} size={26} />
          <span className="f-body" style={{ fontSize: 13.5, color: FADE }}>Writing this week's digest…</span>
        </div>
      ) : err ? (
        <ErrorBox retry={generate} />
      ) : !data ? (
        <>
          <p className="f-body" style={{ fontSize: 13.5, color: FADE, marginBottom: 12 }}>
            A short, human summary of {cls ? "each student's" : "everyone's"} week — what moved, what's stuck, and one concrete tip each.
          </p>
          <Btn small accent={accent} onClick={generate}><Sparkles size={14} /> Generate this week's digest</Btn>
        </>
      ) : (
        <div className="rise">
          <p className="f-body" style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 10 }}>{data.headline}</p>
          {(data.members || []).map((m, i) => {
            const mm = members.find(x => x.name === m.name);
            return (
              <div key={i} style={{ borderTop: `1px solid ${MIST}`, padding: "9px 0" }}>
                <div className="f-body" style={{ fontSize: 13.5, fontWeight: 700 }}>{mm?.avatar || "🙂"} {m.name}</div>
                <div className="f-body" style={{ fontSize: 13.5, lineHeight: 1.5, margin: "2px 0" }}>{m.summary}</div>
                <div className="f-body" style={{ fontSize: 13, color: "#8A6A1F" }}>💡 {m.tip}</div>
              </div>
            );
          })}
          <p className="f-body" style={{ fontSize: 11, color: "#9AA8A3", marginTop: 6 }}>Generated today · refreshes on demand</p>
        </div>
      )}
    </Card>
  );
}

function FamilyView({ household, accent, onAdd, onSwitch, onRemove, pinNudge, onSetPin, viewerNative, onSaveDigest, viewerIsOwner, onSetMemberParent }) {
  const [invites, setInvites] = useState([]);
  const [busyRole, setBusyRole] = useState(null);
  const [roleErr, setRoleErr] = useState("");

  useEffect(() => {
    if (!viewerIsOwner || !isSupabase()) return;
    supaListInvites().then(setInvites).catch(() => {});
  }, [viewerIsOwner, household.members.length]);

  const revoke = async (id) => {
    try { await supaRevokeInvite(id); setInvites(invites.filter(i => i.id !== id)); } catch {}
  };
  const toggleRole = async (m) => {
    setBusyRole(m.id); setRoleErr("");
    try {
      await supaSetMemberRole(m.id, m.isParent ? "member" : "owner");
      onSetMemberParent(m.id, !m.isParent);
    } catch (e) { setRoleErr(e.message); }
    setBusyRole(null);
  };

  return (
    <div>
      <h1 className="f-display" style={{ fontSize: 28, fontWeight: 600, marginBottom: 4 }}>Your family</h1>
      <p className="f-body" style={{ color: FADE, marginBottom: 16 }}>Live progress for every member — assessments update themselves as they learn.</p>
      {pinNudge && (
        <Card style={{ padding: 14, marginBottom: 12, background: "#FFF6E3", border: "none", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 20 }}>🔒</span>
          <div className="f-body" style={{ fontSize: 13.5, flex: 1, lineHeight: 1.45 }}>Kids share this device? Set a parent PIN to lock profile management.</div>
          <Btn small accent={accent} onClick={onSetPin}>Set PIN</Btn>
        </Card>
      )}
      <WeeklyDigest members={household.members} household={household} accent={accent} viewerNative={viewerNative} onSave={onSaveDigest} />
      {roleErr && (
        <Card style={{ padding: 14, marginBottom: 12, background: "#FBEAE4", border: "none" }}>
          <div className="f-body" style={{ fontSize: 13.5, color: "#A0453A" }}>{roleErr}</div>
        </Card>
      )}
      {household.members.map(m => (
        <Card key={m.id} style={{ marginBottom: 12, padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 32 }}>{m.avatar}</div>
            <div style={{ flex: 1 }}>
              <div className="f-body" style={{ fontWeight: 600, fontSize: 16 }}>{m.name} {m.isParent && <span style={{ fontSize: 11.5, color: FADE }}>· Parent</span>}</div>
              <div className="f-body" style={{ fontSize: 12.5, color: FADE }}>
                {LANGS[m.profile.target].flag} {LANGS[m.profile.target].name} · {AGE_BANDS[m.ageBand].label} · {m.stats.streak}🔥 · {m.stats.lessons} lessons · {(m.stats.stories || 0)} stories · {m.stats.talks} talks
              </div>
            </div>
            <Btn small ghost onClick={() => onSwitch(m.id)}>Open</Btn>
          </div>
          <AssessmentCard member={m} kidLabels={m.ageBand === "child"} />
          <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
            {!m.isParent && (
              <button onClick={() => onRemove(m.id)} className="f-body" style={{ background: "none", border: "none", color: "#A0453A", fontSize: 12.5, cursor: "pointer" }}>Remove profile</button>
            )}
            {viewerIsOwner && m.ageBand !== "child" && (
              <button onClick={() => toggleRole(m)} disabled={busyRole === m.id} className="f-body" style={{ background: "none", border: "none", color: FADE, fontSize: 12.5, cursor: "pointer" }}>
                {busyRole === m.id ? "…" : m.isParent ? "Remove co-parent access" : "Make co-parent"}
              </button>
            )}
          </div>
        </Card>
      ))}
      {viewerIsOwner && invites.map(inv => (
        <Card key={inv.id} style={{ marginBottom: 12, padding: 16, opacity: 0.6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 32 }}>✉️</div>
            <div style={{ flex: 1 }}>
              <div className="f-body" style={{ fontWeight: 600, fontSize: 16 }}>{inv.member_seed?.name || inv.email}</div>
              <div className="f-body" style={{ fontSize: 12.5, color: FADE }}>Invited · pending — {inv.email}</div>
            </div>
            <button onClick={() => revoke(inv.id)} className="f-body" style={{ background: "none", border: "none", color: "#A0453A", fontSize: 12.5, cursor: "pointer" }}>Revoke</button>
          </div>
        </Card>
      ))}
      <Btn full ghost onClick={onAdd}><Plus size={16} /> Add a family member</Btn>
    </div>
  );
}

/* ─────────────────────── classroom: setup + dashboard ────────────────── */

function SetupClass({ onDone }) {
  const [name, setName] = useState("");
  return (
    <div style={{ maxWidth: 440, margin: "0 auto", padding: "64px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 26 }}>
        <Orb accent="#0E7C6B" size={40} active={false} />
        <div className="f-display" style={{ fontWeight: 700, fontSize: 22 }}>Lingua</div>
      </div>
      <h1 className="f-display" style={{ fontSize: 28, fontWeight: 600, marginBottom: 6 }}>Name your class</h1>
      <p className="f-body" style={{ color: FADE, marginBottom: 18 }}>Students you add will see this name, and you'll get a class code for your records.</p>
      <label className="f-body" style={lbl}>Class name</label>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Spanish 2 — Period 4"
        className="f-body" style={inputStyle} />
      <Btn full accent="#0E7C6B" disabled={!name.trim()} onClick={() => onDone(name.trim())}>
        Create class <ArrowRight size={16} />
      </Btn>
    </div>
  );
}

const KIND_META = {
  lesson: { emoji: "📘", label: "Lesson" },
  talk: { emoji: "🎤", label: "Conversation" },
  story: { emoji: "📖", label: "Story" },
  listening: { emoji: "🎧", label: "Listening" },
};

function ClassView({ household, accent, onAdd, onSwitch, onRemove, onCreateAssignment, onDeleteAssignment, pinNudge, onSetPin, viewerNative, onSaveDigest }) {
  const students = household.members.filter(m => !m.isParent);
  const activeToday = students.filter(s => s.stats.lastDay === todayStr()).length;
  const avg = students.length ? students.reduce((t, s) => t + skillAvg(s), 0) / students.length : 0;
  const [form, setForm] = useState(null); // {kind, topic, due}

  return (
    <div>
      <h1 className="f-display" style={{ fontSize: 28, fontWeight: 600, marginBottom: 2 }}>{household.className || "Your class"}</h1>
      <p className="f-body" style={{ color: FADE, fontSize: 13.5, marginBottom: 14 }}>
        Class code <b style={{ letterSpacing: 1 }}>{household.classCode}</b> · {students.length} student{students.length !== 1 ? "s" : ""}
      </p>

      {pinNudge && (
        <Card style={{ padding: 14, marginBottom: 12, background: "#FFF6E3", border: "none", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 20 }}>🔒</span>
          <div className="f-body" style={{ fontSize: 13.5, flex: 1, lineHeight: 1.45 }}>Students share this device? Set a teacher PIN to lock roster management.</div>
          <Btn small accent={accent} onClick={onSetPin}>Set PIN</Btn>
        </Card>
      )}

      {/* class overview */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
        {[[`${activeToday}/${students.length || 0}`, "Active today"], [students.length ? cefrOf(avg) : "—", "Class level"], [String((household.assignments || []).length), "Assignments"]].map(([v, l]) => (
          <Card key={l} style={{ padding: 12, textAlign: "center" }}>
            <div className="f-display" style={{ fontSize: 20, fontWeight: 700, color: accent }}>{v}</div>
            <div className="f-body" style={{ fontSize: 11.5, color: FADE }}>{l}</div>
          </Card>
        ))}
      </div>

      <WeeklyDigest members={students} household={household} accent={accent} viewerNative={viewerNative} onSave={onSaveDigest} />

      {/* assignments */}
      <Card style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <div className="f-body" style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 1, color: FADE, flex: 1 }}>
            <ClipboardList size={13} style={{ verticalAlign: -2 }} /> ASSIGNMENTS
          </div>
          {!form && <Btn small ghost onClick={() => setForm({ kind: "lesson", topic: "", due: "" })}><Plus size={14} /> New</Btn>}
        </div>

        {form && (
          <div className="rise" style={{ background: MIST, borderRadius: 14, padding: 12, marginBottom: 12 }}>
            <div className="f-body" style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Activity type</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              {Object.entries(KIND_META).map(([k, meta]) => (
                <Chip key={k} label={`${meta.emoji} ${meta.label}`} accent={accent} selected={form.kind === k} onClick={() => setForm({ ...form, kind: k })} />
              ))}
            </div>
            {form.kind === "lesson" && (
              <input value={form.topic} onChange={e => setForm({ ...form, topic: e.target.value })}
                placeholder="Topic (optional) — e.g. ordering food, past tense…" className="f-body" style={{ ...inputStyle, margin: "0 0 10px" }} />
            )}
            <input value={form.due} onChange={e => setForm({ ...form, due: e.target.value })}
              placeholder="Due (optional) — e.g. Friday" className="f-body" style={{ ...inputStyle, margin: "0 0 10px" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <Btn small accent={accent} onClick={() => { onCreateAssignment(form); setForm(null); }}>Assign to class</Btn>
              <Btn small ghost onClick={() => setForm(null)}>Cancel</Btn>
            </div>
          </div>
        )}

        {(household.assignments || []).length === 0 && !form && (
          <p className="f-body" style={{ fontSize: 13.5, color: FADE }}>No assignments yet. Assign a lesson, conversation, story, or listening clip — it appears on every student's home screen and checks itself off when they complete it.</p>
        )}
        {(household.assignments || []).map(a => {
          const doneCount = students.filter(s => a.done?.[s.id]).length;
          const meta = KIND_META[a.kind] || KIND_META.lesson;
          return (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: `1px solid ${MIST}` }}>
              <span style={{ fontSize: 18 }}>{meta.emoji}</span>
              <div style={{ flex: 1 }}>
                <div className="f-body" style={{ fontSize: 14, fontWeight: 600 }}>{meta.label}{a.topic ? ` — ${a.topic}` : ""}</div>
                <div className="f-body" style={{ fontSize: 12, color: FADE }}>{a.due ? `Due ${a.due} · ` : ""}{doneCount}/{students.length} done
                  {doneCount > 0 && <span style={{ marginLeft: 6 }}>{students.filter(s => a.done?.[s.id]).map(s => s.avatar).join(" ")}</span>}
                </div>
              </div>
              <button onClick={() => onDeleteAssignment(a.id)} aria-label="Delete assignment"
                style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><Trash2 size={15} color="#A0453A" /></button>
            </div>
          );
        })}
      </Card>

      {/* roster */}
      <div className="f-body" style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 1, color: FADE, margin: "4px 2px 10px" }}>ROSTER — LIVE ASSESSMENTS</div>
      {students.length === 0 && <Card style={{ marginBottom: 12 }}><p className="f-body" style={{ fontSize: 14, color: FADE }}>No students yet — add your first below.</p></Card>}
      {students.map(m => (
        <Card key={m.id} style={{ marginBottom: 12, padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 32 }}>{m.avatar}</div>
            <div style={{ flex: 1 }}>
              <div className="f-body" style={{ fontWeight: 600, fontSize: 16 }}>{m.name}</div>
              <div className="f-body" style={{ fontSize: 12.5, color: FADE }}>
                {LANGS[m.profile.target].flag} {LANGS[m.profile.target].name} · {AGE_BANDS[m.ageBand].label} · {m.stats.streak}🔥 · {m.stats.lessons} lessons · {m.stats.talks} talks
              </div>
            </div>
            <Btn small ghost onClick={() => onSwitch(m.id)}>Open</Btn>
          </div>
          <AssessmentCard member={m} kidLabels={m.ageBand === "child"} />
          <button onClick={() => onRemove(m.id)} className="f-body" style={{ background: "none", border: "none", color: "#A0453A", fontSize: 12.5, cursor: "pointer", marginTop: 8 }}>Remove student</button>
        </Card>
      ))}
      <Btn full ghost onClick={onAdd}><Plus size={16} /> Add a student</Btn>
    </div>
  );
}

/* ─────────────────── assignments banner (student home) ───────────────── */

function AssignmentsBanner({ assignments, kid, accent, onGo }) {
  if (!assignments.length) return null;
  return (
    <Card style={{ padding: 14, marginBottom: 12, background: kid ? "#FFFFFFcc" : "#fff", borderColor: GOLD }}>
      <div className="f-body" style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 1, color: "#8A6A1F", marginBottom: 8 }}>
        <ClipboardList size={13} style={{ verticalAlign: -2 }} /> {kid ? "FROM YOUR TEACHER!" : "ASSIGNMENTS FROM YOUR TEACHER"}
      </div>
      {assignments.map(a => {
        const meta = KIND_META[a.kind] || KIND_META.lesson;
        return (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
            <span style={{ fontSize: 18 }}>{meta.emoji}</span>
            <div className="f-body" style={{ flex: 1, fontSize: 14 }}>
              <b>{meta.label}</b>{a.topic ? ` — ${a.topic}` : ""}{a.due ? <span style={{ color: FADE, fontSize: 12.5 }}> · due {a.due}</span> : ""}
            </div>
            <Btn small accent={accent} onClick={() => onGo(a.kind)}>{kid ? "Go!" : "Start"}</Btn>
          </div>
        );
      })}
    </Card>
  );
}

/* ─────────────────────────── Home screens ────────────────────────────── */

function AdultHome({ member, accent, goLesson, goCourse, goTalk, goReview, goListen, nudge, assignments, onGoAssignment }) {
  const p = member.profile, s = member.stats;
  const due = member.deck.filter(c => c.due <= Date.now()).length;
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div className="f-body" style={{ color: FADE, fontSize: 14 }}>{hello},</div>
          <div className="f-display" style={{ fontSize: 27, fontWeight: 600 }}>{member.name}</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <span className="f-body" style={pillStyle}><Flame size={14} color={GOLD} /> {s.streak}</span>
          <span className="f-body" style={pillStyle}><Star size={14} color={GOLD} /> {s.xp}</span>
        </div>
      </div>

      <AssignmentsBanner assignments={assignments} kid={false} accent={accent} onGo={onGoAssignment} />

      {(() => {
        const lp = learningProgress(member);
        const mini = (label, pct, detail) => (
          <div style={{ minWidth: 0 }}>
            <div className="f-body" style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11.5, color: FADE, marginBottom: 3 }}>
              <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
              <span style={{ flexShrink: 0 }}>{detail}</span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: "#E8EEEB", overflow: "hidden" }}>
              <div style={{ height: 4, borderRadius: 2, width: `${Math.min(100, Math.max(0, pct))}%`, maxWidth: "100%", background: accent, transition: "width .4s" }} />
            </div>
          </div>
        );
        return (
          <Card style={{ padding: 16, marginBottom: 12, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "baseline", marginBottom: 8 }}>
              <div className="f-body" style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: FADE, flex: 1 }}>YOUR PROGRESS</div>
              <div className="f-display" style={{ fontSize: 22, fontWeight: 600, color: accent }}>{lp.overall}%</div>
            </div>
            <div style={{ height: 9, borderRadius: 5, background: "#E8EEEB", marginBottom: 14, overflow: "hidden" }} role="progressbar" aria-valuenow={lp.overall} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ height: 9, borderRadius: 5, width: `${lp.overall}%`, maxWidth: "100%", background: `linear-gradient(90deg, ${accent}, ${GOLD})`, transition: "width .5s" }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" }}>
              {mini("Course", lp.course, `${lp.course}%`)}
              {mini("Skill checks", lp.skills, `${lp.skills}%`)}
              {mini("Vocabulary", lp.vocab, `${lp.words} words`)}
              {mini("Conversations", lp.talk, `${lp.talks} talks`)}
            </div>
          </Card>
        );
      })()}

      {nudge && (
        <div className="rise" style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, padding: "12px 14px", marginBottom: 12 }}>
          <Orb accent={accent} size={28} active={false} />
          <div className="f-body" style={{ fontSize: 14, lineHeight: 1.45 }}><b>{tutorFor(member).name}:</b> {nudge}</div>
        </div>
      )}

      <Card onClick={goLesson} style={{ background: `linear-gradient(135deg, ${INK}, #23423A)`, border: "none", color: "#fff", marginBottom: 12, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: -20, top: -20, opacity: 0.9 }}><Orb accent={accent} size={110} /></div>
        <div className="f-body" style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.2, color: "#ffffffaa" }}>TODAY'S LESSON · ~8 MIN</div>
        <div className="f-display" style={{ fontSize: 24, fontWeight: 600, margin: "8px 0 4px", maxWidth: "75%" }}>Written just for you, just now</div>
        <div className="f-body" style={{ fontSize: 13.5, color: "#ffffffbb", maxWidth: "75%" }}>Built around {p.interests[0]?.toLowerCase() || p.goal.toLowerCase()} at your {p.level} level.</div>
        <div style={{ marginTop: 16 }}><Btn small accent={accent}>Start lesson <ArrowRight size={15} /></Btn></div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Card onClick={goCourse} style={{ padding: 16 }}>
          <GraduationCap size={20} color={accent} />
          <div className="f-body" style={{ fontWeight: 600, marginTop: 8 }}>Course path</div>
          <div className="f-body" style={{ fontSize: 12.5, color: FADE }}>Fundamentals, mastered step by step</div>
        </Card>
        <Card onClick={goTalk} style={{ padding: 16 }}>
          <Mic size={20} color={accent} />
          <div className="f-body" style={{ fontWeight: 600, marginTop: 8 }}>Just talk</div>
          <div className="f-body" style={{ fontSize: 12.5, color: FADE }}>{`Voice conversation with ${tutorFor(member).name}`}</div>
        </Card>
        <Card onClick={goReview} style={{ padding: 16 }}>
          <Layers size={20} color={due > 0 ? GOLD : accent} />
          <div className="f-body" style={{ fontWeight: 600, marginTop: 8 }}>Review</div>
          <div className="f-body" style={{ fontSize: 12.5, color: FADE }}>{due > 0 ? `${due} word${due > 1 ? "s" : ""} ready` : "Nothing due yet"}</div>
        </Card>
        <Card onClick={goListen} style={{ padding: 16 }}>
          <Headphones size={20} color={accent} />
          <div className="f-body" style={{ fontWeight: 600, marginTop: 8 }}>Listening lab</div>
          <div className="f-body" style={{ fontSize: 12.5, color: FADE }}>Guided conversations that train your ear</div>
        </Card>
      </div>
    </div>
  );
}

function ChildHome({ member, accent, goLesson, goCourse, goStory, goTalk, goReview, assignments, onGoAssignment }) {
  const s = member.stats;
  const stars = Math.floor(s.xp / 10);
  const due = member.deck.filter(c => c.due <= Date.now()).length;
  const big = (emoji, title, sub, onClick, delay) => (
    <Card onClick={onClick} style={{ background: KID_CARD, border: "none", padding: 18, textAlign: "center" }}>
      <div className="floaty" style={{ fontSize: 42, animationDelay: `${delay}s` }}>{emoji}</div>
      <div className="f-display" style={{ fontWeight: 600, fontSize: 18, marginTop: 6 }}>{title}</div>
      <div className="f-body" style={{ fontSize: 12.5, color: "#6B5B3E" }}>{sub}</div>
    </Card>
  );
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 36 }}>{member.avatar}</span>
          <div className="f-display" style={{ fontSize: 25, fontWeight: 600 }}>Hi {member.name}!</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <span className="f-body" style={pillStyle}><Flame size={14} color={GOLD} /> {s.streak}</span>
          <span className="f-body" style={pillStyle}>⭐ {stars}</span>
        </div>
      </div>
      <AssignmentsBanner assignments={assignments} kid={true} accent={accent} onGo={onGoAssignment} />
      {(() => {
        const lp = learningProgress(member);
        return (
          <Card style={{ padding: "14px 16px 18px", marginBottom: 12, background: KID_CARD, border: "none" }}>
            <div className="f-body" style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, letterSpacing: .6, color: "#6B5B3E", marginBottom: 10 }}>
              <span>🗺️ MY ADVENTURE</span><span>{lp.overall}% explored!</span>
            </div>
            <div style={{ position: "relative", height: 12, borderRadius: 7, background: "#FFFFFF99" }} role="progressbar" aria-valuenow={lp.overall} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ height: 12, borderRadius: 7, overflow: "hidden" }}>
                <div style={{ height: 12, borderRadius: 7, width: `${Math.min(100, Math.max(lp.overall, 4))}%`, maxWidth: "100%", background: `linear-gradient(90deg, ${accent}, ${GOLD})`, transition: "width .5s" }} />
              </div>
              <span style={{ position: "absolute", top: -11, left: `min(calc(${Math.min(100, Math.max(lp.overall, 4))}% - 13px), calc(100% - 26px))`, fontSize: 21, transition: "left .5s" }}>🚀</span>
              <span style={{ position: "absolute", right: 0, top: -10, fontSize: 18 }}>🏆</span>
            </div>
            <div className="f-body" style={{ fontSize: 11.5, color: "#6B5B3E", marginTop: 9 }}>
              {lp.words} words collected · {lp.talks} talks with {tutorFor(member).name}
            </div>
          </Card>
        );
      })()}
      {(member.stickers || []).length > 0 && (
        <Card style={{ padding: "12px 16px", marginBottom: 12 }}>
          <div className="f-body" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: .6, color: FADE, marginBottom: 6 }}>🎁 MY STICKERS</div>
          <div style={{ fontSize: 26, letterSpacing: 4 }}>
            {(member.stickers || []).join(" ")}
            {(member.stickers || []).length < STICKERS.length && <span style={{ opacity: .3 }}> +?</span>}
          </div>
        </Card>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {big("📖", "Story time", `${tutorFor(member).name} tells you a story!`, goStory, 0)}
        {big("🎲", "Play & learn", "New words and games", goLesson, 0.3)}
        {big("🗺️", "Course adventure", "Beat levels, unlock the next!", goCourse, 0.45)}
        {big("🎤", `Talk to ${tutorFor(member).name}`, "They talk back!", goTalk, 0.6)}
        {big("💎", "Treasure chest", due > 0 ? `${due} words to practice!` : "Your word collection", goReview, 0.9)}
      </div>
    </div>
  );
}

/* ─────────────────────────────── App shell ───────────────────────────── */

function LinguaApp() {
  const [household, setHousehold] = useState(null);
  const [booted, setBooted] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [route, setRoute] = useState("auth"); // auth | invite | setup-parent | picker | add-choice | add-member | invite-send | app
  const [addRole, setAddRole] = useState("child");
  const [activeId, setActiveId] = useState(null);
  const [tab, setTab] = useState("home");
  const [mode, setMode] = useState(null); // 'lesson' | 'listen' | 'course'
  const [toast, setToast] = useState(null);
  const [nudge, setNudge] = useState(null);
  const [pendingGreet, setPendingGreet] = useState(null);
  const online = useOnline();
  const [pinModal, setPinModal] = useState(null); // {mode,title,onSuccess?|onSet?}
  const [pinOk, setPinOk] = useState(false);      // verified this session (re-locks at picker)
  const [ownerUserId, setOwnerUserId] = useState(null); // Supabase mode: current auth.uid(), so the owner's own member.id lines up with household_members.user_id
  const voices = useVoices();

  useEffect(() => {
    if (!isSupabase() || route !== "setup-parent") return;
    supabase.auth.getUser().then(({ data: { user } }) => setOwnerUserId(user?.id || null));
  }, [route]);

  /** Run fn immediately if no PIN is set or already verified; otherwise ask for it. */
  const requirePin = (title, fn) => {
    if (!household?.pinHash || pinOk) return fn();
    setPinModal({ mode: "verify", title, onSuccess: () => { setPinOk(true); setPinModal(null); fn(); } });
  };
  const startSetPin = () => setPinModal({
    mode: "create", title: "Set parent PIN",
    onSet: async (pin) => { persist({ ...household, pinHash: await sha256(pin) }); setPinOk(true); setPinModal(null); },
  });
  const startChangePin = () => requirePin("Confirm current PIN", () => setPinModal({
    mode: "create", title: "Set a new PIN",
    onSet: async (pin) => { persist({ ...household, pinHash: await sha256(pin) }); setPinModal(null); },
  }));
  const startRemovePin = () => requirePin("Confirm PIN to remove it", () => { persist({ ...household, pinHash: null }); setPinOk(false); });

  const versionRef = useRef(1);
  const householdRef = useRef(null); householdRef.current = household;
  const pushTimer = useRef(null);

  const streakFix = (h) => {
    if (!h) return h;
    h.members = (h.members || []).map(m => {
      if (m.stats?.lastDay && Date.now() - new Date(m.stats.lastDay).getTime() > 2 * DAY) m.stats.streak = 0;
      return m;
    });
    return h;
  };

  useEffect(() => { (async () => {
    // Invite-email landing: always pin route to InviteLanding so a slow
    // PKCE/hash session exchange can't fall through into AuthFlow / household
    // boot and skip the password step.
    if (isSupabase() && typeof window !== "undefined" && window.location.pathname.startsWith("/app/invite")) {
      setRoute("invite");
      setBooted(true);
      return;
    }
    if (isServer()) {
      try { serverCaps = await srv("/api/config"); } catch {}
      if (SRV_TOKEN()) {
        try {
          const r = await srv("/api/household");
          versionRef.current = r.version;
          setHousehold(streakFix(r.data));
          setSignedIn(true);
        } catch { try { localStorage.removeItem("lingua-token"); } catch {} }
      } else if (isSupabase()) {
        // Existing Supabase session but no local token (e.g. tab reopened
        // after a magic-link sign-in) — pull the household straight away.
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          try {
            const r = await srv("/api/household");
            versionRef.current = r.version;
            setHousehold(streakFix(r.data));
            setSignedIn(true);
            try { localStorage.setItem("lingua-token", session.access_token); } catch {}
          } catch {}
        }
      }
      setBooted(true);
      return;
    }
    const h = await loadHousehold();
    if (h) setHousehold(streakFix(h));
    setBooted(true);
  })(); }, []);

  // Supabase auth state listener: keep app session in sync when Supabase's
  // session is restored (e.g. page reload) or when signing in/out elsewhere
  useEffect(() => {
    if (!isSupabase()) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session && !signedIn) {
        // Stay on InviteLanding for /app/invite — don't mark signed-in early
        // or the password / profile steps never mount.
        if (typeof window !== "undefined" && window.location.pathname.startsWith("/app/invite")) {
          try { localStorage.setItem("lingua-token", session.access_token); } catch {}
          setRoute("invite");
          return;
        }
        try {
          const r = await srv("/api/household");
          versionRef.current = r.version;
          setHousehold(streakFix(r.data));
          setSignedIn(true);
          try { localStorage.setItem("lingua-token", session.access_token); } catch {}
        } catch {}
      } else if (!session && signedIn) {
        setSignedIn(false);
        setHousehold(null);
        setActiveId(null);
        setPinOk(false);
        setRoute("auth");
      }
    });
    return () => subscription?.unsubscribe();
  }, [signedIn]);

  // multi-device sync: pull on focus + every 25s while signed in
  useEffect(() => {
    if (!isServer() || !signedIn) return;
    const pull = async () => {
      try {
        const r = await srv("/api/household");
        if (r.version > versionRef.current) { versionRef.current = r.version; setHousehold(streakFix(r.data)); }
      } catch {}
    };
    const iv = setInterval(pull, 25000);
    window.addEventListener("focus", pull);
    return () => { clearInterval(iv); window.removeEventListener("focus", pull); };
  }, [signedIn]);

  const persist = (h) => {
    setHousehold(h);
    if (!isServer()) { saveHousehold(h); return; }
    clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(async () => {
      try {
        const r = await srv("/api/household", { method: "PUT", body: { version: versionRef.current, data: householdRef.current } });
        if (r.status === 409) {
          versionRef.current = r.version;
          setHousehold(streakFix(r.data));
          setToast("🔄 Updated from another device");
          setTimeout(() => setToast(null), 2200);
        } else versionRef.current = r.version;
      } catch {}
    }, 700);
  };
  const member = household?.members.find(m => m.id === activeId) || null;
  const accent = member ? LANGS[member.profile.target].accent : "#0E7C6B";
  const tts = useTTS(member || { personality: "warm", profile: { target: "en" } }, voices);

  const updateMember = (next) => {
    persist({ ...household, members: household.members.map(m => (m.id === next.id ? next : m)) });
  };
  // patchMember reads/writes household.members via a functional setHousehold so
  // concurrent patches (e.g. an in-flight async ASR score landing after a
  // synchronous click-handler write) compose against the freshest pending state
  // instead of both reading the same stale `household` closure, where whichever
  // patch's setHousehold call commits last would silently clobber the other.
  const patchMember = (fn) => {
    setHousehold(h => {
      const cur = h?.members.find(m => m.id === activeId);
      if (!cur) return h;
      const next = { ...h, members: h.members.map(m => (m.id === activeId ? fn(m) : m)) };
      householdRef.current = next;
      if (!isServer()) { saveHousehold(next); return next; }
      clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(async () => {
        try {
          const r = await srv("/api/household", { method: "PUT", body: { version: versionRef.current, data: householdRef.current } });
          if (r.status === 409) {
            versionRef.current = r.version;
            setHousehold(streakFix(r.data));
            setToast("🔄 Updated from another device");
            setTimeout(() => setToast(null), 2200);
          } else versionRef.current = r.version;
        } catch {}
      }, 700);
      return next;
    });
  };

  const observeSkill = (skill, obs) => patchMember(m => observe(m, skill, obs));

  // speak the proactive daily greeting once the member's own voice/persona is bound
  useEffect(() => {
    if (route === "app" && pendingGreet && member?.guided) {
      const t = setTimeout(() => { tts.say(pendingGreet); setPendingGreet(null); }, 500);
      return () => clearTimeout(t);
    }
  }, [route, pendingGreet, member?.id, member?.guided]);

  const addWords = (words) => patchMember(m => {
    const existing = new Set(m.deck.map(c => c.term.toLowerCase()));
    const fresh = (words || []).filter(w => w?.term && !existing.has(w.term.toLowerCase()))
      .map(w => ({ id: uid(), term: w.term, translation: w.translation || "", example: w.example || "", due: Date.now() + 4 * 3600000, interval: DAY, reps: 0, lapses: 0 }));
    return { ...m, deck: [...m.deck, ...fresh] };
  });

  const gradeCard = (id, g) => patchMember(m => ({
    ...m,
    deck: m.deck.map(c => {
      if (c.id !== id) return c;
      if (g === "again") return { ...c, due: Date.now() + 600000, interval: DAY, reps: c.reps + 1, lapses: c.lapses + 1 };
      const mult = g === "easy" ? 3.2 : 2.2;
      const interval = c.reps === 0 ? DAY : Math.min(c.interval * mult, 120 * DAY);
      return { ...c, due: Date.now() + interval, interval, reps: c.reps + 1 };
    }),
  }));

  const pinWord = household?.type === "classroom" ? "Teacher" : "Parent";
  const openAssignments = member ? (household.assignments || []).filter(a =>
    !a.done?.[member.id]
    && (a.kind !== "story" || member.ageBand === "child")
    && (a.kind !== "listening" || member.ageBand !== "child")
  ) : [];
  const goAssignment = (kind) => {
    if (kind === "lesson") setMode("lesson");
    else if (kind === "listening") setMode("listen");
    else if (kind === "talk") setTab("talk");
    else if (kind === "story") setTab(member?.ageBand === "child" ? "story" : "talk");
  };

  const award = (xp, kind) => {
    const t = todayStr();
    const akind = kind === "listen" ? "listening" : kind;
    let completed = false;
    const members = household.members.map(m => {
      if (m.id !== activeId) return m;
      const stats = { ...m.stats, xp: m.stats.xp + xp };
      if (stats.lastDay !== t) { stats.streak += 1; stats.lastDay = t; }
      if (kind === "lesson") stats.lessons += 1;
      if (kind === "talk") stats.talks += 1;
      if (kind === "story") stats.stories = (stats.stories || 0) + 1;
      return { ...m, stats };
    });
    const assignments = (household.assignments || []).map(a => {
      if (!completed && a.kind === akind && !a.done?.[activeId]) {
        completed = true;
        return { ...a, done: { ...(a.done || {}), [activeId]: Date.now() } };
      }
      return a;
    });
    persist({ ...household, members, assignments });
    const kid = member?.ageBand === "child";
    const gain = kid ? `+${Math.max(1, Math.floor(xp / 10))} ⭐` : `+${xp} XP`;
    sfx("ding");
    setToast(completed ? `✅ Assignment done! ${gain}` : gain);
    setTimeout(() => setToast(null), 2200);
  };

  const enterMember = (id) => {
    const m = household.members.find(x => x.id === id);
    setActiveId(id); setTab("home"); setMode(null); setRoute("app");
    // proactive daily greeting + rule-based nudge
    const t = todayStr();
    if (m && m.stats.lastGreet !== t) {
      const due = m.deck.filter(c => c.due <= Date.now()).length;
      const kid = m.ageBand === "child";
      const n = kid ? null
        : due > 0 ? `Welcome back! ${due} word${due > 1 ? "s are" : " is"} ready to review — two minutes and they're locked in.`
        : m.stats.streak >= 2 ? `Day ${m.stats.streak + 1} — your streak is alive. Today's lesson is ready when you are.`
        : `I've written today's lesson around ${m.profile.interests[0]?.toLowerCase() || "your goal"}. Shall we?`;
      setNudge(n);
      persist({ ...household, members: household.members.map(x => x.id === id ? { ...x, stats: { ...x.stats, lastGreet: t } } : x) });
      // proactive spoken greeting (only for returning members — first-timers get the guided tour instead)
      if (m.guided) {
        const tut = tutorFor(m);
        const greet = kid
          ? `Hi ${m.name}! ${tut.name} missed you! Ready to play?`
          : `${m.profile.target === "es" ? `¡Hola ${m.name}!` : `Hi ${m.name}!`} ${n || "Ready when you are."}`;
        setPendingGreet(greet);
      } else setPendingGreet(null);
    } else setNudge(null);
  };

  /* ── routing ── */
  if (!booted) return <div className="f-body" style={{ minHeight: "100vh", background: MIST, display: "flex", alignItems: "center", justifyContent: "center" }}><Fonts /><Orb accent="#0E7C6B" size={64} /></div>;

  if (route === "invite") return (
    <div style={{ minHeight: "100vh", background: MIST, color: INK }}>
      <Fonts />
      <InviteLanding onDone={async () => {
        try {
          const r = await srv("/api/household");
          versionRef.current = r.version;
          setHousehold(streakFix(r.data));
          const { data: { session } } = await supabase.auth.getSession();
          try { localStorage.setItem("lingua-token", session?.access_token || ""); } catch {}
          setSignedIn(true);
          const mine = r.data.members.find(m => m.id === session?.user?.id);
          if (mine) enterMember(mine.id); else setRoute("picker");
        } catch { setRoute("auth"); }
      }} />
    </div>
  );

  if (!signedIn) return (
    <div style={{ minHeight: "100vh", background: MIST, color: INK }}>
      <Fonts />
      <AuthFlow household={household}
        remote={isServer()}
        onRemoteAuth={async (r) => {
          versionRef.current = r.version;
          setHousehold(r.data);
          setSignedIn(true);
          // Existing account with a pending household invite (emailed a join
          // link, or they signed in before clicking it) — accept + finish profile.
          if (isSupabase()) {
            try {
              const accepted = await supaAcceptPendingInvite();
              if (accepted?.joined) {
                const fresh = await srv("/api/household");
                versionRef.current = fresh.version;
                setHousehold(streakFix(fresh.data));
                const { data: { user } } = await supabase.auth.getUser();
                if (!fresh.data.members?.some(m => m.id === user?.id)) {
                  setRoute("invite");
                  return;
                }
                r = fresh;
              }
            } catch {}
          }
          if (!r.data?.members?.length) setRoute("setup-parent");
          else if (r.data.type === "individual") { const first = r.data.members[0]; setActiveId(first.id); setTab("home"); setRoute("app"); }
          else setRoute("picker");
        }}
        onSignedIn={() => {
          setSignedIn(true);
          if (!household?.members?.length) setRoute("setup-parent");
          else if (household.type === "individual") enterMember(household.members[0].id);
          else setRoute("picker");
        }}
        onCreated={(account, type) => { persist({ account, type, members: [] }); setSignedIn(true); setRoute("setup-parent"); }} />
    </div>
  );

  if (route === "setup-parent") return (
    <div style={{ minHeight: "100vh", background: MIST, color: INK }}>
      <Fonts />
      <SetupMember role="parent" context={household?.type} defaults={{ name: household?.account?.name, id: ownerUserId }}
        onDone={(m) => {
          persist({ ...household, members: [...household.members, m] });
          if (household.type === "classroom") setRoute("setup-class");
          else enterMember(m.id);
        }} />
    </div>
  );

  if (route === "setup-class") return (
    <div style={{ minHeight: "100vh", background: MIST, color: INK }}>
      <Fonts />
      <SetupClass onDone={(name) => {
        const code = Math.random().toString(36).slice(2, 8).toUpperCase();
        persist({ ...household, className: name, classCode: code, assignments: [] });
        enterMember(household.members[0].id);
      }} />
    </div>
  );

  if (route === "picker") return (
    <div style={{ minHeight: "100vh", background: MIST, color: INK }}>
      <Fonts />
      <MemberPicker household={household}
        onPick={(id) => {
          const target = household.members.find(m => m.id === id);
          if (target?.isParent) requirePin(`${target.name}'s profile is protected`, () => enterMember(id));
          else enterMember(id);
        }}
        onAdd={() => requirePin(`${pinWord} PIN required to add ${household.type === "classroom" ? "students" : "members"}`, () => setRoute("add-choice"))}
        onSignOut={() => { if (isSupabase()) supaLogout(); try { localStorage.removeItem("lingua-token"); } catch {} setSignedIn(false); setActiveId(null); setPinOk(false); setRoute("auth"); }} />
      {pinModal && (
        <PinPad mode={pinModal.mode} title={pinModal.title} pinHash={household.pinHash}
          onSuccess={pinModal.onSuccess} onSet={pinModal.onSet} onClose={() => setPinModal(null)} />
      )}
    </div>
  );

  if (route === "add-choice") return (
    <div style={{ minHeight: "100vh", background: MIST, color: INK }}>
      <Fonts />
      <div style={{ maxWidth: 440, margin: "0 auto", padding: "64px 22px" }}>
        <h1 className="f-display" style={{ fontSize: 28, fontWeight: 600, marginBottom: 18 }}>Who are you adding?</h1>
        {(household.type === "classroom"
          ? [["child", "🧑‍🎓", "A young student (5–17)", "Kid-safe tutor · story mode for the little ones"], ["adult", "🧑‍💼", "An adult student", "Full experience with their own tutor"]]
          : [["child", "🧒", "A child or teen", "You manage their profile · kid-safe tutor · story mode"], ["adult", "🧑", "Another adult", "Full experience with their own tutor"]]
        ).map(([r, e, t, d]) => (
          <Card key={r} onClick={() => {
            setAddRole(r);
            // Adults in a family household get a real email invite with
            // their own login; children (any household type) and classroom
            // "adult students" keep the existing parent-managed local flow.
            setRoute(r === "adult" && household.type === "family" ? "invite-send" : "add-member");
          }} style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontSize: 30 }}>{e}</span>
            <div style={{ flex: 1 }}>
              <div className="f-body" style={{ fontWeight: 600 }}>{t}</div>
              <div className="f-body" style={{ fontSize: 13, color: FADE }}>{d}</div>
            </div>
            <ChevronRight size={16} color={FADE} />
          </Card>
        ))}
        <button onClick={() => setRoute("picker")} className="f-body" style={backLink}>Back</button>
      </div>
    </div>
  );

  if (route === "add-member") return (
    <div style={{ minHeight: "100vh", background: MIST, color: INK }}>
      <Fonts />
      <SetupMember role={addRole} context={household.type} defaults={{ native: household.members[0]?.profile.native }}
        onCancel={() => setRoute("picker")}
        onDone={(m) => { persist({ ...household, members: [...household.members, m] }); setRoute("picker"); }} />
    </div>
  );

  if (route === "invite-send") return (
    <div style={{ minHeight: "100vh", background: MIST, color: INK }}>
      <Fonts />
      <InviteSend onCancel={() => setRoute("add-choice")} onSent={() => setRoute("picker")} />
    </div>
  );

  /* ── member app ── */
  if (!member) { setRoute("picker"); return null; }
  const kid = member.ageBand === "child";
  const bg = kid ? KID_BG : MIST;
  const isAdult = member.ageBand === "adult";

  const TABS = kid
    ? [{ id: "home", icon: Home, label: "Home" }, { id: "story", icon: BookOpen, label: "Story" }, { id: "talk", icon: Mic, label: "Talk" }, { id: "review", icon: Star, label: "Treasure" }, { id: "profile", icon: User, label: "Me" }]
    : [
      { id: "home", icon: Sparkles, label: "Today" },
      { id: "review", icon: Layers, label: "Review" },
      { id: "talk", icon: Mic, label: "Talk" },
      { id: "translate", icon: Languages, label: "Translate" },
      ...(isAdult && household.type === "family" ? [{ id: "family", icon: Users, label: "Family" }] : []),
      ...(member.isParent && household.type === "classroom" ? [{ id: "class", icon: GraduationCap, label: "Class" }] : []),
      { id: "profile", icon: User, label: "Profile" },
    ];

  return (
    <div className="f-body" style={{ minHeight: "100vh", background: bg, color: INK, overflowX: "hidden", maxWidth: "100vw" }}>
      <Fonts />
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "24px 18px 100px", width: "100%", boxSizing: "border-box", overflowX: "hidden" }}>
        {mode === "lesson" ? (
          <LessonView member={member} update={updateMember} tts={tts} accent={accent} addWords={addWords} observeSkill={observeSkill}
            assignedTopic={openAssignments.find(a => a.kind === "lesson" && a.topic)?.topic}
            finish={(xp) => { award(xp, "lesson"); setMode(null); setTab("home"); }} exit={() => { tts.stop(); setMode(null); }} />
        ) : mode === "listen" ? (
          <ListeningLab member={member} voices={voices} accent={accent} addWords={addWords} observeSkill={observeSkill}
            finish={(xp) => { award(xp, "listen"); setMode(null); setTab("home"); }} exit={() => setMode(null)} />
        ) : mode === "course" ? (
          <CourseView member={member} update={updateMember} patch={patchMember} tts={tts} accent={accent} addWords={addWords} observeSkill={observeSkill}
            finish={(xp) => { award(xp, "lesson"); setMode(null); setTab("home"); }} exit={() => { tts.stop(); setMode(null); }} />
        ) : (
          <>
            {tab === "home" && (kid
              ? <ChildHome member={member} accent={accent} assignments={openAssignments} onGoAssignment={goAssignment} goLesson={() => setMode("lesson")} goCourse={() => setMode("course")} goStory={() => setTab("story")} goTalk={() => setTab("talk")} goReview={() => setTab("review")} />
              : <AdultHome member={member} accent={accent} nudge={nudge} assignments={openAssignments} onGoAssignment={goAssignment} goLesson={() => setMode("lesson")} goCourse={() => setMode("course")} goTalk={() => setTab("talk")} goReview={() => setTab("review")} goListen={() => setMode("listen")} />)}
            {tab === "story" && kid && <StoryView member={member} tts={tts} accent={accent} addWords={addWords} observeSkill={observeSkill} finish={(xp) => { award(xp, "story"); }} />}
            {tab === "review" && <ReviewView member={member} tts={tts} accent={accent} grade={gradeCard} observeSkill={observeSkill} finish={(xp) => award(xp, "review")} />}
            {tab === "talk" && <TalkView member={member} tts={tts} accent={accent} addWords={addWords} observeSkill={observeSkill} update={updateMember} finish={(xp) => award(xp, "talk")} />}
            {tab === "translate" && !kid && <TranslateView member={member} tts={tts} accent={accent} addWords={addWords} />}
            {tab === "family" && isAdult && household.type === "family" && (
              <FamilyView household={household} accent={accent}
                viewerIsOwner={member.isParent}
                viewerNative={member.profile.native}
                onSetMemberParent={(id, isParent) => persist({ ...household, members: household.members.map(m => m.id === id ? { ...m, isParent } : m) })}
                onSaveDigest={(d) => persist({ ...household, digest: d })}
                pinNudge={!household.pinHash && household.members.some(m => m.ageBand !== "adult")}
                onSetPin={startSetPin}
                onAdd={() => requirePin("Parent PIN required to add members", () => setRoute("add-choice"))}
                onSwitch={(id) => {
                  const target = household.members.find(m => m.id === id);
                  if (target?.isParent && target.id !== activeId) requirePin(`${target.name}'s profile is protected`, () => enterMember(id));
                  else enterMember(id);
                }}
                onRemove={(id) => requirePin("Parent PIN required to remove a profile", () => {
                  if (id !== activeId) persist({ ...household, members: household.members.filter(m => m.id !== id) });
                })} />
            )}
            {tab === "class" && member.isParent && household.type === "classroom" && (
              <ClassView household={household} accent={accent}
                viewerNative={member.profile.native}
                onSaveDigest={(d) => persist({ ...household, digest: d })}
                pinNudge={!household.pinHash && household.members.some(m => !m.isParent)}
                onSetPin={startSetPin}
                onAdd={() => requirePin("Teacher PIN required to add students", () => setRoute("add-choice"))}
                onSwitch={(id) => enterMember(id)}
                onRemove={(id) => requirePin("Teacher PIN required to remove a student", () => {
                  if (id !== activeId) persist({ ...household, members: household.members.filter(m => m.id !== id) });
                })}
                onCreateAssignment={(f) => persist({ ...household, assignments: [...(household.assignments || []), { id: uid(), kind: f.kind, topic: f.topic.trim(), due: f.due.trim(), createdAt: Date.now(), done: {} }] })}
                onDeleteAssignment={(id) => persist({ ...household, assignments: (household.assignments || []).filter(a => a.id !== id) })} />
            )}
            {tab === "profile" && (
              <ProfileView member={member} household={household} accent={accent} tts={tts} voices={voices}
                update={updateMember}
                pin={{ has: !!household.pinHash, set: startSetPin, change: startChangePin, remove: startRemovePin }}
                upgrade={() => { persist({ ...household, type: "family" }); setRoute("add-choice"); }}
                switchMember={() => { tts.stop(); setPinOk(false); setRoute("picker"); }}
                signOut={() => { tts.stop(); if (isSupabase()) supaLogout(); try { localStorage.removeItem("lingua-token"); } catch {} setSignedIn(false); setActiveId(null); setPinOk(false); setRoute("auth"); }}
                reset={() => requirePin(`${pinWord} PIN required to delete everything`, async () => {
                  if (isServer()) {
                    try { await srv("/api/household", { method: "DELETE" }); } catch {}
                    try { localStorage.removeItem("lingua-token"); } catch {}
                  } else {
                    try { await window.storage.delete(STORE); } catch {}
                  }
                  setHousehold(null); setSignedIn(false); setActiveId(null); setPinOk(false); setRoute("auth");
                })} />
            )}
          </>
        )}
      </div>

      {toast && (
        <div className="rise f-body" style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", background: INK, color: GOLD, fontWeight: 700, padding: "9px 18px", borderRadius: 999, fontSize: 15, zIndex: 60 }}>
          {toast}
        </div>
      )}

      {!online && (
        <div className="rise f-body" role="status" style={{ position: "fixed", top: toast ? 64 : 20, left: "50%", transform: "translateX(-50%)", background: "#FFF6E3", color: "#8A6A1F", border: "1px solid #E8D5A3", fontWeight: 600, padding: "8px 16px", borderRadius: 999, fontSize: 13, zIndex: 59, whiteSpace: "nowrap" }}>
          📡 Offline — reviews & saved words still work
        </div>
      )}

      {pinModal && (
        <PinPad mode={pinModal.mode} title={pinModal.title} pinHash={household.pinHash}
          onSuccess={pinModal.onSuccess} onSet={pinModal.onSet} onClose={() => setPinModal(null)} />
      )}

      {!member.guided && route === "app" && !mode && (
        <GuidedTour member={member} tts={tts} accent={accent}
          onDone={() => updateMember({ ...member, guided: true })} />
      )}

      {!mode && (
        <nav aria-label="Main" style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#ffffffee", backdropFilter: "blur(10px)", borderTop: `1px solid ${LINE}` }}>
          <div style={{ maxWidth: 520, margin: "0 auto", display: "flex" }}>
            {TABS.map(t => {
              const active = tab === t.id;
              const Icon = t.icon;
              return (
                <button key={t.id} onClick={() => { tts.stop(); setTab(t.id); }} aria-current={active ? "page" : undefined} className="f-body" style={{
                  flex: 1, background: "none", border: "none", cursor: "pointer",
                  padding: "10px 0 14px", display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                  color: active ? accent : FADE,
                }}>
                  <Icon size={20} strokeWidth={active ? 2.4 : 1.8} />
                  <span style={{ fontSize: 10.5, fontWeight: active ? 700 : 500 }}>{t.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}


/* ───────────────────────────── Root ───────────────────────────── */

export default function Root() {
  const [mode, setMode] = useState(APP_MODE);
  const [ready, setReady] = useState(hasAiAccess);
  const wrap = (child) => (
    <div className="f-body" style={{ minHeight: "100vh", background: MIST, color: INK }}>
      <Fonts />
      {child}
    </div>
  );
  if (!mode) return wrap(<ModeGate onDone={() => setMode(APP_MODE())} />);
  if (mode === "local" && !ready) return wrap(<ApiKeyGate onDone={() => setReady(true)} />);
  return <LinguaApp />;
}
 