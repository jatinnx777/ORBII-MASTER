-- 149_sos_audio_retention.sql
-- ============================================================================
-- SOS recordings get a retention period, and a person can delete their own.
--
-- ============================================================================
-- WHAT WAS WRONG
-- ============================================================================
--
-- Every real SOS records a clip and uploads it to the private `sos-recordings`
-- bucket. `enabled: !!activeSOS && activeSOS.kind !== 'test'` — so it is every
-- real SOS, automatically, not an opt-in.
--
-- Three things were true about that audio and none of them should have been:
--
--   1. PRIVACY_POLICY.md said "This audio is processed and stored entirely on
--      your device. It is never uploaded to our servers." It has always been
--      uploaded. That is a false statement about the most sensitive data the
--      product touches. Now corrected in the policy rather than in the wording.
--
--   2. Nothing ever deleted it. No expiry, no account deletion (which deletes
--      the row, not the file), and not sql/146 either. The single most sensitive
--      thing held was the only thing with no retention period.
--
--   3. There was no way for a person to delete their own recording, which is a
--      DPDP erasure right. The bucket's owner-delete policy from sql/11 already
--      permitted it; nothing in the app had ever called it.
--
-- ============================================================================
-- WHAT THIS DOES
-- ============================================================================
--
-- Schedules `purge-sos-audio` nightly at 90 days, and adds
-- `forget_sos_audio(sos_id)` so the app can clear the pointer when the owner
-- deletes their clip.
--
-- THE DELETION IS A TWO-PART JOB AND ONLY ONE PART CAN LIVE HERE. Postgres
-- refuses to delete from storage.objects (42501: use the Storage API). So the
-- client removes the file through the Storage API under the owner-delete policy,
-- and calls this to clear `audio_path`. The order matters and is enforced by the
-- client: file first, pointer second. A pointer cleared while the file remains
-- is the orphan case, and here the orphan would be audio of a person.
--
-- Idempotent. No transaction control.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Clear the pointer after the owner has deleted their own recording.
--
-- SECURITY DEFINER but scoped to the caller's own row by `auth.uid()`, never a
-- passed-in user id. A function that took a user id would let anyone clear
-- anyone's pointer, and "the audio is gone" is a claim that must be true.
-- ---------------------------------------------------------------------------
create or replace function public.forget_sos_audio(p_sos text)
returns boolean
language plpgsql security definer set search_path = public as $fn$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;

  update sos_events
     set audio_path = null
   where id::text = p_sos
     and user_id = uid;

  -- False means nothing matched: not their SOS, or already cleared. The caller
  -- shows the same thing either way, because "there is no recording" is the
  -- truthful end state in both cases.
  return found;
end $fn$;

comment on function public.forget_sos_audio(text) is
  'Clears sos_events.audio_path for the caller''s own SOS, after the client has removed the file through the Storage API. Never deletes the file itself: Postgres cannot (42501).';

revoke all on function public.forget_sos_audio(text) from public, anon;
grant execute on function public.forget_sos_audio(text) to authenticated;


-- ---------------------------------------------------------------------------
-- The nightly purge.
--
-- 02:10, before the helper document purge at 02:41, so the two heaviest storage
-- jobs do not overlap.
--
-- The anon key is embedded the same way sql/58 and sql/69 embed it for
-- notify-geofence and notify-sos. It is public by design and already ships in
-- the app; the function's own authority comes from its service-role environment,
-- not from this header.
-- ---------------------------------------------------------------------------
do $mig$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule('orbii-purge-sos-audio')
      where exists (select 1 from cron.job where jobname = 'orbii-purge-sos-audio');
    perform cron.schedule(
      'orbii-purge-sos-audio', '10 2 * * *',
      $job$
      select net.http_post(
        url := 'https://henbkyjefhzmxqozlczd.supabase.co/functions/v1/purge-sos-audio',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlbmJreWplZmh6bXhxb3psY3pkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NDkzNjksImV4cCI6MjA5MjEyNTM2OX0.JpNZwyzD75f75C8FNztE8_GMDAJKI-UKJMps6larhcA'
        ),
        body := jsonb_build_object('days', 90)
      );
      $job$);
  end if;
end $mig$;


-- ---------------------------------------------------------------------------
-- VERIFY
--
-- IMPORTANT: this cannot prove a single file was deleted. It proves the job is
-- scheduled and the function exists. The purge lives in an Edge Function that
-- must be DEPLOYED separately:
--
--     supabase functions deploy purge-sos-audio
--
-- A schedule pointing at a function that was never deployed is a green grid and
-- a bucket that still fills up. Confirm with a dry run before trusting it:
--
--     curl -X POST .../functions/v1/purge-sos-audio \
--       -H "Authorization: Bearer <anon key>" \
--       -H "Content-Type: application/json" \
--       -d '{"days":90,"dryRun":true}'
-- ---------------------------------------------------------------------------
select v.check, v.result
from (
  select 1 as ord, 'forget_sos_audio exists (must be true)' as check,
         (to_regprocedure('public.forget_sos_audio(text)') is not null)::text as result

  union all
  select 2, 'the owner can call it (must be true)',
         has_function_privilege('authenticated',
           'public.forget_sos_audio(text)', 'execute')::text

  union all
  select 3, 'anon cannot (must be false)',
         has_function_privilege('anon',
           'public.forget_sos_audio(text)', 'execute')::text

  union all
  select 4, 'purge scheduled nightly (must be true)',
         (exists (select 1 from cron.job where jobname = 'orbii-purge-sos-audio'))::text

  union all
  select 5, 'pg_net present, or the schedule does nothing (must be true)',
         (exists (select 1 from pg_extension where extname = 'pg_net'))::text

  union all
  select 6, 'the bucket is still private (must be false)',
         coalesce((select public::text from storage.buckets
                    where id = 'sos-recordings'), 'bucket missing')

  union all
  select 7, 'owner-delete policy on the bucket exists (must be true)',
         (exists (select 1 from pg_policies
                   where schemaname = 'storage' and tablename = 'objects'
                     and policyname = 'sos-recordings owner delete'))::text

  union all
  -- What is actually in there right now, and how old the oldest is. If the
  -- oldest exceeds 90 days after this has run a night, the Edge Function is not
  -- deployed and the policy's 90-day claim is false.
  select 8, 'recordings in the bucket',
         (select count(*)::text from storage.objects
           where bucket_id = 'sos-recordings')

  union all
  select 9, 'oldest recording (must fall under 90 days once running)',
         coalesce((select (now() - min(created_at))::text from storage.objects
                    where bucket_id = 'sos-recordings'), 'none')

  union all
  select 10, 'rows still pointing at a recording',
         (select count(*)::text from sos_events where audio_path is not null)
) v
order by v.ord;
