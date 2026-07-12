import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
// minimal .env loader — no dependency needed
const envPath = path.join(dir, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
export const DATA_DIR = path.join(dir, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
export const PORT = Number(process.env.PORT || 8787);
export const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
export const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY || "";
export const ORIGINS = (process.env.CLIENT_ORIGIN || "*").split(",").map(s => s.trim());
