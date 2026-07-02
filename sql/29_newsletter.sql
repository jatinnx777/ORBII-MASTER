-- 29_newsletter.sql
-- ============================================================================
-- Website email subscriptions (the orbii.in newsletter box), surfaced in the
-- admin portal. Anyone (anon) may subscribe; only an admin can read the list.
-- ============================================================================

create table if not exists newsletter_subscribers (
  id         bigint generated always as identity primary key,
  email      text not null unique,
  source     text default 'website',
  created_at timestamptz not null default now()
);

alter table newsletter_subscribers enable row level security;

-- Public site (anon) can subscribe. Basic email-shape check; unique dedupes.
drop policy if exists "newsletter subscribe" on newsletter_subscribers;
create policy "newsletter subscribe"
  on newsletter_subscribers for insert
  to anon, authenticated
  with check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- Only admins can read the list.
drop policy if exists "newsletter admin read" on newsletter_subscribers;
create policy "newsletter admin read"
  on newsletter_subscribers for select
  to authenticated
  using (is_admin());

-- Admin list for the portal.
create or replace function admin_list_subscribers()
returns table ( id bigint, email text, source text, created_at timestamptz )
language sql stable security definer set search_path = public as $$
  select id, email, source, created_at
  from newsletter_subscribers
  where is_admin()
  order by created_at desc;
$$;
revoke all on function admin_list_subscribers() from public, anon;
grant execute on function admin_list_subscribers() to authenticated;
