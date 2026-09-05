-- 125_circle_join_codes.sql
-- ============================================================================
-- One six-letter code per circle. You read it out, somebody types it, they are
-- in. The directory search goes away entirely.
--
-- WHY THE SEARCH GOES. Adding somebody to a circle by looking them up in a
-- directory means the directory has to be searchable, and a searchable
-- directory of women who installed a personal safety app is the single worst
-- thing this product could own. Every protection you put on it (rate limits,
-- exact match only, no phone number returned) is a mitigation of a hole that
-- did not have to exist.
--
-- A code inverts it. Nothing is looked up, nothing is enumerable, and the
-- person joining has to have been told the code by somebody who has it. The
-- circle owner decides who knows it, which is the decision they were making
-- anyway, just without a searchable index underneath.
--
-- ALPHABET. Letters only, and not all of them: I, O, Q and S are gone, because
-- this code gets read aloud across a room and written on paper, and I/1, O/0
-- and S/5 are where that goes wrong. 22 letters over 6 positions is 113
-- million combinations, so guessing one is not a route in even before the rate
-- limit below.
--
-- NOT A SECRET, AND SHORT-LIVED BY ROTATION RATHER THAN BY CLOCK. A code that
-- expires in 48 hours is a support burden for a feature used twice a year. The
-- owner can roll it instead, which is the same protection on demand and does
-- not strand anybody at midnight.
--
-- Idempotent. Run after sql/124.
-- ============================================================================

create or replace function public.orbii_join_alphabet()
returns text language sql immutable as $$
  -- No I, O, Q or S. Read a code down a phone line and you will see why.
  select 'ABCDEFGHJKLMNPRTUVWXYZ'
$$;

revoke all on function public.orbii_join_alphabet() from public, anon;
grant execute on function public.orbii_join_alphabet() to authenticated, service_role;


create or replace function public.orbii_new_join_code()
returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  alpha text := public.orbii_join_alphabet();
  n int := length(alpha);
  code text;
  tries int := 0;
begin
  loop
    code := '';
    for i in 1..6 loop
      -- gen_random_bytes, not random(). random() is seeded per session and is
      -- not a cryptographic source; two devices creating a circle in the same
      -- second should not be able to collide predictably.
      code := code || substr(alpha, 1 + (get_byte(gen_random_bytes(1), 0) % n), 1);
    end loop;
    exit when not exists (select 1 from circles where join_code = code);
    tries := tries + 1;
    -- 113 million codes: reaching this means something is very wrong, and
    -- looping forever inside a transaction is worse than failing loudly.
    if tries > 20 then
      raise exception 'could not allocate a join code';
    end if;
  end loop;
  return code;
end $$;

revoke all on function public.orbii_new_join_code() from public, anon;
grant execute on function public.orbii_new_join_code() to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- THE COLUMN
-- ---------------------------------------------------------------------------
alter table circles add column if not exists join_code text;

-- Backfill before the unique index, or the index build fails on the duplicate
-- nulls-as-empty case and every existing circle is left uninvitable.
do $$
declare r record;
begin
  for r in select id from circles where join_code is null loop
    update circles set join_code = public.orbii_new_join_code() where id = r.id;
  end loop;
end $$;

create unique index if not exists circles_join_code_idx on circles (join_code);

-- New circles get one automatically. Doing this in a trigger rather than in
-- the app means a circle cannot exist without a code, however it was created.
create or replace function public.orbii_set_join_code()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.join_code is null then
    new.join_code := public.orbii_new_join_code();
  end if;
  return new;
end $$;

drop trigger if exists circles_join_code on circles;
create trigger circles_join_code before insert on circles
  for each row execute function public.orbii_set_join_code();

revoke all on function public.orbii_set_join_code() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- JOINING
-- ---------------------------------------------------------------------------
-- Returns the circle id on success and null on a bad code. Null rather than an
-- exception, so the app can say "that code did not match" without a crash
-- path, and so a wrong code and a full circle are told apart by the caller.
create or replace function public.join_circle_by_code(p_code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  target uuid;
  n int;
begin
  if auth.uid() is null then raise exception 'auth required'; end if;

  -- Six wrong codes an hour. The keyspace already makes guessing hopeless;
  -- this stops somebody scripting it and stops a stuck retry loop hammering
  -- the table.
  if not public.rate_ok('circle.join', 6, 3600) then
    raise exception 'too many attempts, try again later';
  end if;

  select id into target
  from circles
  -- Upper and trimmed, because people type codes with a space in the middle
  -- and in whatever case their keyboard was in.
  where join_code = upper(btrim(p_code));
  if target is null then return null; end if;

  -- Already in it. Returning the id rather than erroring means tapping join
  -- twice takes you to the circle instead of showing a failure.
  if exists (
    select 1 from circle_members
    where circle_id = target and user_id = auth.uid() and deleted_at is null
  ) then
    return target;
  end if;

  -- A revocation is a decision somebody made about this person. A join code is
  -- not a way around it.
  if exists (
    select 1 from circle_revocations
    where circle_id = target and user_id = auth.uid()
  ) then
    raise exception 'you cannot rejoin that circle';
  end if;

  select count(*) into n
  from circle_members where circle_id = target and deleted_at is null;
  if n >= 4 then
    raise exception 'that circle is full';
  end if;

  insert into circle_members (circle_id, user_id, role)
  values (target, auth.uid(), 'member')
  on conflict (circle_id, user_id) do update set deleted_at = null;

  return target;
end $$;

revoke all on function public.join_circle_by_code(text) from public, anon;
grant execute on function public.join_circle_by_code(text) to authenticated;


-- Roll the code. Owner and admins only: anybody who can remove a member should
-- be able to stop the code that let them in.
create or replace function public.rotate_circle_code(p_circle uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  fresh text;
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  if not exists (
    select 1 from circle_members
    where circle_id = p_circle and user_id = auth.uid()
      and role in ('owner', 'admin') and deleted_at is null
  ) then
    raise exception 'only the circle owner can change the code';
  end if;
  fresh := public.orbii_new_join_code();
  update circles set join_code = fresh where id = p_circle;
  return fresh;
end $$;

revoke all on function public.rotate_circle_code(uuid) from public, anon;
grant execute on function public.rotate_circle_code(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- THE DIRECTORY CLOSES
-- ---------------------------------------------------------------------------
-- Nothing in the app calls these after this change. Left in place rather than
-- dropped, because dropping a function an older installed build still calls
-- turns a removed feature into a crash; revoked, it fails as a permission
-- error the app already handles as "no results".
--
-- A searchable index of women who installed a personal safety app is the worst
-- thing this product could own, and every guard on it was a mitigation of a
-- hole that did not need to exist.
revoke all on function public.find_user_by_phone(text, uuid) from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.store_contact_hashes(text[])') is not null then
    revoke all on function public.store_contact_hashes(text[]) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.store_contact_hashes_prehashed(text[])') is not null then
    revoke all on function public.store_contact_hashes_prehashed(text[]) from public, anon, authenticated;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'every circle has a code' as check,
       (select count(*) = 0 from circles where join_code is null)::text as result
union all
select 'codes are six characters',
       (select coalesce(bool_and(length(join_code) = 6), true)::text from circles)
union all
select 'codes avoid I, O, Q and S',
       (select coalesce(bool_and(join_code !~ '[IOQS]'), true)::text from circles)
union all
select 'codes are unique',
       (select (count(*) = count(distinct join_code))::text from circles)
union all
select 'a new circle gets one automatically',
       (exists (select 1 from pg_trigger where tgname = 'circles_join_code'))::text
union all
select 'the app can join by code (must be true)',
       public.orbii_can_exec('authenticated', 'public.join_circle_by_code(text)')
union all
select 'a wrong code returns nothing rather than erroring (must be blank)',
       coalesce(public.join_circle_by_code('ZZZZZZ')::text, '')
union all
select 'phone lookup is closed to the app (must be false)',
       has_function_privilege('authenticated', 'public.find_user_by_phone(text,uuid)', 'execute')::text
union all
select 'anon cannot join anything (must be false)',
       has_function_privilege('anon', 'public.join_circle_by_code(text)', 'execute')::text;
