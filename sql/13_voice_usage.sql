-- ORBII Voice SOS usage — monthly activation counter per user.
-- Paste into Supabase → SQL Editor → Run (once).
--
-- The client gates on a local count (works offline / for phone-OTP users);
-- this table is the cross-device + analytics mirror. `record_voice_sos`
-- increments the caller's row for the given calendar month.

create table if not exists public.voice_sos_usage (
  user_id    uuid not null references auth.users(id) on delete cascade,
  period     text not null,            -- 'YYYY-MM'
  count      int  not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, period)
);

alter table public.voice_sos_usage enable row level security;

drop policy if exists voice_usage_own_sel on public.voice_sos_usage;
create policy voice_usage_own_sel on public.voice_sos_usage
  for select to authenticated using (auth.uid() = user_id);

create or replace function public.record_voice_sos(p_period text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  new_count int;
begin
  insert into public.voice_sos_usage (user_id, period, count, updated_at)
  values (auth.uid(), p_period, 1, now())
  on conflict (user_id, period) do update
    set count = public.voice_sos_usage.count + 1,
        updated_at = now()
  returning count into new_count;
  return new_count;
end; $$;

grant execute on function public.record_voice_sos(text) to authenticated;
