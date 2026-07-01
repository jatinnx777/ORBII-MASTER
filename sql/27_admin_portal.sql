-- 27_admin_portal.sql
-- ============================================================================
-- Admin portal backend (for the orbii.in/admin responder-review page).
--
-- SECURITY MODEL — read this before worrying about the portal being public:
--   • The portal is a static page carrying ONLY the public anon key. It has no
--     power by itself. Every privileged action below checks is_admin() on the
--     SERVER (Postgres), so a non-admin — even one who opens the page — can see
--     and do nothing. The god-mode service_role key is NEVER shipped.
--   • "Admin" = a profiles.role of 'admin'. You set that ONCE for yourself in
--     the SQL editor (see the very bottom of this file); it cannot be
--     self-assigned by any normal client (the role-change trigger blocks that).
-- ============================================================================

-- 1. Who is an admin? (bypasses RLS to read the caller's own role)
create or replace function is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;
revoke all on function is_admin() from public, anon;
grant execute on function is_admin() to authenticated;

-- 2. Let admins change roles (approve responders). The existing guard freezes
--    role changes from any authenticated client; we carve out admins so the
--    approve flow below can promote a user to 'responder'. Normal users are
--    still frozen to their own role.
create or replace function prevent_role_self_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  jwt_role text := current_setting('request.jwt.claims', true)::jsonb ->> 'role';
begin
  if NEW.role is distinct from OLD.role
     and jwt_role = 'authenticated'
     and not is_admin() then
    NEW.role := OLD.role;   -- non-admin client: revert any role change
  end if;
  return NEW;
end $$;
-- (trigger profiles_protect_role from sql/24 already points at this function.)

-- 3. Admins may read the private KYC documents (so the portal can show them via
--    short-lived signed URLs). Owners keep their own read policy from sql/25.
drop policy if exists "rdocs admin read" on storage.objects;
create policy "rdocs admin read"
  on storage.objects for select to authenticated
  using ( bucket_id = 'responder-docs' and is_admin() );

-- 4. List every responder application (pending first) with the info the portal
--    needs. Returns nothing to non-admins (the where is_admin() gate).
create or replace function admin_list_responders()
returns table (
  user_id             uuid,
  name                text,
  email               text,
  phone               text,
  category            text,
  verification_status text,
  submitted_at        timestamptz,
  created_at          timestamptz,
  aadhaar_doc         text,
  pan_doc             text,
  selfie_doc          text,
  photo_doc           text
)
language sql stable security definer set search_path = public as $$
  select h.user_id, p.name, p.email, p.phone,
         h.category, h.verification_status, h.submitted_at, h.created_at,
         h.aadhaar_doc, h.pan_doc, h.selfie_doc, h.photo_doc
  from helper_profiles h
  join profiles p on p.id = h.user_id
  where is_admin()
  order by (h.verification_status = 'pending') desc,
           h.submitted_at desc nulls last,
           h.created_at desc;
$$;
revoke all on function admin_list_responders() from public, anon;
grant execute on function admin_list_responders() to authenticated;

-- 5. Approve a responder: promote role + mark verified. Admin-only.
create or replace function admin_approve_responder(target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not authorised';
  end if;
  update profiles set role = 'responder', is_verified = true, updated_at = now()
    where id = target;
  update helper_profiles
    set verification_status = 'verified',
        aadhaar_verified = true,
        pan_verified = true,
        face_verified = true,
        updated_at = now()
    where user_id = target;
end $$;
revoke all on function admin_approve_responder(uuid) from public, anon;
grant execute on function admin_approve_responder(uuid) to authenticated;

-- 6. Reject / suspend a responder application. Admin-only. Keeps role as-is
--    (a rejected applicant stays a normal 'user').
create or replace function admin_reject_responder(target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'not authorised';
  end if;
  update helper_profiles
    set verification_status = 'suspended', updated_at = now()
    where user_id = target;
  update profiles set role = 'user', updated_at = now()
    where id = target and role = 'responder';
end $$;
revoke all on function admin_reject_responder(uuid) from public, anon;
grant execute on function admin_reject_responder(uuid) to authenticated;

-- ============================================================================
-- ONE-TIME: make yourself an admin. Run this once, replacing the email with
-- the Google account you sign in with. (The dashboard/SQL editor runs as the
-- service role, so it is allowed to set role = 'admin'.)
--
--   update profiles set role = 'admin' where email = 'jaykumar2470f@gmail.com';
--
-- Verify:  select id, email, role from profiles where role = 'admin';
-- ============================================================================
