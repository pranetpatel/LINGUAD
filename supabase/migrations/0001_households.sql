-- Lingua on Supabase: one row per authenticated account, versioned for the
-- app's existing optimistic-sync flow (GET/PUT with a version guard).
-- auth.users (Supabase Auth) replaces server/auth.js + server/stores/*.

create table if not exists public.households (
  account_id uuid primary key references auth.users(id) on delete cascade,
  version integer not null default 1,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.households enable row level security;

-- Each user can only ever read/write their own household row.
create policy "households_select_own" on public.households
  for select using (auth.uid() = account_id);
create policy "households_insert_own" on public.households
  for insert with check (auth.uid() = account_id);
create policy "households_update_own" on public.households
  for update using (auth.uid() = account_id);
create policy "households_delete_own" on public.households
  for delete using (auth.uid() = account_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists households_touch_updated_at on public.households;
create trigger households_touch_updated_at
  before update on public.households
  for each row execute function public.touch_updated_at();
