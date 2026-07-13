// Vercel serverless function: sends a household invite email via Supabase
// Auth's admin API. Requires the service-role key (server-only secret, never
// exposed to the browser — same trust boundary as OPENAI_API_KEY/ai.js).
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseUser } from "./_auth.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SITE_URL = process.env.SITE_URL || "";

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

  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(normalizedEmail, {
    redirectTo: `${SITE_URL}/app/invite`,
  });
  if (inviteErr) {
    await admin.from("household_invites").delete().eq("household_id", householdId).eq("email", normalizedEmail).eq("status", "pending");
    return res.status(400).json({ error: inviteErr.message });
  }

  return res.status(200).json({ ok: true });
}
