// Called by an invitee on /app/invite after the magic-link / invite session
// lands. For brand-new invitees the 0003 trigger already joined them; this
// just returns their member_seed. For existing accounts with a pending invite
// it moves membership into the inviting household and marks the invite accepted.
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseUser } from "./_auth.js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await requireSupabaseUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });
  if (!SERVICE_ROLE_KEY || !SUPABASE_URL) {
    return res.status(503).json({ error: "Invites are not configured on this server" });
  }

  const email = String(user.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "Your account has no email" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: pending, error: pendErr } = await admin
    .from("household_invites")
    .select("id, household_id, role, member_seed, status")
    .eq("status", "pending")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pendErr) return res.status(500).json({ error: pendErr.message });

  if (pending) {
    const { data: already } = await admin
      .from("household_members")
      .select("user_id")
      .eq("household_id", pending.household_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!already) {
      const { data: memberships, error: memErr } = await admin
        .from("household_members")
        .select("household_id, role")
        .eq("user_id", user.id);
      if (memErr) return res.status(500).json({ error: memErr.message });

      for (const m of memberships || []) {
        if (m.household_id === pending.household_id || m.role !== "owner") continue;
        const { count, error: countErr } = await admin
          .from("household_members")
          .select("*", { count: "exact", head: true })
          .eq("household_id", m.household_id);
        if (countErr) return res.status(500).json({ error: countErr.message });
        if ((count || 0) > 1) {
          return res.status(409).json({
            error: "You already own a household with other members. Leave that household before joining this one.",
          });
        }
      }

      const { error: delErr } = await admin.from("household_members").delete().eq("user_id", user.id);
      if (delErr) return res.status(500).json({ error: delErr.message });

      const { error: joinErr } = await admin.from("household_members").insert({
        household_id: pending.household_id,
        user_id: user.id,
        role: pending.role === "owner" ? "owner" : "member",
      });
      if (joinErr) return res.status(500).json({ error: joinErr.message });
    }

    const { error: updErr } = await admin
      .from("household_invites")
      .update({ status: "accepted", accepted_at: new Date().toISOString() })
      .eq("id", pending.id);
    if (updErr) return res.status(500).json({ error: updErr.message });

    return res.status(200).json({
      ok: true,
      joined: true,
      householdId: pending.household_id,
      memberSeed: pending.member_seed || null,
    });
  }

  // No pending invite — new-user path where the signup trigger already joined
  // them. Return seed from an accepted invite for a household they belong to
  // (never re-join from stale accepted rows).
  const { data: memberships, error: memListErr } = await admin
    .from("household_members")
    .select("household_id")
    .eq("user_id", user.id);
  if (memListErr) return res.status(500).json({ error: memListErr.message });
  const hhIds = (memberships || []).map((m) => m.household_id);
  if (!hhIds.length) {
    return res.status(404).json({ error: "No invite found for this email" });
  }

  const { data: accepted, error: accErr } = await admin
    .from("household_invites")
    .select("id, household_id, role, member_seed, status")
    .eq("status", "accepted")
    .eq("email", email)
    .in("household_id", hhIds)
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (accErr) return res.status(500).json({ error: accErr.message });
  if (!accepted) {
    return res.status(404).json({ error: "No invite found for this email" });
  }

  return res.status(200).json({
    ok: true,
    joined: false,
    householdId: accepted.household_id,
    memberSeed: accepted.member_seed || null,
  });
}
