-- 77_bdsm_integrity.sql
-- ============================================================================
-- BDSM: behavioural detection of inauthentic accounts.
--
-- Modelled on X's BDSM component (xai-org/x-algorithm). Theirs is a
-- bidirectional transformer over a user's action sequence, with time-aware RoPE
-- so the model sees the RHYTHM of the actions, not just their order, feeding
-- eight task heads (FollowBot, LikeBot, EngagementAmplifier, ReplySpamBot,
-- TweetSpamBot, RTBot, MultiActionBot, LegitimateUser).
--
-- We are not shipping a transformer. What we take is the design, which is the
-- valuable part:
--
--   1. Judge accounts on BEHAVIOUR, never on what they said. A safety app must
--      never suppress a person for the content of a warning.
--   2. The signal lives in TIMING. Humans are irregular; scripts are not. The
--      discriminating feature is the variance of the gaps between actions.
--   3. A minimum-actions gate before anyone is scored at all.
--   4. Per-head thresholds and GRADUATED response, not a single ban hammer.
--
-- WHY THIS EXISTS AT ALL: it protects sql/76.
-- Matrix-factorization bridging asks whether people who normally disagree both
-- found a post helpful. Fifty sock puppets can be built to LOOK like a diverse
-- crowd, and if they can, they can manufacture a "bridged" verdict and put a
-- lie about a named person at the top of a campus safety feed. Bridging decides
-- what is helpful; BDSM decides whose opinion is real. Neither works alone,
-- which is exactly why X runs both.
--
-- Idempotent. Run once in Supabase -> SQL Editor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The action sequence. Append-only, content-free.
--
-- We store WHAT KIND of action, WHEN, and a hash of the target. Never the text.
-- The model must not be able to learn "this person keeps posting about a
-- particular warden", only "this account acts like a script".
-- ---------------------------------------------------------------------------
create table if not exists community_actions (
  id        bigserial primary key,
  user_id   uuid not null references auth.users(id) on delete cascade,
  action    text not null check (action in
              ('post', 'comment', 'rate', 'react', 'follow', 'report', 'share')),
  target_id uuid,
  surface   text,
  at        timestamptz not null default now()
);
create index if not exists community_actions_user_idx on community_actions (user_id, at desc);
create index if not exists community_actions_target_idx on community_actions (action, target_id);

alter table community_actions enable row level security;

-- Users write their own trail and can read it back (they are entitled to see
-- what we hold). Nobody reads anyone else's; the scorer uses the service role.
drop policy if exists "actions insert self" on community_actions;
create policy "actions insert self" on community_actions
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "actions read own" on community_actions;
create policy "actions read own" on community_actions
  for select to authenticated using (auth.uid() = user_id);

create or replace function public.log_community_action(
  p_action text, p_target uuid default null, p_surface text default null
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into community_actions (user_id, action, target_id, surface)
    values (auth.uid(), p_action, p_target, p_surface);
end $$;

grant execute on function public.log_community_action(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Where the verdicts land. One row per user, eight heads plus a summary.
-- ---------------------------------------------------------------------------
create table if not exists community_integrity (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  follow_bot     double precision not null default 0,
  rate_bot       double precision not null default 0,  -- X's LikeBot
  amplifier      double precision not null default 0,  -- EngagementAmplifier
  reply_spam     double precision not null default 0,
  post_spam      double precision not null default 0,
  multi_action   double precision not null default 0,
  legitimate     double precision not null default 1,
  action_count   int not null default 0,
  -- 1.0 = trusted, 0.0 = ignored. Multiplies this user's rating weight in the
  -- bridging fit, so a suspected script is faded out rather than deleted.
  trust          double precision not null default 1,
  verdict        text not null default 'unscored'
                   check (verdict in ('unscored', 'clean', 'watch', 'restricted')),
  scored_at      timestamptz
);

alter table community_integrity enable row level security;
-- A user may see their own standing. Nobody may see anyone else's, because a
-- public bot score is a harassment tool.
drop policy if exists "integrity read own" on community_integrity;
create policy "integrity read own" on community_integrity
  for select to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. The gate.
--
-- X redacts their exact minimum with a 999999 sentinel, for the good reason
-- that publishing it hands attackers the evasion boundary. Ours is visible
-- because our threat model is a hostel WhatsApp group, not a state actor, and
-- being auditable is worth more to us than being unguessable.
--
-- 12 actions. Below that, a real new user and a script are genuinely
-- indistinguishable, and guessing would mean throttling real students on their
-- first day.
-- ---------------------------------------------------------------------------
create or replace function public.bdsm_min_actions() returns int
language sql immutable as $$ select 12 $$;

-- ---------------------------------------------------------------------------
-- 4. Behavioural features, computed per user over a 7-day window.
--
-- The load-bearing one is `cadence_cv`: the coefficient of variation of the
-- gaps between consecutive actions. A person reads, gets distracted, replies,
-- puts the phone down. Their gaps vary wildly, so CV is high. A loop sleeps a
-- fixed interval, so its CV collapses toward zero. This is the SQL equivalent
-- of what time-aware RoPE gives the transformer: sensitivity to rhythm rather
-- than to order.
-- ---------------------------------------------------------------------------
create or replace function public.bdsm_features()
returns table (
  user_id uuid,
  n_actions int,
  cadence_cv double precision,
  peak_per_hour double precision,
  distinct_target_ratio double precision,
  rate_share double precision,
  follow_share double precision,
  comment_share double precision,
  post_share double precision,
  span_hours double precision
)
language sql security definer set search_path = public stable as $$
  with recent as (
    select a.user_id, a.action, a.target_id, a.at,
           lag(a.at) over (partition by a.user_id order by a.at) as prev_at
    from community_actions a
    where a.at > now() - interval '7 days'
  ),
  gaps as (
    select user_id, extract(epoch from (at - prev_at)) as gap
    from recent where prev_at is not null
  ),
  gap_stats as (
    select user_id,
           avg(gap) as mean_gap,
           coalesce(stddev_pop(gap), 0) as sd_gap
    from gaps where gap >= 0 group by user_id
  ),
  hourly as (
    select user_id, date_trunc('hour', at) as h, count(*) as c
    from recent group by 1, 2
  ),
  peaks as (select user_id, max(c)::double precision as peak from hourly group by 1)
  select
    r.user_id,
    count(*)::int as n_actions,
    -- High CV = irregular = human. Low CV = metronomic = script.
    case when g.mean_gap is null or g.mean_gap <= 0 then 1.0
         else least(3.0, g.sd_gap / g.mean_gap) end as cadence_cv,
    coalesce(p.peak, 0) as peak_per_hour,
    (count(distinct r.target_id)::double precision
       / greatest(1, count(r.target_id))) as distinct_target_ratio,
    (count(*) filter (where r.action = 'rate')::double precision / count(*)) as rate_share,
    (count(*) filter (where r.action = 'follow')::double precision / count(*)) as follow_share,
    (count(*) filter (where r.action = 'comment')::double precision / count(*)) as comment_share,
    (count(*) filter (where r.action = 'post')::double precision / count(*)) as post_share,
    greatest(0.25, extract(epoch from (max(r.at) - min(r.at))) / 3600.0) as span_hours
  from recent r
  left join gap_stats g on g.user_id = r.user_id
  left join peaks p on p.user_id = r.user_id
  group by r.user_id, g.mean_gap, g.sd_gap, p.peak;
$$;

-- ---------------------------------------------------------------------------
-- 5. Co-rating overlap: the EngagementAmplifier head.
--
-- One script is easy to spot. A ring is not, because each member looks normal
-- alone. What gives a ring away is that its members keep landing on the SAME
-- posts, far more often than chance would put them there.
--
-- Returns, per user, the highest share of their rated posts that any single
-- other user also rated. Two friends who genuinely read the same feed score
-- moderately; twenty accounts rating an identical set score near 1.0.
-- ---------------------------------------------------------------------------
create or replace function public.bdsm_overlap()
returns table (user_id uuid, max_overlap double precision)
language sql security definer set search_path = public stable as $$
  with r as (
    select user_id, post_id from community_ratings
    where created_at > now() - interval '7 days'
  ),
  totals as (select user_id, count(*)::double precision as n from r group by 1),
  pairs as (
    select a.user_id as u, b.user_id as v, count(*)::double precision as shared
    from r a join r b on a.post_id = b.post_id and a.user_id <> b.user_id
    group by 1, 2
  )
  select t.user_id,
         coalesce(max(p.shared / greatest(1, t.n)), 0) as max_overlap
  from totals t left join pairs p on p.u = t.user_id
  where t.n >= 5           -- below this, overlap is noise
  group by t.user_id;
$$;

-- ---------------------------------------------------------------------------
-- 6. Score every user and write the verdicts.
--
-- Each head is a bounded 0-1 suspicion built from the features above. Graduated
-- response, as in the reference design:
--
--   clean       trust 1.0    nothing happens
--   watch       trust 0.5    ratings count for half; the person is never told,
--                            because telling a script its score is free tuning
--   restricted  trust 0.0    ratings are ignored by the bridging fit
--
-- Nothing here deletes a post, hides a warning, or blocks anyone from firing an
-- SOS. The worst outcome is that an account stops influencing what other people
-- see, which is the correct ceiling for an automated judgement.
-- ---------------------------------------------------------------------------
create or replace function public.bdsm_score_all()
returns int
language plpgsql security definer set search_path = public as $$
declare
  f record;
  n int := 0;
  v_follow double precision; v_rate double precision; v_amp double precision;
  v_reply double precision;  v_post double precision; v_multi double precision;
  v_worst double precision;  v_trust double precision; v_verdict text;
  v_ov double precision;
  v_mech double precision;   v_burst double precision; v_narrow double precision;
begin
  -- Overlap is a self-join across every rating, so compute it ONCE up front.
  -- Calling bdsm_overlap() per user inside the loop re-ran that join for every
  -- account, which is fine at 11 users and falls over at a few thousand.
  create temporary table if not exists _bdsm_ov (
    user_id uuid primary key, max_overlap double precision
  ) on commit drop;
  delete from _bdsm_ov;
  insert into _bdsm_ov select * from public.bdsm_overlap();

  for f in select * from public.bdsm_features() loop
    if f.n_actions < public.bdsm_min_actions() then
      insert into community_integrity (user_id, action_count, verdict, scored_at)
        values (f.user_id, f.n_actions, 'unscored', now())
      on conflict (user_id) do update
        set action_count = excluded.action_count, verdict = 'unscored',
            trust = 1, scored_at = now();
      continue;
    end if;

    select coalesce(o.max_overlap, 0) into v_ov
      from _bdsm_ov o where o.user_id = f.user_id;
    v_ov := coalesce(v_ov, 0);

    -- Mechanical cadence: CV below ~0.6 is where humans stop appearing.
    -- Squared so a mildly regular user is barely touched while a metronome
    -- climbs fast.
    v_mech   := power(greatest(0, (0.6 - f.cadence_cv) / 0.6), 2);
    v_burst  := least(1, greatest(0, (f.peak_per_hour - 40) / 160.0));
    v_narrow := greatest(0, 1 - f.distinct_target_ratio);

    v_follow := least(1, v_mech * 0.6 + f.follow_share * v_burst * 0.8);
    v_rate   := least(1, v_mech * 0.6 + f.rate_share * v_burst * 0.9);
    v_amp    := least(1, greatest(0, (v_ov - 0.55) / 0.45) * 0.85 + v_mech * 0.3);
    v_reply  := least(1, f.comment_share * (v_mech * 0.7 + v_narrow * 0.5));
    v_post   := least(1, f.post_share * (v_mech * 0.7 + v_burst * 0.5));
    v_multi  := least(1, v_mech * 0.5 + v_burst * 0.5);

    v_worst := greatest(v_follow, v_rate, v_amp, v_reply, v_post, v_multi);
    if v_worst >= 0.75 then
      v_verdict := 'restricted'; v_trust := 0;
    elsif v_worst >= 0.45 then
      v_verdict := 'watch'; v_trust := 0.5;
    else
      v_verdict := 'clean'; v_trust := 1;
    end if;

    insert into community_integrity as ci (
      user_id, follow_bot, rate_bot, amplifier, reply_spam, post_spam,
      multi_action, legitimate, action_count, trust, verdict, scored_at)
    values (f.user_id, v_follow, v_rate, v_amp, v_reply, v_post,
            v_multi, 1 - v_worst, f.n_actions, v_trust, v_verdict, now())
    on conflict (user_id) do update set
      follow_bot = excluded.follow_bot, rate_bot = excluded.rate_bot,
      amplifier = excluded.amplifier, reply_spam = excluded.reply_spam,
      post_spam = excluded.post_spam, multi_action = excluded.multi_action,
      legitimate = excluded.legitimate, action_count = excluded.action_count,
      trust = excluded.trust, verdict = excluded.verdict, scored_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 7. The join point: the bridging fit now reads WEIGHTED ratings.
--
-- A restricted account's rating still exists and the person still sees their
-- own tap register. It simply carries no weight in deciding what everyone else
-- is shown. Shadow-weighting rather than shadow-banning: we never take away
-- their ability to speak, only their ability to decide what others read.
-- ---------------------------------------------------------------------------
-- Gains a weight column over the sql/76 version, so it must be dropped first.
drop function if exists public.community_rating_matrix();

create or replace function public.community_rating_matrix()
returns table (post_id uuid, user_id uuid, value double precision, weight double precision)
language sql security definer set search_path = public stable as $$
  select r.post_id, r.user_id,
         case r.rating when 'helpful' then 1.0 when 'somewhat' then 0.5 else 0.0 end,
         coalesce(ci.trust, 1.0)
  from community_ratings r
  left join community_integrity ci on ci.user_id = r.user_id
  where coalesce(ci.trust, 1.0) > 0;
$$;

-- Your own standing, so the app can tell someone they are limited rather than
-- leaving them wondering why nothing they rate seems to matter.
create or replace function public.my_integrity()
returns table (verdict text, trust double precision, action_count int)
language sql security definer set search_path = public stable as $$
  select ci.verdict, ci.trust, ci.action_count
  from community_integrity ci where ci.user_id = auth.uid();
$$;

grant execute on function public.my_integrity() to authenticated;
