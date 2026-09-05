-- 124_member_relation.sql
-- ============================================================================
-- Who someone is to the circle, as opposed to what they are allowed to do.
--
-- circle_members.role already exists and means owner / admin / member. That is
-- a permission, and it is the wrong thing to show a person. A roster reading
-- "Priya, member" tells you nothing you did not already know from her being on
-- the list. "Priya, Mum" tells you how to read everything else on the card.
--
-- WHY THIS EARNS A COLUMN. A circle map is four coloured dots and four names,
-- and the names are often nicknames or first names that collide. Relationship
-- is the cheapest possible way to make the roster legible at a glance, and it
-- is the thing families actually use to talk about each other. Life360 asks for
-- it during onboarding for exactly this reason.
--
-- WHY IT IS FREE TEXT WITH A CHECK RATHER THAN AN ENUM. A Postgres enum needs
-- a migration to add a value, and this list will change: 'bhai' and 'didi' are
-- more natural in India than 'Sibling' and are worth adding once somebody asks.
-- A check constraint moves with one alter.
--
-- OPTIONAL AND NULLABLE. Nobody is made to declare a relationship to join a
-- circle. A woman adding a colleague to a walking-home circle has no answer to
-- "what are they to you", and forcing one would be the app being nosy for the
-- sake of a nicer card.
--
-- Idempotent. Run after sql/123.
-- ============================================================================

alter table circle_members
  add column if not exists relation text
    check (relation is null or relation in (
      'mother', 'father', 'daughter', 'son',
      'sister', 'brother', 'partner', 'grandparent',
      'friend', 'roommate', 'colleague', 'other'
    ));


-- ---------------------------------------------------------------------------
-- SETTING IT
-- ---------------------------------------------------------------------------
-- YOU DESCRIBE YOURSELF, and only yourself. The alternative is letting the
-- circle owner label everyone else, which sounds convenient and is how you end
-- up with a woman finding herself listed as somebody's "daughter" in a circle
-- she joined as a flatmate. The label is hers to set and hers to change.
create or replace function public.set_my_circle_relation(p_circle uuid, p_relation text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'auth required'; end if;

  update circle_members
     set relation = nullif(btrim(p_relation), '')
   where circle_id = p_circle
     and user_id = auth.uid()
     and deleted_at is null;

  return found;
end $$;

revoke all on function public.set_my_circle_relation(uuid, text) from public, anon;
grant execute on function public.set_my_circle_relation(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'members can carry a relationship' as check,
       (exists (select 1 from information_schema.columns
                where table_name = 'circle_members' and column_name = 'relation'))::text as result
union all
select 'it is optional (must be YES)',
       (select is_nullable from information_schema.columns
        where table_name = 'circle_members' and column_name = 'relation')
union all
select 'the permission role is untouched (must be true)',
       (exists (select 1 from information_schema.columns
                where table_name = 'circle_members' and column_name = 'role'))::text
union all
select 'a member can describe themselves (must be true)',
       public.orbii_can_exec('authenticated', 'public.set_my_circle_relation(uuid,text)')
union all
select 'anon cannot (must be false)',
       has_function_privilege('anon', 'public.set_my_circle_relation(uuid,text)', 'execute')::text;
