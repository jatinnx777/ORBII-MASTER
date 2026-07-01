-- 28_helper_economy.sql
-- ============================================================================
-- Helper economy (earnings + payouts), admin dashboard stats, and account
-- deletion. All money is stored in PAISE (integer) to avoid float errors.
--
-- HONEST SCOPE:
--   • Earnings are a real DB ledger. They are credited by an admin action
--     (admin_credit_earning) — until you define an automated reward source,
--     that is the live way money enters a helper's balance.
--   • Payouts are real requests. The final bank transfer is done by you (via
--     UPI / RazorpayX) and then marked paid here. Wiring RazorpayX later makes
--     that transfer automatic; nothing else changes.
-- ============================================================================

-- ── 1. Lock admin access to the founder's email ONLY ───────────────────────
-- Even if a role were mis-set, is_admin() is true only for this exact address.
create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and role = 'admin'
      and lower(email) = 'jaykumar2470f@gmail.com'
  );
$$;
revoke all on function is_admin() from public, anon;
grant execute on function is_admin() to authenticated;

-- ── 2. Earnings ledger ─────────────────────────────────────────────────────
create table if not exists helper_earnings (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  amount_paise bigint not null,           -- +credit (earned) / -debit (paid out)
  reason      text,
  created_at  timestamptz not null default now()
);
create index if not exists helper_earnings_user_idx on helper_earnings(user_id);
alter table helper_earnings enable row level security;
drop policy if exists "earnings read own" on helper_earnings;
create policy "earnings read own" on helper_earnings
  for select to authenticated using (auth.uid() = user_id or is_admin());
-- No client INSERT/UPDATE/DELETE policy → only SECURITY DEFINER RPCs write it.

-- ── 3. Payout requests ─────────────────────────────────────────────────────
create table if not exists payout_requests (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  amount_paise  bigint not null check (amount_paise > 0),
  method        text not null check (method in ('upi','bank')),
  upi_id        text,
  account_name  text,
  account_number text,
  ifsc          text,
  status        text not null default 'pending'
                  check (status in ('pending','paid','rejected')),
  admin_note    text,
  created_at    timestamptz not null default now(),
  processed_at  timestamptz
);
create index if not exists payout_requests_status_idx on payout_requests(status);
alter table payout_requests enable row level security;
drop policy if exists "payouts read own" on payout_requests;
create policy "payouts read own" on payout_requests
  for select to authenticated using (auth.uid() = user_id or is_admin());

-- ── 4. Helper-facing RPCs ──────────────────────────────────────────────────
-- Current user's stats: helped count, balance, total earned, verified flag.
create or replace function helper_stats()
returns table (
  helped        int,
  balance_paise bigint,
  earned_paise  bigint,
  verified      boolean
)
language sql stable security definer set search_path = public as $$
  select
    coalesce((select lifetime_responses from helper_profiles where user_id = auth.uid()), 0),
    coalesce((select sum(amount_paise) from helper_earnings where user_id = auth.uid()), 0),
    coalesce((select sum(amount_paise) from helper_earnings where user_id = auth.uid() and amount_paise > 0), 0),
    coalesce((select verification_status = 'verified' from helper_profiles where user_id = auth.uid()), false);
$$;
revoke all on function helper_stats() from public, anon;
grant execute on function helper_stats() to authenticated;

-- Request a payout. Validates balance, holds the amount immediately (debit),
-- and files a pending request for the admin to fulfil.
create or replace function request_payout(
  p_amount_paise bigint,
  p_method       text,
  p_upi          text default null,
  p_account_name text default null,
  p_account_number text default null,
  p_ifsc         text default null
)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  bal bigint;
  new_id bigint;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_amount_paise < 10000 then raise exception 'Minimum payout is ₹100'; end if;
  if p_method not in ('upi','bank') then raise exception 'invalid method'; end if;
  if p_method = 'upi' and coalesce(p_upi,'') = '' then raise exception 'UPI ID required'; end if;
  if p_method = 'bank' and (coalesce(p_account_number,'') = '' or coalesce(p_ifsc,'') = '')
    then raise exception 'Bank account and IFSC required'; end if;

  select coalesce(sum(amount_paise),0) into bal from helper_earnings where user_id = uid;
  if p_amount_paise > bal then raise exception 'Amount exceeds your balance'; end if;

  insert into payout_requests(user_id, amount_paise, method, upi_id, account_name, account_number, ifsc)
    values (uid, p_amount_paise, p_method, p_upi, p_account_name, p_account_number, p_ifsc)
    returning id into new_id;
  -- hold the funds so balance reflects the pending payout
  insert into helper_earnings(user_id, amount_paise, reason)
    values (uid, -p_amount_paise, 'Payout requested #' || new_id);
  return new_id;
end $$;
revoke all on function request_payout(bigint,text,text,text,text,text) from public, anon;
grant execute on function request_payout(bigint,text,text,text,text,text) to authenticated;

-- ── 5. Admin RPCs ──────────────────────────────────────────────────────────
-- Dashboard counters (all live).
create or replace function admin_stats()
returns table (
  total_users        bigint,
  verified_helpers   bigint,
  pending_helpers    bigint,
  active_premium     bigint,
  revenue_paise      bigint,
  active_sos         bigint,
  pending_payouts    bigint,
  pending_payout_paise bigint
)
language sql stable security definer set search_path = public as $$
  select
    (select count(*) from profiles where is_admin()),
    (select count(*) from helper_profiles where verification_status = 'verified' and is_admin()),
    (select count(*) from helper_profiles where verification_status = 'pending' and is_admin()),
    (select count(*) from entitlements where status = 'active' and premium_enabled and is_admin()),
    (select coalesce(sum(case plan_type when 'family' then 29900 else 9900 end),0)
       from entitlements where status = 'active' and premium_enabled and is_admin()),
    (select count(*) from sos_events
       where status = 'active' and created_at >= now() - interval '30 minutes' and is_admin()),
    (select count(*) from payout_requests where status = 'pending' and is_admin()),
    (select coalesce(sum(amount_paise),0) from payout_requests where status = 'pending' and is_admin());
$$;
revoke all on function admin_stats() from public, anon;
grant execute on function admin_stats() to authenticated;

-- Recent users (search by name/email).
create or replace function admin_list_users(p_search text default '', p_limit int default 50)
returns table (
  id uuid, name text, email text, phone text, role text,
  premium boolean, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.email, p.phone, p.role,
         coalesce(e.premium_enabled and e.status = 'active', false) as premium,
         p.created_at
  from profiles p
  left join entitlements e on e.user_id = p.id
  where is_admin()
    and (p_search = '' or p.name ilike '%'||p_search||'%' or p.email ilike '%'||p_search||'%')
  order by p.created_at desc
  limit greatest(1, least(p_limit, 200));
$$;
revoke all on function admin_list_users(text,int) from public, anon;
grant execute on function admin_list_users(text,int) to authenticated;

-- All payout requests with the helper's name/email.
create or replace function admin_list_payouts()
returns table (
  id bigint, user_id uuid, name text, email text,
  amount_paise bigint, method text, upi_id text,
  account_name text, account_number text, ifsc text,
  status text, admin_note text, created_at timestamptz, processed_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select pr.id, pr.user_id, p.name, p.email,
         pr.amount_paise, pr.method, pr.upi_id,
         pr.account_name, pr.account_number, pr.ifsc,
         pr.status, pr.admin_note, pr.created_at, pr.processed_at
  from payout_requests pr
  join profiles p on p.id = pr.user_id
  where is_admin()
  order by (pr.status = 'pending') desc, pr.created_at desc;
$$;
revoke all on function admin_list_payouts() from public, anon;
grant execute on function admin_list_payouts() to authenticated;

-- Mark a payout paid (after you've actually sent the money).
create or replace function admin_mark_payout_paid(p_id bigint, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not authorised'; end if;
  update payout_requests set status = 'paid', admin_note = p_note, processed_at = now()
    where id = p_id and status = 'pending';
end $$;
revoke all on function admin_mark_payout_paid(bigint,text) from public, anon;
grant execute on function admin_mark_payout_paid(bigint,text) to authenticated;

-- Reject a payout → reverse the hold back into the helper's balance.
create or replace function admin_reject_payout(p_id bigint, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r payout_requests;
begin
  if not is_admin() then raise exception 'not authorised'; end if;
  select * into r from payout_requests where id = p_id and status = 'pending';
  if not found then return; end if;
  update payout_requests set status = 'rejected', admin_note = p_note, processed_at = now()
    where id = p_id;
  insert into helper_earnings(user_id, amount_paise, reason)
    values (r.user_id, r.amount_paise, 'Payout #'||p_id||' rejected — refunded');
end $$;
revoke all on function admin_reject_payout(bigint,text) from public, anon;
grant execute on function admin_reject_payout(bigint,text) to authenticated;

-- Credit earnings to a helper (the live way money enters their balance).
create or replace function admin_credit_earning(target uuid, p_amount_paise bigint, p_reason text default 'Reward')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not authorised'; end if;
  if p_amount_paise = 0 then return; end if;
  insert into helper_earnings(user_id, amount_paise, reason)
    values (target, p_amount_paise, coalesce(p_reason,'Reward'));
end $$;
revoke all on function admin_credit_earning(uuid,bigint,text) from public, anon;
grant execute on function admin_credit_earning(uuid,bigint,text) to authenticated;

-- ── 6. Delete my account (Play-Store requirement) ──────────────────────────
-- Wipes ALL of the caller's data across the app, then best-effort removes the
-- auth user. Callable by the signed-in user from the app.
create or replace function delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  delete from helper_earnings   where user_id = uid;
  delete from payout_requests   where user_id = uid;
  delete from helper_profiles   where user_id = uid;
  delete from sos_events        where user_id = uid;
  begin delete from emergency_contacts where user_id = uid; exception when undefined_table then null; end;
  begin delete from entitlements       where user_id = uid; exception when undefined_table then null; end;
  begin delete from users_public       where id = uid;      exception when undefined_table then null; end;
  delete from profiles          where id = uid;
  -- Full auth removal (best-effort; if blocked, all personal data is already gone).
  begin delete from auth.users where id = uid; exception when others then null; end;
end $$;
revoke all on function delete_my_account() from public, anon;
grant execute on function delete_my_account() to authenticated;
