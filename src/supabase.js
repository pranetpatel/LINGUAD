/* Supabase client + data layer — the free-tier replacement for server/.
   Auth: Supabase Auth (email/password). Data: `households` table, RLS-scoped
   to the signed-in user, same {version, data} shape server/stores/*.js used.
   AI/TTS: proxied through Vercel serverless functions (api/ai.js, api/tts.js)
   so provider keys never reach the browser and live alongside the rest of
   the Vercel env config. See supabase/ for schema, SUPABASE_SETUP.md for the
   one-time project setup. */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const supabaseConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = supabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const freshHousehold = (name, email, type) => ({ account: { name, email }, type, members: [] });

async function authedFetch(path, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`/api/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  return res;
}

export async function supaSignup({ name, email, password, type }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, type } },
  });
  if (error) throw Object.assign(new Error(error.message), { status: error.status || 400 });
  const accountId = data.user?.id;
  if (!accountId) throw new Error("Sign-up didn't return a user (check email confirmation settings)");

  // RLS policies require auth.uid() = account_id. signUp often returns no session
  // when email confirmation is enabled, so the insert would fail with an RLS error.
  let session = data.session;
  if (!session) {
    const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signInErr) {
      const needsConfirm = /confirm/i.test(signInErr.message);
      throw Object.assign(
        new Error(needsConfirm
          ? "Account created — check your email to confirm, then sign in."
          : signInErr.message),
        { status: signInErr.status || 400 },
      );
    }
    session = signInData.session;
  }

  const init = freshHousehold(name, email, type);
  const { data: existing, error: selErr } = await supabase
    .from("households")
    .select("version, data")
    .eq("account_id", accountId)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);
  if (existing) {
    return { token: session?.access_token || accountId, version: existing.version, data: existing.data };
  }
  const { error: insErr } = await supabase.from("households").insert({ account_id: accountId, version: 1, data: init });
  if (insErr) throw new Error(insErr.message);
  // App.jsx stores this in localStorage as a boot-time "am I signed in" flag;
  // the real credential Supabase calls actually use is its own session, kept
  // internally by supabase-js — this token is never sent anywhere by us.
  return { token: session?.access_token || accountId, version: 1, data: init };
}

export async function supaLogin({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw Object.assign(new Error(error.message), { status: error.status || 401 });
  const accountId = data.user.id;
  let { data: row, error: selErr } = await supabase.from("households").select("version, data").eq("account_id", accountId).maybeSingle();
  if (selErr) throw new Error(selErr.message);
  if (!row) {
    const init = freshHousehold(
      data.user.user_metadata?.name || "",
      email,
      data.user.user_metadata?.type || "family",
    );
    const { error: insErr } = await supabase.from("households").insert({ account_id: accountId, version: 1, data: init });
    if (insErr) throw new Error(insErr.message);
    row = { version: 1, data: init };
  }
  return { token: data.session?.access_token || accountId, version: row.version, data: row.data };
}

export async function supaLogout() {
  await supabase.auth.signOut();
}

export async function supaGetHousehold() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw Object.assign(new Error("Not signed in"), { status: 401 });
  const { data: row, error } = await supabase.from("households").select("version, data").eq("account_id", user.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw Object.assign(new Error("No household"), { status: 404 });
  return { version: row.version, data: row.data };
}

/** Optimistic put: mirrors server/stores/*.js `put()` — a version mismatch
    means someone else wrote first, so the caller must re-pull and retry. */
export async function supaPutHousehold(baseVersion, data) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw Object.assign(new Error("Not signed in"), { status: 401 });
  const { data: updated, error } = await supabase
    .from("households")
    .update({ version: baseVersion + 1, data })
    .eq("account_id", user.id)
    .eq("version", baseVersion)
    .select("version")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) {
    const { data: cur, error: curErr } = await supabase.from("households").select("version, data").eq("account_id", user.id).single();
    if (curErr) throw new Error(curErr.message);
    return { ok: false, version: cur.version, data: cur.data };
  }
  return { ok: true, version: updated.version };
}

export async function supaResetHousehold(fresh) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw Object.assign(new Error("Not signed in"), { status: 401 });
  const { data: cur } = await supabase.from("households").select("version").eq("account_id", user.id).maybeSingle();
  const version = (cur?.version || 0) + 1;
  const { error } = await supabase.from("households").update({ version, data: fresh }).eq("account_id", user.id);
  if (error) throw new Error(error.message);
  return { version, data: fresh };
}

export async function supaAskAI(messages, maxTokens) {
  const res = await authedFetch("ai", { messages, maxTokens });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `API ${res.status}`), { status: res.status });
  return data;
}

export async function supaTts(text, gender) {
  const res = await authedFetch("tts", { text, gender });
  if (!res.ok) throw new Error(String(res.status));
  return await res.blob();
}
