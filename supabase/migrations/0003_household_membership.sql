-- Decouples household access from strict account_id ownership so an invited
-- family member (their own auth.users row) can share one household instead
-- of every "member" being a JSON sub-profile the owner alone controls.
-- account_id keeps its existing meaning: the household's original owner.

-- 1. Surrogate id, independent of account_id but backfilled to it for
--    existing rows so pre-migration households keep a stable, recognizable
--    id with zero client-visible change.
alter table public.households
  add column if not exists id uuid not null default gen_random_uuid();
update public.households set id = account_id where id is distinct from account_id;
alter table public.households add constraint households_id_key unique (id);

-- 2. Membership join table.
create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
alter table public.household_members enable row level security;

-- Backfill: every existing household's account_id becomes its owner member.
insert into public.household_members (household_id, user_id, role)
select id, account_id, 'owner' from public.households
on conflict (household_id, user_id) do nothing;

-- 3. Pending invites.
create table if not exists public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  invited_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  member_seed jsonb,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
alter table public.household_invites enable row level security;
create unique index if not exists household_invites_pending_email_uk
  on public.household_invites (household_id, lower(email))
  where status = 'pending';

-- 4. Membership-check helpers, security definer so they're safe to call
--    from inside RLS policies without recursive-RLS issues.
create or replace function public.is_household_member(hh_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.household_members
    where household_id = hh_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_household_owner(hh_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.household_members
    where household_id = hh_id and user_id = auth.uid() and role = 'owner'
  );
$$;

-- 5. Rewrite households RLS: membership-based instead of account_id equality.
drop policy if exists "households_select_own" on public.households;
drop policy if exists "households_insert_own" on public.households;
drop policy if exists "households_update_own" on public.households;
drop policy if exists "households_delete_own" on public.households;

create policy "households_select_member" on public.households
  for select using (public.is_household_member(id));
create policy "households_insert_owner" on public.households
  for insert with check (auth.uid() = account_id);
create policy "households_update_member" on public.households
  for update using (public.is_household_member(id));
create policy "households_delete_owner" on public.households
  for delete using (public.is_household_owner(id));

-- 6. household_members RLS: members can see their own household's roster;
--    only the owner manages membership (add/remove/role changes).
create policy "household_members_select" on public.household_members
  for select using (public.is_household_member(household_id));
create policy "household_members_insert_self_or_owner" on public.household_members
  for insert with check (
    user_id = auth.uid() or public.is_household_owner(household_id)
  );
create policy "household_members_update_owner" on public.household_members
  for update using (public.is_household_owner(household_id));
create policy "household_members_delete_owner" on public.household_members
  for delete using (public.is_household_owner(household_id));

-- 7. household_invites RLS: the household owner manages invites; an
--    invitee may additionally read their own ACCEPTED invite (by matching
--    email) so the client can pull member_seed for their own SetupMember
--    prefill on first login. Scoped to status='accepted' so a matching
--    email can't read someone else's still-pending or revoked invite (e.g.
--    an invite to a different household sent to the same address before
--    this user ever signed up). api/invite.js uses the service-role key
--    and bypasses RLS regardless for sending.
create policy "household_invites_select_owner" on public.household_invites
  for select using (
    public.is_household_owner(household_id)
    or (status = 'accepted' and lower(email) = lower((select email from auth.users where id = auth.uid())))
  );
create policy "household_invites_insert_owner" on public.household_invites
  for insert with check (public.is_household_owner(household_id));
create policy "household_invites_update_owner" on public.household_invites
  for update using (public.is_household_owner(household_id));

-- 8. handle_new_user: on new auth.users insert, join them to a pending
--    invite's household if one matches their email; otherwise unchanged
--    behavior (create a fresh owned household). Deliberately does NOT
--    synthesize a member JSON object here — that shape is owned by
--    newMember() in App.jsx and is appended client-side on first login
--    (via supaJoinHousehold) to avoid schema/shape drift.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
begin
  select * into inv
  from public.household_invites
  where lower(email) = lower(new.email) and status = 'pending'
  order by created_at desc
  limit 1;

  if inv.id is not null then
    insert into public.household_members (household_id, user_id, role)
    values (inv.household_id, new.id, inv.role)
    on conflict (household_id, user_id) do nothing;

    update public.household_invites
      set status = 'accepted', accepted_at = now()
      where id = inv.id;

    return new;
  end if;

  insert into public.households (account_id, id, version, data)
  values (
    new.id,
    new.id,
    1,
    jsonb_build_object(
      'account', jsonb_build_object(
        'name', coalesce(new.raw_user_meta_data->>'name', ''),
        'email', coalesce(new.email, '')
      ),
      'type', coalesce(new.raw_user_meta_data->>'type', 'family'),
      'members', '[]'::jsonb
    )
  )
  on conflict (account_id) do nothing;

  insert into public.household_members (household_id, user_id, role)
  values (new.id, new.id, 'owner')
  on conflict (household_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
