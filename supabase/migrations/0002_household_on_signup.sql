-- Auto-create a household row when a new auth user is created. Runs as the
-- definer (bypasses RLS) so signup works even when email confirmation delays
-- the client session. Client-side insert in supaSignup still runs when a
-- session exists immediately; this trigger covers the confirm-email path via
-- supaLogin's existing "create if missing" fallback.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.households (account_id, version, data)
  values (
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
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
