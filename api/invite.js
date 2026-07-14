 // Vercel serverless function: sends a household invite email via Supabase
 // Auth's admin API. Requires the service-role key (server-only secret, never
 // exposed to the browser — same trust boundary as OPENAI_API_KEY/ai.js).
 //
 // New emails → inviteUserByEmail (creates auth user + sends invite mail).
 // If SMTP is broken (common: 535 auth failure) → generateLink and return a
 // copy-paste invite URL so the household still isn't blocked on email.
 // Existing Lingua accounts → pending invite + magic-link OTP (or share link).
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseUser } from "./_auth.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SITE_URL = (process.env.SITE_URL || "").replace(/\/$/, "");
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "hello@lingua.family";

function authErrText(err, fallback = "Request failed") {
  if (!err) return fallback;
  const parts = [err.message, err.msg, err.error_description, err.error, err.code]
    .filter((v) => typeof v === "string" && v.trim() && v.trim() !== "{}");
  return [...new Set(parts.map((s) => s.trim()))].join(" — ") || fallback;
}

function isExistingUserError(err) {
  if (!err) return false;
  if (err.status === 422 || err.statusCode === 422) return true;
  const blob = `${err.message || ""} ${err.msg || ""} ${err.code || ""} ${err.error_code || ""}`;
  return /email_exists|user_already_exists|already\s*(been\s*)?(registered|exists)|user.*exist/i.test(blob);
}

/** SMTP / mailer failures — user may have been created then rolled back. */
function isEmailDeliveryError(err) {
  if (!err) return false;
  const blob = `${err.message || ""} ${err.msg || ""} ${err.code || ""}`;
  return /error sending|smtp|535|authentication failed|invite email|unexpected_failure/i.test(blob)
    || err.status === 500
    || blob.trim() === "{}";
}

async function rollbackInvite(admin, householdId, email) {
  await admin.from("household_invites").delete()
    .eq("household_id", householdId).eq("email", email).eq("status", "pending");
}

async function findAuthUserByEmail(admin, email) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${SITE_URL}/app/invite` },
  });
  if (data?.user?.id) return { user: data.user, error: null, actionLink: data.properties?.action_link || null };

  for (let page = 1; page <= 10; page++) {
    const { data: pageData, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listErr) return { user: null, error: error || listErr, actionLink: null };
    const found = (pageData?.users || []).find((u) => (u.email || "").toLowerCase() === email);
    if (found) return { user: found, error: null, actionLink: null };
    if (!pageData?.users?.length || pageData.users.length < 200) break;
  }
  return { user: null, error: error || new Error("User not found in Auth"), actionLink: null };
}

async function assertCanLeaveCurrentHouseholds(admin, userId, targetHouseholdId) {
  const { data: memberships, error } = await admin
    .from("household_members")
    .select("household_id, role")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);

  for (const m of memberships || []) {
    if (m.household_id === targetHouseholdId) return { alreadyMember: true };
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

/** Create invitee via admin generateLink (no SMTP) and return the action URL. */
async function createInviteLink(admin, email, name, redirectTo) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo, data: { name: name || "" } },
  });
  if (error) return { link: null, error };
  const link = data?.properties?.action_link || data?.properties?.hashed_token && null;
  return {
    link: data?.properties?.action_link || null,
    user: data?.user || null,
    error: data?.properties?.action_link ? null : new Error("No invite link returned"),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await requireSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });
  if (!SERVICE_ROLE_KEY || !SUPABASE_URL || !SITE_URL) {
    return res.status(503).json({
      error: "Invites are not configured on this server",
      missing: {
        serviceRole: !SERVICE_ROLE_KEY,
        supabaseUrl: !SUPABASE_URL,
        siteUrl: !SITE_URL,
      },
    });
  }

  const { email, name, ageBand, householdId, role, memberSeed } = req.body || {};
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Valid email required" });
  if (!householdId) return res.status(400).json({ error: "householdId required" });
  const safeAgeBand = ageBand === "child" ? "adult" : (ageBand || "adult");
  const safeRole = role === "owner" ? "owner" : "member";
  const normalizedEmail = String(email).trim().toLowerCase();

  if (user.email && user.email.toLowerCase() === normalizedEmail) {
    return res.status(400).json({ error: "You can't invite your own email" });
  }

  const authedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.authorization } },
  });
  const { data: isOwner, error: ownerErr } = await authedClient.rpc("is_household_owner", { hh_id: householdId });
  if (ownerErr || !isOwner) {
    return res.status(403).json({
      error: ownerErr?.message || "Only the household owner can invite members",
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const redirectTo = `${SITE_URL}/app/invite`;

  const { error: insErr } = await admin.from("household_invites").insert({
    household_id: householdId,
    email: normalizedEmail,
    role: safeRole,
    invited_by: user.id,
    member_seed: { ...(memberSeed || {}), name: name || "", ageBand: safeAgeBand },
  });
  if (insErr) {
    if (insErr.code === "23505") return res.status(409).json({ error: "An invite is already pending for this email" });
    return res.status(500).json({ error: insErr.message || "Failed to create invite" });
  }

  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(normalizedEmail, {
    redirectTo,
    data: { name: name || "" },
  });

  if (!inviteErr) {
    return res.status(200).json({ ok: true, existingUser: false, emailed: true });
  }

  console.error("[invite] inviteUserByEmail failed", {
    email: normalizedEmail,
    message: inviteErr.message,
    code: inviteErr.code,
    status: inviteErr.status,
    redirectTo,
  });

  // ── SMTP / mailer broken: create via generateLink and hand the URL back ──
  if (isEmailDeliveryError(inviteErr) && !isExistingUserError(inviteErr)) {
    const { link, error: linkErr } = await createInviteLink(admin, normalizedEmail, name, redirectTo);
    if (link) {
      return res.status(200).json({
        ok: true,
        existingUser: false,
        emailed: false,
        inviteLink: link,
        message: "Email delivery isn't working on this project (SMTP auth failed). Copy the invite link below and send it to them yourself. Fix SMTP under Supabase → Authentication → Emails.",
      });
    }
    await rollbackInvite(admin, householdId, normalizedEmail);
    return res.status(400).json({
      error: `Could not send invite email (SMTP is misconfigured: 535 authentication failed). ${authErrText(linkErr, "Also failed to create a shareable link.")} Fix custom SMTP in Supabase → Authentication → Emails, or contact ${CONTACT_EMAIL}.`,
    });
  }

  if (!isExistingUserError(inviteErr)) {
    await rollbackInvite(admin, householdId, normalizedEmail);
    return res.status(400).json({
      error: authErrText(inviteErr, "Could not send invite"),
      status: inviteErr.status || null,
      code: inviteErr.code || null,
    });
  }

  // ── Existing Lingua account ──────────────────────────────────────────
  const { user: existing, error: findErr, actionLink } = await findAuthUserByEmail(admin, normalizedEmail);
  if (findErr || !existing) {
    await rollbackInvite(admin, householdId, normalizedEmail);
    return res.status(400).json({
      error: authErrText(
        findErr,
        "This email already has an account, but we couldn't look it up. Ask them to sign in, or try again.",
      ),
    });
  }

  let gate;
  try {
    gate = await assertCanLeaveCurrentHouseholds(admin, existing.id, householdId);
  } catch (e) {
    await rollbackInvite(admin, householdId, normalizedEmail);
    return res.status(500).json({ error: e.message || "Could not check household membership" });
  }

  if (gate.alreadyMember) {
    await rollbackInvite(admin, householdId, normalizedEmail);
    return res.status(409).json({ error: "This person is already in your household" });
  }
  if (gate.blocked) {
    await rollbackInvite(admin, householdId, normalizedEmail);
    return res.status(409).json({ error: gate.error });
  }

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: otpErr } = await anon.auth.signInWithOtp({
    email: normalizedEmail,
    options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
  });

  if (otpErr) {
    console.error("[invite] signInWithOtp failed", { email: normalizedEmail, message: otpErr.message });
    // SMTP likely broken for existing users too — share magic link if we have one
    const share = actionLink || (await createInviteLink(admin, normalizedEmail, name, redirectTo)).link;
    return res.status(200).json({
      ok: true,
      existingUser: true,
      emailed: false,
      inviteLink: share || undefined,
      message: share
        ? "They already have a Lingua account. Email delivery isn't working — copy the link below and send it to them."
        : `They already have a Lingua account. Invite is ready, but email failed (${authErrText(otpErr)}). Ask them to sign in at ${SITE_URL}/app.`,
    });
  }

  return res.status(200).json({
    ok: true,
    existingUser: true,
    emailed: true,
    message: "They already have a Lingua account — we emailed them a link to join your household.",
  });
}
