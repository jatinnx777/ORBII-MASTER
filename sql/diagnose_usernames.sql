-- diagnose_usernames.sql
-- Read-only. Answers "is everyone getting the same username?"

-- 1. Any username held by more than one account?
--    users_public.username is UNIQUE, so this should be empty. If it is not,
--    the unique index is missing on this project.
select username, count(*) as accounts
from public.users_public
group by username
having count(*) > 1
order by accounts desc;

-- 2. What do the last 20 signups actually look like?
--    Compare email against the handle the trigger derived from it.
select u.email,
       p.username as profiles_username,
       up.username as public_username,
       p.name,
       u.created_at
from auth.users u
left join public.profiles p      on p.id = u.id
left join public.users_public up on up.id = u.id
order by u.created_at desc
limit 20;

-- 3. Is anyone actually called justinn, and who?
select id, username, name from public.users_public where username ilike '%justin%';

-- 4. Rows that never got a profile at all (these show up as blanks or
--    fall back to the client-side generator on next sign-in).
select count(*) as auth_users        from auth.users
union all
select count(*) as profiles          from public.profiles
union all
select count(*) as users_public      from public.users_public;
