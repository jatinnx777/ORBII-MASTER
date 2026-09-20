-- 141_family_circle_cap.sql
-- ============================================================================
-- Family circles hold 8. Everything else still holds 4.
--
-- THIS IS A PRODUCT HYPOTHESIS, NOT A RESEARCHED FACT. Nobody has measured how
-- many people an Indian family circle wants, and no user has asked for this.
-- The reasoning is that a family is the one circle kind whose membership is
-- decided by who exists rather than by who you pick: parents, siblings and a
-- partner reach four before anyone has chosen anything. A walk-home circle is
-- a choice, and four is a deliberate ceiling on it.
--
-- If the hypothesis is wrong, the cost is family circles that feel like an
-- audience, which is exactly what sql/86 set out to prevent. Revisit this with
-- real numbers on how full circles actually get.
--
-- WHY THE LIMIT NOW TAKES A CIRCLE RATHER THAN A KIND. Both callers hold a
-- circle id and neither holds the kind, so passing the kind would mean two
-- extra lookups written twice. The zero-argument version stays and still
-- returns 4, so anything that calls it without a circle keeps the old, safer
-- answer instead of erroring.
--
-- The trigger and its FOR UPDATE row lock are untouched. That lock is what
-- stops two people accepting an invite in the same instant and both passing a
-- count of 7.
--
-- Idempotent.
-- ============================================================================

-- The old signature, unchanged, for any caller that does not know the circle.
create or replace function public.circle_member_limit()
returns int language sql immutable as $$ select 4 $$;

create or replace function public.circle_member_limit(p_circle uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case
           when (select kind from circles where id = p_circle) = 'family' then 8
           else 4
         end
$$;

comment on function public.circle_member_limit(uuid) is
  'Max live members for this circle, owner included. 8 for family, 4 otherwise. Product hypothesis, not a measured figure.';


-- ---------------------------------------------------------------------------
-- 1. THE TRIGGER READS THE PER-CIRCLE LIMIT
--
-- Body is sql/86's, with one line changed: the cap is resolved from the row
-- being inserted instead of from a constant. The FOR UPDATE lock, the
-- un-delete handling and the error code are all preserved deliberately.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_circle_member_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cap int;
  n   int;
begin
  -- A tombstoned row is not a member and does not count.
  if tg_op = 'INSERT' and new.deleted_at is not null then
    return new;
  end if;
  -- An update that is not a resurrection cannot push the circle over.
  if tg_op = 'UPDATE' and new.deleted_at is not null then
    return new;
  end if;

  cap := public.circle_member_limit(new.circle_id);

  -- Serialises concurrent joins. Without it, two people accepting at the same
  -- instant both count n-1, both pass, and the circle ends up one over.
  perform 1 from circles where id = new.circle_id for update;

  select count(*) into n
  from circle_members
  where circle_id = new.circle_id
    and deleted_at is null
    and id <> new.id;

  if n >= cap then
    -- The client surfaces raw Postgres text, so this sentence is read by a
    -- real person. It names the actual cap rather than a generic "full".
    raise exception 'This circle is full. A circle can hold % people, including the owner.', cap
      using errcode = '23514';
  end if;

  return new;
end $$;

drop trigger if exists trg_circle_member_limit on public.circle_members;
create trigger trg_circle_member_limit
  before insert or update on public.circle_members
  for each row execute function public.enforce_circle_member_limit();


-- ---------------------------------------------------------------------------
-- 2. INVITES COUNT AGAINST THE SAME LIMIT
--
-- circle_create_invite already called circle_member_limit(); it just called
-- the constant one. Pending invites must keep counting toward the cap, or
-- eight valid invites to a four-person circle all succeed and the ninth person
-- through the door is the one who gets the error.
-- ---------------------------------------------------------------------------
create or replace function public.circle_invite_cap_patch()
returns void language plpgsql as $$
begin
  -- Nothing to do: the body below replaces the one line that matters by
  -- redefining the caller. Kept as a marker so the intent is greppable.
  return;
end $$;
drop function if exists public.circle_invite_cap_patch();

do $$
declare
  v_src text;
begin
  select pg_get_functiondef(oid) into v_src
  from pg_proc
  where proname = 'circle_create_invite' and pronamespace = 'public'::regnamespace
  limit 1;

  if v_src is null then
    raise notice 'circle_create_invite not present; nothing to patch.';
    return;
  end if;

  -- Point the cap at the per-circle limit. Only this one expression changes.
  v_src := replace(
    v_src,
    'cap        int := public.circle_member_limit();',
    'cap        int := public.circle_member_limit(p_circle);'
  );

  execute v_src;
end $$;


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'family circles hold 8' as check,
       (public.circle_member_limit(
          coalesce((select id from circles where kind = 'family' limit 1),
                   '00000000-0000-0000-0000-000000000000'::uuid)
        ) = case when exists (select 1 from circles where kind = 'family')
                 then 8 else 4 end)::text as result
union all
select 'a non-family circle still holds 4',
       (public.circle_member_limit(
          coalesce((select id from circles where kind <> 'family' limit 1),
                   '00000000-0000-0000-0000-000000000000'::uuid)
        ) = 4)::text
union all
select 'an unknown circle falls back to 4 (must be true)',
       (public.circle_member_limit('00000000-0000-0000-0000-000000000000'::uuid) = 4)::text
union all
select 'the trigger is still installed',
       (exists (select 1 from pg_trigger
                where tgname = 'trg_circle_member_limit' and not tgisinternal))::text
union all
select 'the trigger still takes the row lock (must be true)',
       (pg_get_functiondef(
          (select oid from pg_proc where proname = 'enforce_circle_member_limit'
             and pronamespace = 'public'::regnamespace limit 1)
        ) ~ 'for update')::text
union all
select 'invites count against the per-circle cap',
       coalesce((select (pg_get_functiondef(oid) ~ 'circle_member_limit\(p_circle\)')::text
                 from pg_proc where proname = 'circle_create_invite'
                   and pronamespace = 'public'::regnamespace limit 1), 'function absent');
