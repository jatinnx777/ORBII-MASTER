-- ORBII hardening. Paste into Supabase SQL Editor. Idempotent.
--
--   #7  Contact hashes are peppered SERVER-SIDE again.
--   #8  Telemetry tables get a rate limit, a size cap, and no anon writes.

-- ---------------------------------------------------------------------------
-- #7. Contact hashing: pepper lives in the database, not the APK
-- ---------------------------------------------------------------------------
-- The app used to hash the address book on-device with a salt compiled into the
-- binary. Anyone can extract that salt, and Indian mobiles are only ~4e9
-- candidates, so a leak of victim_contact_hashes was brute-forceable on one GPU.
--
-- Numbers now arrive over TLS and are hashed here with the pepper from
-- reward_secrets (RLS on, NO read policy: unreadable by any client). Raw digits
-- are never written to a table. Reversing the hashes now needs a full DB dump.

-- Re-sync should REPLACE the set, exactly as the prehashed variant does.
create or replace function store_contact_hashes(phones text[])
returns int
language plpgsql security definer set search_path = public
as $$
declare uid uuid := auth.uid(); ph text; h text; c int := 0;
begin
  if uid is null then return 0; end if;
  delete from victim_contact_hashes where user_id = uid;
  foreach ph in array phones loop
    h := hash_phone(ph);   -- peppered, server-only
    if h is not null then
      insert into victim_contact_hashes (user_id, phone_hash)
        values (uid, h) on conflict do nothing;
      c := c + 1;
    end if;
  end loop;
  return c;
end;
$$;

-- The eligibility check must compare with the SAME scheme the app now uploads.
-- (sql/33 compared against the unpeppered hash_phone_plain.)
create or replace function is_reward_eligible(p_event uuid)
returns table(eligible boolean, reason text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_victim uuid; v_helper uuid; v_hphone text; v_hash text; v_verified boolean;
begin
  select victim_id, helper_id into v_victim, v_helper
    from rescue_events where id = p_event;
  if v_victim is null then return query select false, 'no_event'; return; end if;

  if v_victim = v_helper then
    return query select false, 'self'; return;
  end if;

  select (verification_status = 'verified') into v_verified
    from helper_profiles where user_id = v_helper;
  if coalesce(v_verified, false) = false then
    return query select false, 'not_verified'; return;
  end if;

  select phone into v_hphone from profiles where id = v_helper;
  v_hash := hash_phone(v_hphone);   -- peppered

  -- (a) helper is an emergency contact of the victim
  if v_hash is not null and exists (
    select 1 from emergency_contacts ec
    where ec.user_id = v_victim and hash_phone(ec.phone) = v_hash
  ) then
    return query select false, 'emergency_contact'; return;
  end if;

  -- (b) helper's number is anywhere in the victim's uploaded contacts
  if v_hash is not null and exists (
    select 1 from victim_contact_hashes vch
    where vch.user_id = v_victim and vch.phone_hash = v_hash
  ) then
    return query select false, 'mutual_contact'; return;
  end if;

  -- (c) helper shares a circle with the victim (trusted circle / family)
  if exists (
    select 1 from circle_members a
    join circle_members b on a.circle_id = b.circle_id
    where a.user_id = v_victim and b.user_id = v_helper
  ) then
    return query select false, 'trusted_circle'; return;
  end if;

  return query select true, 'eligible';
end;
$$;

-- Any hashes uploaded under the old unpeppered scheme can never match the new
-- one. Drop them so a stale hash never silently un-blocks a mutual contact.
truncate table victim_contact_hashes;

-- ---------------------------------------------------------------------------
-- #8. Telemetry: no anon writes, size caps, per-user rate limit
-- ---------------------------------------------------------------------------
-- Both tables accepted inserts from `anon` with `with check (true)`. The anon
-- key ships in the APK, so anyone could flood or poison them — and poisoned
-- analytics is worse than none, because you trust it.

-- app_events ---------------------------------------------------------------
revoke insert on app_events from anon;
drop policy if exists "app_events insert" on app_events;
create policy "app_events insert"
  on app_events for insert
  to authenticated
  -- You may only write events attributed to yourself.
  with check (auth.uid() = user_id);

create or replace function app_events_guard()
returns trigger language plpgsql as $$
declare recent int;
begin
  if pg_column_size(new.params) > 2048 then
    raise exception 'app_events.params too large';
  end if;
  select count(*) into recent from app_events
    where user_id = new.user_id and created_at > now() - interval '1 minute';
  if recent >= 60 then
    raise exception 'app_events rate limit exceeded';
  end if;
  return new;
end $$;

drop trigger if exists app_events_guard_trg on app_events;
create trigger app_events_guard_trg
  before insert on app_events
  for each row execute function app_events_guard();

-- client_errors -------------------------------------------------------------
-- Kept open to `anon`: a crash during sign-in has no session, and losing those
-- reports is worse than the spam risk. Rate limited per user instead, and
-- anonymous rows are capped globally.
create or replace function client_errors_guard()
returns trigger language plpgsql as $$
declare recent int;
begin
  -- Cap the free-form blobs, not the whole row (pg_column_size(new.*) is not
  -- valid plpgsql).
  if pg_column_size(coalesce(new.data, '{}'::jsonb))
   + pg_column_size(coalesce(new.breadcrumbs, '{}'::jsonb))
   + coalesce(length(new.stack), 0) > 8192 then
    raise exception 'client_errors payload too large';
  end if;
  if new.user_id is not null then
    select count(*) into recent from client_errors
      where user_id = new.user_id and created_at > now() - interval '1 minute';
    if recent >= 30 then raise exception 'client_errors rate limit exceeded'; end if;
  else
    select count(*) into recent from client_errors
      where user_id is null and created_at > now() - interval '1 minute';
    if recent >= 120 then raise exception 'client_errors anon rate limit exceeded'; end if;
  end if;
  return new;
end $$;

drop trigger if exists client_errors_guard_trg on client_errors;
create trigger client_errors_guard_trg
  before insert on client_errors
  for each row execute function client_errors_guard();
