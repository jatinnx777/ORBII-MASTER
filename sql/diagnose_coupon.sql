-- diagnose_coupon.sql
-- ============================================================================
-- Why "ORBII" is not working, and how to make it work again for testing.
--
-- Not a migration. A script you paste into the SQL editor when a code is
-- refused and you need to know which of the five reasons it was, because the
-- app deliberately does not say. redeem_coupon (sql/59) returns exactly one of:
--
--   invalid    no row with that code, or the row is not active
--   expired    valid_until has passed
--   exhausted  used_count has reached max_uses
--   already    THIS account has redeemed THIS code before, ever
--   error      the RPC itself failed
--
-- 'already' is by far the most likely one when you are the person testing. The
-- guard is one redemption per code per account, forever, and it is correct in
-- production: without it a single promo code is an unlimited free tier. It just
-- makes the code look broken to the one person who redeems it most.
--
-- SET YOUR EMAIL by find-and-replacing the address below, then run the file.
--
-- NOTE: no \set here. That is a psql meta-command and the Supabase SQL editor
-- is not psql: it sends the text straight to the server, which sees a
-- backslash and stops. Plain literals only.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. WHAT THE COUPON ACTUALLY LOOKS LIKE
-- ---------------------------------------------------------------------------
-- If this returns no rows, sql/59 was never run against this project, or was
-- run before the starter codes were added. That is 'invalid'.
select
  code,
  plan_type,
  active,
  used_count,
  max_uses,
  valid_until,
  case
    when not active                                    then 'INACTIVE'
    when valid_until is not null and valid_until < now() then 'EXPIRED'
    when max_uses is not null and used_count >= max_uses then 'EXHAUSTED'
    else 'USABLE'
  end as verdict
from coupons
where code in ('ORBII', 'ORBIIPLUS')
order by code;

-- ---------------------------------------------------------------------------
-- 2. HAVE YOU ALREADY REDEEMED IT
-- ---------------------------------------------------------------------------
-- Any row here means the app was right to refuse you, and the reason was
-- 'already'.
select r.code, r.user_id, r.redeemed_at
from coupon_redemptions r
join auth.users u on u.id = r.user_id
where u.email = 'jaykumar2470f@gmail.com'
order by r.redeemed_at desc;

-- ---------------------------------------------------------------------------
-- 3. WHAT YOU CURRENTLY HAVE
-- ---------------------------------------------------------------------------
-- If premium_enabled is already true, the coupon worked and the app is not
-- lying to you. See the note at the bottom about why that may look like
-- nothing happened.
select e.plan_type, e.status, e.premium_enabled, e.purchase_date
from entitlements e
join auth.users u on u.id = e.user_id
where u.email = 'jaykumar2470f@gmail.com';

-- ---------------------------------------------------------------------------
-- 4. THE REPAIRS
-- ---------------------------------------------------------------------------
-- Uncomment the one your diagnosis calls for. Nothing below runs as written.

-- (a) The codes do not exist. Create them, unlimited and never expiring.
-- insert into coupons (code, plan_type) values ('ORBII', 'plus')
--   on conflict (code) do nothing;
-- insert into coupons (code, plan_type) values ('ORBIIPLUS', 'plus')
--   on conflict (code) do nothing;

-- (b) Inactive, expired or exhausted. Open it back up.
-- update coupons
--    set active = true, valid_until = null, max_uses = null
--  where code in ('ORBII', 'ORBIIPLUS');

-- (c) 'already', and you want to test the redemption flow again.
--
-- This clears YOUR redemption only, by email, so the one-per-account guard
-- stays intact for everybody else. Do not turn this into a migration: the
-- guard is the only thing standing between one promo code and a permanent
-- free tier.
-- delete from coupon_redemptions
--  where user_id = (select id from auth.users where email = 'jaykumar2470f@gmail.com');

-- (d) You just want Plus on this account and do not care about the coupon.
-- insert into entitlements (user_id, plan_type, status, premium_enabled, purchase_date, updated_at)
-- select id, 'plus', 'active', true, now(), now() from auth.users where email = 'jaykumar2470f@gmail.com'
--     on conflict (user_id) do update
--    set plan_type = 'plus', status = 'active', premium_enabled = true, updated_at = now();

-- ---------------------------------------------------------------------------
-- AND THE THING THAT MAY BE THE REAL ANSWER
-- ---------------------------------------------------------------------------
-- Redeeming may be working perfectly and changing nothing visible.
--
-- entitlements.ts has EARLY_ACCESS_UNLOCK = true, which makes every feature
-- free except the ALWAYS_GATED set. Disaster mode left that set, and community
-- left it today. What is left is exactly one feature:
--
--   circle_geofencing
--
-- So ORBII Plus currently unlocks safe-zone geofencing and nothing else. If you
-- redeemed the code and saw no difference, that is not a bug in the coupon. It
-- is that there is almost nothing left to unlock, which is worth knowing before
-- you spend an evening debugging the coupon.
-- ---------------------------------------------------------------------------
