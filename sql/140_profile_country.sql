-- 140_profile_country.sql
-- ============================================================================
-- A country on the profile, and NO screen asking for it.
--
-- The onboarding reference (Revolut) asks country of residence and citizenship
-- because financial regulation requires KYC. ORBII has no such requirement, so
-- copying those screens would mean collecting two identity attributes with no
-- purpose behind either. DPDP section 6 ties consent to a stated purpose, and
-- nationality in particular is an attribute that can be used to discriminate.
-- We are not holding it.
--
-- Country is different: it decides which emergency number the app dials, which
-- is hardcoded to 112 today. That is a real purpose.
--
-- BUT IT IS NOT WORTH A SCREEN YET. ORBII ships in India only, so the question
-- has exactly one possible answer, and a screen that asks nothing still costs
-- an install. The column exists so the day a second country matters, the data
-- model does not have to change and existing rows already say 'IN'.
--
-- Idempotent.
-- ============================================================================

alter table public.profiles
  add column if not exists country text not null default 'IN';

comment on column public.profiles.country is
  'ISO 3166-1 alpha-2. Decides which emergency number the app dials. Defaults to IN because that is the only market shipped. Not asked during onboarding: with one possible answer the question is noise.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_country_check'
  ) then
    -- Two letters, upper case. Loose on purpose: a strict list would have to be
    -- migrated on the first day a second country ships.
    alter table public.profiles add constraint profiles_country_check
      check (country ~ '^[A-Z]{2}$');
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'country column exists' as check,
       (exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='profiles'
                  and column_name='country'))::text as result
union all
select 'every existing profile says IN',
       (select coalesce(bool_and(country = 'IN'), true)::text from profiles)
union all
select 'no nationality column was added (must be true)',
       (not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='profiles'
                      and column_name in ('nationality','citizenship')))::text;
