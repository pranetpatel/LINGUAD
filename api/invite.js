// Vercel serverless function: sends a household invite email via Supabase
// Auth's admin API. Requires the service-role key (server-only secret, never
// exposed to the browser — same trust boundary as OPENAI_API_KEY/ai.js).
//
// New emails → inviteUserByEmail (creates auth user + sends invite mail).
// Existing Lingua accounts → leave a pending household_invites row and send a
// magic-link OTP to /app/invite; accept-invite.js finishes membership join.
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseUser } from "./_auth.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SITE_URL = process.env.SITE_URL || "";
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "hello@lingua.family";

const alreadyRegistered = (msg = "") =>
  /already\s*(been\s*)?(registered|exists)|user.*exist/i.test(msg);

async function rollbackInvite(admin, householdId, email) {
  await admin.from("household_invites").delete()
    .eq("household_id", householdId).eq("email", email).eq("status", "pending");
}

/** Look up an auth user by email. generateLink returns the user for existing accounts. */
async function findAuthUserByEmail(admin, email) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !data?.user?.id) return { user: null, error };
  return { user: data.user, error: null };
}

/** Refuse to invite someone who already owns a multi-member household. */
async function assertCanLeaveCurrentHouseholds(admin, userId, targetHouseholdId) {
  const { data: memberships, error } = await admin
    .from("household_members")
    .select("household_id, role")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  for (const m of memberships || []) {
    if (m.household_id === targetHouseholdId) {
      return { alreadyMember: true };
    }
    if (m.role !== "owner") continue;
    const { count, error: countErr } = await admin
      .from("household_members")
      .select("*", { count: "exact", head: true })
      .eq("household_id", m.household_id);
    if (countErr) throw new Error(countErr.message);
    if ((count || 0) > 1) {
      return {
        blocked: true,
        error: "This person already owns a Lingua household with other members. They need to use a different email, or leave that household first.",
      };
    }
  }
  return { alreadyMember: false, blocked: false };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await requireSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });
  if (!SERVICE_ROLE_KEY || !SUPABASE_URL || !SITE_URL) {
    return res.status(503).json({ error: "Invites are not configured on this server" });
  }

  const { email, name, ageBand, householdId, role, memberSeed } = req.body || {};
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Valid email required" });
  if (!householdId) return res.status(400).json({ error: "householdId required" });
  // Defense in depth: child profiles are never invited, even if the client
  // is bypassed — the UI never offers this path for ageBand "child".
  const safeAgeBand = ageBand === "child" ? "adult" : (ageBand || "adult");
  const safeRole = role === "owner" ? "owner" : "member";
  const normalizedEmail = String(email).trim().toLowerCase();

  if (user.email && user.email.toLowerCase() === normalizedEmail) {
    return res.status(400).json({ error: "You can't invite your own email" });
  }

  // Authorize via the caller's own bearer token so RLS/is_household_owner()
  // enforces this exactly as it would for any other client call — the
  // service-role client below is only used for the parts that genuinely
  // require admin privileges (inviting + bypassing invite RLS on insert).
  const authedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.authorization } },
  });
  const { data: isOwner, error: ownerErr } = await authedClient.rpc("is_household_owner", { hh_id: householdId });
  if (ownerErr || !isOwner) return res.status(403).json({ error: "Only the household owner can invite members" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const { error: insErr } = await admin.from("household_invites").insert({
    household_id: householdId,
    email: normalizedEmail,
    role: safeRole,
    invited_by: user.id,
    member_seed: { ...(memberSeed || {}), name: name || "", ageBand: safeAgeBand },
  });
  if (insErr) {
    if (insErr.code === "23505") return res.status(409).json({ error: "An invite is already pending for this email" });
    return res.status(500).json({ error: insErr.message });
  }

  const redirectTo = `${SITE_URL}/app/invite`;
  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(normalizedEmail, {
    redirectTo,
    data: { name: name || "" },
  });

  if (!inviteErr) {
    return res.status(200).json({ ok: true, existingUser: false });
  }

  if (!alreadyRegistered(inviteErr.message)) {
    await rollbackInvite(admin, householdId, normalizedEmail);
    return res.status(400).json({ error: inviteErr.message || "Could not send invite" });
  }

  // ── Existing Lingua account ──────────────────────────────────────────
  const { user: existing, error: findErr } = await findAuthUserByEmail(admin, normalizedEmail);
  if (findErr || !existing) {
    await rollbackInvite(admin, householdId, normalizedEmail);
    return res.status(400).json({
      error: findErr?.message || "This email already has an account, but we couldn't look it up. Ask them to sign in, or try again.",
    });
  }

  let gate;
  try {
    gate = await assertCanLeaveCurrentHouseholds(admin, existing.id, householdId);
  } catch (e) {
    await rollbackInvite(admin, householdId, normalizedEmail);
    return res.status(500).json({ error: e.message });
  }

  if (gate.alreadyMember) {
    await rollbackInvite(admin, householdId, normalizedEmail);
    return res.status(409).json({ error: "This person is already in your household" });
  }
  if (gate.blocked) {
    await rollbackInvite(admin, householdId, normalizedEmail);
    return res.status(409).json({ error: gate.error });
  }

  // Pending invite stays; send a magic-link so they land on /app/invite to accept.
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: otpErr } = await anon.auth.signInWithOtp({
    email: normalizedEmail,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
  });

  if (otpErr) {
    // Invite row is still useful — they can be re-emailed, or accept after signing in
    // if we later wire a sign-in accept path. Surface a clear partial-success.
    return res.status(200).json({
      ok: true,
      existingUser: true,
      emailed: false,
      message: `They already have a Lingua account. Invite is ready, but we couldn't email them (${otpErr.message}). Ask them to open ${SITE_URL}/app/invite after signing in, or contact ${CONTACT_EMAIL}.`,
    });
  }

  return res.status(200).json({
    ok: true,
    existingUser: true,
    emailed: true,
    message: "They already have a Lingua account — we emailed them a link to join your household.",
  });
}
