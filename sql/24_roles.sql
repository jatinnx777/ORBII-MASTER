-- 24_roles.sql
-- ============================================================================
-- Role-based access for ORBII. ONE app, ONE account — a `role` on the profile
-- decides which UI the user sees (user | responder | admin). A normal user
-- never sees responder UI; an approved responder unlocks the Missions tab.
--
-- Source of truth: profiles.role. A user CANNOT escalate their own role — that
-- only happens via admin approval (service role / dashboard). Applying to be a
-- responder just creates a pending helper_profiles row (sql/23).
-- ============================================================================

alter table profiles
  add column if not exists role text not null default 'user'
    check (role in ('user','responder','admin'));

-- Block clients from changing their OWN role. Admin approval runs as the
-- service role (edge function) or in the dashboard (superuser), both of which
-- are allowed; a normal authenticated client's attempt is silently ignored.
create or replace function prevent_role_self_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  jwt_role text := current_setting('request.jwt.claims', true)::jsonb ->> 'role';
begin
  if NEW.role is distinct from OLD.role and jwt_role = 'authenticated' then
    NEW.role := OLD.role;
  end if;
  return NEW;
end $$;

drop trigger if exists profiles_protect_role on profiles;
create trigger profiles_protect_role
  before update on profiles
  for each row execute function prevent_role_self_change();

-- Apply to become a responder: creates/updates the pending application
-- (helper_profiles). Role stays 'user' until an admin approves.
create or replace function apply_as_responder()
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into helper_profiles (user_id, verification_status)
  values (auth.uid(), 'pending')
  on conflict (user_id) do update set updated_at = now();
end $$;

revoke all on function apply_as_responder() from public, anon;
grant execute on function apply_as_responder() to authenticated;

-- Admin approval (run from the dashboard or an admin tool):
--   update profiles set role = 'responder' where id = '<user-uuid>';
--   update helper_profiles set verification_status = 'verified' where user_id = '<user-uuid>';
