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

/** Resolves the household a user belongs to via household_members — works
    for both the original owner and any invited member, since 0003 made
    household_id the real key (account_id only means "who created it"). */
async function myHouseholdId(userId) {
  const { data, error } = await supabase
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.household_id || null;
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

  // The on_auth_user_created trigger (0002/0003) already creates the
  // household (or, if this email had a pending invite, joins that
  // household instead) as part of the auth.users insert — this just reads
  // whatever it produced. The manual insert below is a fallback only for
  // the rare case the trigger hasn't landed yet (e.g. local dev without
  // migrations applied).
  const init = freshHousehold(name, email, type);
  const householdId = await myHouseholdId(accountId);
  if (householdId) {
    const { data: existing, error: selErr } = await supabase
      .from("households")
      .select("version, data")
      .eq("id", householdId)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message);
    if (existing) {
      return { token: session?.access_token || accountId, version: existing.version, data: existing.data };
    }
  }
  const { error: insErr } = await supabase.from("households").insert({ account_id: accountId, id: accountId, version: 1, data: init });
  if (insErr) throw new Error(insErr.message);
  const { error: memErr } = await supabase.from("household_members").insert({ household_id: accountId, user_id: accountId, role: "owner" });
  if (memErr) throw new Error(memErr.message);
  // App.jsx stores this in localStorage as a boot-time "am I signed in" flag;
  // the real credential Supabase calls actually use is its own session, kept
  // internally by supabase-js — this token is never sent anywhere by us.
  return { token: session?.access_token || accountId, version: 1, data: init };
}

export async function supaLogin({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw Object.assign(new Error(error.message), { status: error.status || 401 });
  const accountId = data.user.id;
  const householdId = await myHouseholdId(accountId);
  let row = null;
  if (householdId) {
    const { data: found, error: selErr } = await supabase.from("households").select("version, data").eq("id", householdId).maybeSingle();
    if (selErr) throw new Error(selErr.message);
    row = found;
  }
  if (!row) {
    const init = freshHousehold(
      data.user.user_metadata?.name || "",
      email,
      data.user.user_metadata?.type || "family",
    );
    const { error: insErr } = await supabase.from("households").insert({ account_id: accountId, id: accountId, version: 1, data: init });
    if (insErr) throw new Error(insErr.message);
    const { error: memErr } = await supabase.from("household_members").insert({ household_id: accountId, user_id: accountId, role: "owner" });
    if (memErr) throw new Error(memErr.message);
    row = { version: 1, data: init };
  }
  return { token: data.session?.access_token || accountId, version: row.version, data: row.data };
}

export async function supaLogout() {
  await supabase.auth.signOut();
}

async function requireHouseholdId(userId) {
  const householdId = await myHouseholdId(userId);
  if (!householdId) throw Object.assign(new Error("No household"), { status: 404 });
  return householdId;
}

export async function supaGetHousehold() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw Object.assign(new Error("Not signed in"), { status: 401 });
  const householdId = await requireHouseholdId(user.id);
  const { data: row, error } = await supabase.from("households").select("version, data").eq("id", householdId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw Object.assign(new Error("No household"), { status: 404 });
  return { version: row.version, data: row.data };
}

/** Optimistic put: mirrors server/stores/*.js `put()` — a version mismatch
    means someone else wrote first, so the caller must re-pull and retry. */
export async function supaPutHousehold(baseVersion, data) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw Object.assign(new Error("Not signed in"), { status: 401 });
  const householdId = await requireHouseholdId(user.id);
  const { data: updated, error } = await supabase
    .from("households")
    .update({ version: baseVersion + 1, data })
    .eq("id", householdId)
    .eq("version", baseVersion)
    .select("version")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) {
    const { data: cur, error: curErr } = await supabase.from("households").select("version, data").eq("id", householdId).single();
    if (curErr) throw new Error(curErr.message);
    return { ok: false, version: cur.version, data: cur.data };
  }
  return { ok: true, version: updated.version };
}

export async function supaResetHousehold(fresh) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw Object.assign(new Error("Not signed in"), { status: 401 });
  const householdId = await requireHouseholdId(user.id);
  const { data: cur } = await supabase.from("households").select("version").eq("id", householdId).maybeSingle();
  const version = (cur?.version || 0) + 1;
  const { error } = await supabase.from("households").update({ version, data: fresh }).eq("id", householdId);
  if (error) throw new Error(error.message);
  return { version, data: fresh };
}

/** Called by an invited member on their first post-accept load: appends
    their own member object (built client-side via newMember() in App.jsx,
    so shape stays in sync with locally-added members) into the shared
    household's data.members[]. */
export async function supaJoinHousehold(memberPayload, attempt = 0) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw Object.assign(new Error("Not signed in"), { status: 401 });
  const householdId = await requireHouseholdId(user.id);
  const { data: cur, error: curErr } = await supabase.from("households").select("version, data").eq("id", householdId).single();
  if (curErr) throw new Error(curErr.message);
  if ((cur.data.members || []).some(m => m.id === memberPayload.id)) {
    return { version: cur.version, data: cur.data };
  }
  const nextData = { ...cur.data, members: [...(cur.data.members || []), memberPayload] };
  const { data: updated, error } = await supabase
    .from("households")
    .update({ version: cur.version + 1, data: nextData })
    .eq("id", householdId)
    .eq("version", cur.version)
    .select("version")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) {
    // Someone else wrote first — retry against the fresh version rather
    // than reporting success for a write that never landed.
    if (attempt >= 3) throw new Error("Could not join household — please try again");
    return supaJoinHousehold(memberPayload, attempt + 1);
  }
  return { version: updated.version, data: nextData };
}

export async function supaInviteMember({ email, name, ageBand, role, memberSeed }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw Object.assign(new Error("Not signed in"), { status: 401 });
  const householdId = await requireHouseholdId(user.id);
  const res = await authedFetch("invite", { email, name, ageBand, role, memberSeed, householdId });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `API ${res.status}`), { status: res.status });
  return data;
}

export async function supaListInvites() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw Object.assign(new Error("Not signed in"), { status: 401 });
  const householdId = await requireHouseholdId(user.id);
  const { data, error } = await supabase
    .from("household_invites")
    .select("id, email, role, status, member_seed, created_at")
    .eq("household_id", householdId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function supaRevokeInvite(inviteId) {
  const { error } = await supabase.from("household_invites").update({ status: "revoked" }).eq("id", inviteId);
  if (error) throw new Error(error.message);
}

export async function supaSetMemberRole(userId, role) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw Object.assign(new Error("Not signed in"), { status: 401 });
  const householdId = await requireHouseholdId(user.id);
  if (role === "member") {
    const { data: owners, error: ownersErr } = await supabase
      .from("household_members")
      .select("user_id")
      .eq("household_id", householdId)
      .eq("role", "owner");
    if (ownersErr) throw new Error(ownersErr.message);
    if ((owners || []).length <= 1 && owners?.[0]?.user_id === userId) {
      throw new Error("A household needs at least one owner — promote someone else first.");
    }
  }
  const { data: updated, error } = await supabase
    .from("household_members")
    .update({ role })
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .select("user_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!updated) throw new Error("This member doesn't have their own login yet — only invited members can have their access level changed here.");
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
