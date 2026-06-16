-- 19_entitlements.sql
-- ============================================================================
-- ORBII Plus entitlements. ADDITIVE — does not touch any existing table.
--
-- The row is written ONLY by the `verify-payment` Supabase Edge Function using
-- the service-role key (after it verifies the Razorpay signature server-side).
-- Clients may READ their own entitlement but never WRITE it — so a forged
-- client-side "payment success" can never grant Plus.
-- ============================================================================

create table if not exists entitlements (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  plan_type      text not null default 'free'
                   check (plan_type in ('free', 'solo', 'family', 'plus')),
  status         text not null default 'inactive'
                   check (status in ('inactive', 'active', 'cancelled', 'expired')),
  premium_enabled boolean not null default false,
  purchase_date  timestamptz,
  razorpay_payment_id text,
  updated_at     timestamptz not null default now()
);

-- Widen plan_type to the Solo/Family tiers (safe to re-run on an existing
-- table that only had 'free'/'plus').
alter table entitlements drop constraint if exists entitlements_plan_type_check;
alter table entitlements add constraint entitlements_plan_type_check
  check (plan_type in ('free', 'solo', 'family', 'plus'));

alter table entitlements enable row level security;

-- Read-only for the owner. No INSERT/UPDATE/DELETE policy exists for the
-- `authenticated` role, so PostgREST refuses client writes entirely; only the
-- service role (Edge Function) can upsert.
drop policy if exists "entitlements read own" on entitlements;
create policy "entitlements read own"
  on entitlements for select
  to authenticated
  using (auth.uid() = user_id);
