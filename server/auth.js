/* Account auth: scrypt password hashing + HMAC-signed bearer tokens.
   Zero-dependency by design; the token format is {sub, exp} base64url + HMAC. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./env.js";
import { accounts, households } from "./store.js";

const secretFile = path.join(DATA_DIR, "secret");
const SECRET = process.env.JWT_SECRET
  || (fs.existsSync(secretFile) ? fs.readFileSync(secretFile, "utf8")
      : (() => { const s = crypto.randomBytes(32).toString("hex"); fs.writeFileSync(secretFile, s); return s; })());

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const hmac = (s) => crypto.createHmac("sha256", SECRET).update(s).digest("base64url");

export function signToken(sub, days = 60) {
  const payload = b64u(JSON.stringify({ sub, exp: Date.now() + days * 86400000 }));
  return `${payload}.${hmac(payload)}`;
}
export function verifyToken(token) {
  const [payload, sig] = String(token || "").split(".");
  if (!payload || sig !== hmac(payload)) return null;
  try {
    const { sub, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return exp > Date.now() ? sub : null;
  } catch { return null; }
}

const scrypt = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString("hex");

export async function signup({ name, email, password, type }) {
  email = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw httpErr(400, "Invalid email");
  if (String(password || "").length < 6) throw httpErr(400, "Password too short");
  if (await accounts.byEmail(email)) throw httpErr(409, "An account with this email already exists");
  const salt = crypto.randomBytes(16).toString("hex");
  const safeType = ["family", "individual", "classroom"].includes(type) ? type : "family";
  const acc = { id: crypto.randomUUID(), name: String(name || "").trim(), email, salt, passHash: scrypt(password, salt), type: safeType };
  await accounts.create(acc);
  const hh = await households.init(acc.id, { account: { name: acc.name, email: acc.email }, type: acc.type, members: [] });
  return { token: signToken(acc.id), version: hh.version, data: hh.data };
}

export async function login({ email, password }) {
  const acc = await accounts.byEmail(String(email || "").trim().toLowerCase());
  if (!acc || scrypt(String(password || ""), acc.salt) !== acc.passHash) throw httpErr(401, "Email or password doesn't match");
  const hh = (await households.get(acc.id)) || (await households.init(acc.id, { account: { name: acc.name, email: acc.email }, type: acc.type, members: [] }));
  return { token: signToken(acc.id), version: hh.version, data: hh.data };
}

export function requireAuth(req, res, next) {
  const sub = verifyToken((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
  if (!sub) return res.status(401).json({ error: "Not signed in" });
  req.accountId = sub;
  next();
}
export const httpErr = (status, message) => Object.assign(new Error(message), { status });
