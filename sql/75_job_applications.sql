-- 75_job_applications.sql
-- ============================================================================
-- Careers: job applications from orbii.in/join
--
-- A public form writes here. Two rules shape the whole design:
--
--   1. Anyone may APPLY. Nobody may READ. An applicant's CV, phone number and
--      salary expectation is exactly the kind of data that leaks from startup
--      side-projects, so the select policy is admin-only from the first line,
--      not something to add later.
--   2. Resumes go in a PRIVATE bucket. The admin portal reads them through
--      short-lived signed URLs, the same way responder documents work.
--
-- Idempotent. Run once in Supabase -> SQL Editor.
-- ============================================================================

create table if not exists public.job_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Who
  full_name text not null,
  email text not null,
  phone text,
  location text,
  linkedin_url text,
  portfolio_url text,

  -- What they want
  role text not null,
  experience_level text,          -- 'student' | '0-1' | '1-3' | '3-5' | '5+'
  years_experience int,
  availability text,              -- 'full-time' | 'part-time' | 'internship' | 'freelance'
  earliest_start text,
  compensation_note text,

  -- Their case. NOT named current_role: that is a reserved SQL standard
  -- function in Postgres, so an unquoted column of that name is a syntax error.
  current_position text,
  why_orbii text,
  proudest_work text,

  -- Private storage path, e.g. 'resumes/<uuid>.pdf'
  resume_path text,

  -- Review workflow
  status text not null default 'new'
    check (status in ('new', 'reviewing', 'shortlisted', 'rejected', 'hired')),
  reviewer_note text,
  reviewed_at timestamptz,

  -- Light abuse signal, not identification.
  source text
);

create index if not exists job_applications_created_idx
  on public.job_applications (created_at desc);
create index if not exists job_applications_status_idx
  on public.job_applications (status, created_at desc);

alter table public.job_applications enable row level security;

-- Anyone (including a signed-out visitor) may submit an application.
drop policy if exists "anyone can apply" on public.job_applications;
create policy "anyone can apply"
  on public.job_applications for insert
  to anon, authenticated
  with check (true);

-- Only admins may ever read one back.
drop policy if exists "admins read applications" on public.job_applications;
create policy "admins read applications"
  on public.job_applications for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admins update applications" on public.job_applications;
create policy "admins update applications"
  on public.job_applications for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Rate limit: one applicant cannot flood the table. Five per email per day is
-- generous for a real person and useless for a script.
-- ---------------------------------------------------------------------------
create or replace function public.job_applications_rate_limit()
returns trigger
language plpgsql
security definer set search_path = public as $$
declare
  recent int;
begin
  select count(*) into recent
  from public.job_applications
  where lower(email) = lower(new.email)
    and created_at > now() - interval '1 day';
  if recent >= 5 then
    raise exception 'Too many applications from this email today. Please email careers@orbii.in instead.';
  end if;
  return new;
end;
$$;

drop trigger if exists job_applications_rate_limit_trg on public.job_applications;
create trigger job_applications_rate_limit_trg
  before insert on public.job_applications
  for each row execute function public.job_applications_rate_limit();

-- ---------------------------------------------------------------------------
-- Private resume bucket. Same shape as responder-docs (sql/25).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

-- Uploads are allowed; reads are not. The admin portal uses createSignedUrl,
-- which runs with the caller's rights, so the admin read policy below is what
-- makes review possible.
drop policy if exists "anyone can upload a resume" on storage.objects;
create policy "anyone can upload a resume"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'resumes');

drop policy if exists "admins read resumes" on storage.objects;
create policy "admins read resumes"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'resumes' and public.is_admin());

-- ---------------------------------------------------------------------------
-- Admin listing. SECURITY DEFINER so one round-trip returns everything the
-- portal needs, still gated on is_admin().
-- ---------------------------------------------------------------------------
create or replace function public.admin_job_applications(p_status text default null)
returns setof public.job_applications
language sql security definer set search_path = public as $$
  select *
  from public.job_applications
  where public.is_admin()
    and (p_status is null or status = p_status)
  order by created_at desc
  limit 500;
$$;

grant execute on function public.admin_job_applications(text) to authenticated;

create or replace function public.admin_set_application_status(
  p_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not authorised';
  end if;
  update public.job_applications
     set status = p_status,
         reviewer_note = coalesce(p_note, reviewer_note),
         reviewed_at = now()
   where id = p_id;
end;
$$;

grant execute on function public.admin_set_application_status(uuid, text, text) to authenticated;
