-- 59_coupons.sql
-- ============================================================================
-- Coupon codes that unlock ORBII Plus at checkout. Redeeming a valid code writes
-- a real entitlement (server-side, authoritative), so it survives reinstall the
-- same way a paid subscription does. This is how people get Plus while in-app
-- billing (Play Billing) is not wired yet.
--
-- Add a coupon:
--   insert into coupons (code, plan_type, max_uses, valid_until)
--     values ('ECELL2026', 'plus', 100, now() + interval '90 days');
-- Unlimited, never expiring:
--   insert into coupons (code, plan_type) values ('ORBIIPLUS', 'plus');
--
-- Run once in Supabase.
-- ============================================================================

create table if not exists coupons (
  code        text primary key,                 -- stored UPPER-CASE
  plan_type   text not null default 'plus' check (plan_type in ('plus', 'family')),
  valid_until timestamptz,                       -- null = never expires
  max_uses    int,                               -- null = unlimited
  used_count  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- One redemption per user per code.
create table if not exists coupon_redemptions (
  code        text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (code, user_id)
);

alter table coupons enable row level security;              -- no client policy: only the RPC reads/writes
alter table coupon_redemptions enable row level security;   -- ditto

-- Redeem a coupon for the signed-in user. Validates, records the redemption, and
-- writes the entitlement. SECURITY DEFINER so it can write entitlements (which
-- are otherwise service-role-only). Returns { ok, plan } or { ok:false, reason }.
create or replace function public.redeem_coupon(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  c   coupons%rowtype;
  norm text := upper(trim(p_code));
begin
  if uid is null then raise exception 'auth required'; end if;
  if norm = '' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;

  select * into c from coupons where code = norm and active for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if c.valid_until is not null and c.valid_until < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if c.max_uses is not null and c.used_count >= c.max_uses then
    return jsonb_build_object('ok', false, 'reason', 'exhausted');
  end if;
  if exists (select 1 from coupon_redemptions r where r.code = norm and r.user_id = uid) then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;

  insert into coupon_redemptions (code, user_id) values (norm, uid);
  update coupons set used_count = used_count + 1 where code = norm;

  insert into entitlements (user_id, plan_type, status, premium_enabled, purchase_date, updated_at)
    values (uid, c.plan_type, 'active', true, now(), now())
  on conflict (user_id) do update
    set plan_type = excluded.plan_type,
        status = 'active',
        premium_enabled = true,
        purchase_date = now(),
        updated_at = now();

  return jsonb_build_object('ok', true, 'plan', c.plan_type);
end $$;

revoke all on function public.redeem_coupon(text) from public, anon;
grant execute on function public.redeem_coupon(text) to authenticated;

-- Starter codes. 'ORBII' unlocks Plus for free (the public promo). Change/remove
-- as you like. (Re-run just these inserts to add them to an existing DB.)
insert into coupons (code, plan_type) values ('ORBIIPLUS', 'plus')
  on conflict (code) do nothing;
insert into coupons (code, plan_type) values ('ORBII', 'plus')
  on conflict (code) do nothing;
