-- 114_jatin_coupon.sql
-- ============================================================================
-- A second code, because the first one is spent.
--
-- ORBII and ORBIIPLUS are one redemption per account, forever, so once you have
-- used one on an account there is no way back through the app. This adds JATIN
-- as a separate code, which gives that same account a fresh redemption.
--
-- WHY YOU NEED A FRESH ONE RATHER THAN A REPAIR, and it is not only the guard.
-- Plus is valid for 30 days from purchase_date (PLUS_VALID_DAYS in
-- razorpay.ts). fetchEntitlementTier reads that date and returns 'none' once it
-- is older than 30 days. So an old redemption is dead twice over: the coupon is
-- spent AND the entitlement it wrote has aged out. Redeeming JATIN writes a new
-- purchase_date, which restarts the clock.
--
-- The one-month limit you asked about is therefore already built and already
-- enforced. Nothing here adds it.
--
-- NOT CAPPED, and that is deliberate. A max_uses of 1 would burn the code the
-- first time you redeem it and leave you in exactly the position that made this
-- file necessary. Uncapped costs nothing while it is private, and the
-- per-account guard still means no single person can farm it.
--
-- Idempotent. Run after sql/113.
-- ============================================================================

insert into coupons (code, plan_type) values ('JATIN', 'plus')
  on conflict (code) do nothing;

-- If it exists from an earlier run, make sure nothing has since switched it off
-- or aged it out.
update coupons
   set active = true,
       valid_until = null,
       max_uses = null
 where code = 'JATIN';

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select code,
       plan_type,
       active,
       used_count,
       coalesce(max_uses::text, 'unlimited') as max_uses,
       coalesce(valid_until::text, 'never expires') as valid_until,
       case
         when not active then 'INACTIVE'
         when valid_until is not null and valid_until < now() then 'EXPIRED'
         when max_uses is not null and used_count >= max_uses then 'EXHAUSTED'
         else 'USABLE'
       end as verdict
from coupons
where code in ('JATIN', 'ORBII', 'ORBIIPLUS')
order by code;

-- ---------------------------------------------------------------------------
-- AFTER THIS
-- ---------------------------------------------------------------------------
-- 1. Install 32.34.0. Without it the entitlement is never read back at sign-in
--    and Plus disappears on the next launch however you obtain it.
-- 2. Redeem JATIN in the app.
-- 3. Force close, reopen. Plus should still be on. That second step is the
--    whole point of the 32.34.0 fix and the only way to know it worked.
--
-- It lasts 30 days. When it lapses you will be in the same position again,
-- because a coupon is a one-off by design and you are not a customer. The
-- durable answer is to make an admin account permanently entitled rather than
-- minting a code a month, and that is a small change to the client, not more
-- SQL. Say the word.
-- ---------------------------------------------------------------------------
