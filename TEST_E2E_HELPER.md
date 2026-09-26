# End to end: one SOS, one helper, one real walk

The gate. Nothing in Tasks 1 to 4 reaches a helper until this has happened
once and its findings are folded in.

Everything fixed in the dispatcher this week was found by reading what the
database actually held. This is the same discipline applied before the bug
exists.

---

## Before you start

**Phone A, the helper.** Install `ORBII-Helper-v0.11.0.apk`. Sign in with an
approved helper account. Do not go on duty yet.

**Phone B, the victim.** Install `ORBII-32.61.0.apk`. Sign in. Make sure she is
in a circle with at least one other person, and that person is not Phone A.
That matters: it is how you find out whether the helper's circle gets anything
it should not.

**Both phones:** battery above 50%, mobile data on, not on the same wifi if you
can avoid it. Two networks is closer to the real thing.

**Pick a real route.** 400m to 1km, outdoors, walkable in under fifteen
minutes. Somewhere you are both comfortable standing around.

Note the **UTC offset** you are recording in, once, so the timestamps line up
with the database later.

---

## The run

Write the wall-clock time against every line as it happens. Seconds matter for
the first four.

| # | Step | Time | Notes |
| --- | --- | --- | --- |
| 1 | Phone A goes **on duty** | | Foreground notification appears? |
| 2 | Wait 2 minutes, A stationary | | This is the `distanceInterval: 0` fix under test |
| 3 | Phone A starts walking the route | | |
| 4 | Phone B triggers **SOS** | | |
| 5 | Phone A's alert **arrives** | | Step 5 minus step 4 is dispatch latency |
| 6 | Phone A **accepts** (swipe) | | |
| 7 | Phone B sees "somebody is coming" | | |
| 8 | Phone A walks the route | | Watch the map against reality |
| 9 | Phone A arrives, taps **I have arrived** | | |
| 10 | Phone B reads the code aloud | | |
| 11 | Phone A enters it, code **accepted** | | |
| 12 | **Welfare check** appears | | New in 0.11.0 |
| 13 | Phone A taps **I'm okay** | | |
| 14 | Phone B confirms the SOS **resolved** | | |
| 15 | Both circle feeds show the sequence | | |

---

## What to watch, and what it would mean

**Step 2 is the one nobody usually tests.** Phone A must still be publishing
after two minutes of standing still. If it goes quiet, `distanceInterval: 0`
did not take and the stationary-helper bug is still live.

**Step 5 minus step 4 is the number that matters most.** Record it. It is the
first real dispatch latency figure this product has ever had. Do not let anyone
quote a number before this.

**Step 7 must not happen before step 6.** If she sees "somebody is coming"
before Phone A accepted, something is counting dispatched as accepted.

**Step 8, map accuracy.** Is the pin where the helper actually is, and does the
distance readout match reality? A "800 m away" that is really 300 m is a lie on
somebody's screen.

**Step 11 under real network.** The arrival code is the only thing that closes
a rescue and pays a helper. If it fails on mobile data, nothing else works.

**Anything Phone A's own circle receives.** It should be **nothing**. Phone A
is responding to somebody else's emergency, not having one. If Phone A's circle
gets an alert, that is a bug and it is a serious one.

---

## After the run: ask the database what happened

Paste these into the Supabase SQL editor and keep the output with the sheet.

```sql
-- 1. WHO THE DISPATCHER CONSIDERED, AND WHY IT SKIPPED ANYONE.
--    This is the whole reason sql/144 and sql/145 exist. Phone A should
--    appear as 'dispatched'. Anyone else in radius should name their reason.
select d.created_at, d.decision, d.reason, d.helper_id
from dispatch_decisions d
join sos_events e on e.id = d.sos_id
order by d.created_at desc
limit 20;

-- 2. DID THE HELPER KEEP PUBLISHING WHILE STANDING STILL?
--    Run this DURING step 2, not after. A gap longer than ~90 seconds means
--    the stationary fix did not take.
select user_id, is_online, updated_at, now() - updated_at as age
from helpers_live
order by updated_at desc;

-- 3. THE SOS ITSELF, AND HOW LONG IT WAS OPEN.
select id, trigger, status, created_at, resolved_at,
       resolved_at - created_at as open_for
from sos_events
order by created_at desc
limit 5;

-- 4. THE ACCEPTANCE ROW. left_at should be null the whole way through,
--    because Phone A arrived rather than backing out.
select sos_id, user_id, created_at, left_at, left_reason
from sos_responders
order by created_at desc
limit 10;

-- 5. THE ARRIVAL. entered_at set is what stops further waves.
select sos_id, entered_at
from sos_arrival_codes
order by entered_at desc nulls last
limit 5;
```

---

## If something goes wrong

**No alert on Phone A.** Query 1 first. If Phone A appears with
`excluded_stale`, the heartbeat is the problem, not the dispatcher. If Phone A
does not appear at all, they were out of radius or not in `helpers_live`.

**Alert but no accept.** Check `sos_responders` for a row. If there is one and
Phone B saw nothing, the read is the problem, not the write.

**Code rejected.** Check `sos_arrival_codes` for the SOS and compare the code
Phone B displayed with the row.

Do not fix anything mid-test. Finish the run, write down what happened, then
work out why. A fix applied halfway through makes the whole run unreadable.

---

## What this test can and cannot settle

**It can settle:** whether the loop works at all, dispatch latency once,
whether a stationary helper stays reachable, whether the arrival code survives
mobile data, and whether the helper's own circle is left alone.

**It cannot settle:** OEM background survival (that needs the phone left alone
for hours, on a Xiaomi), battery cost, behaviour with more than one helper in
radius, or anything about what happens when a helper is genuinely in danger.

One run proves the path exists. It does not prove the path is reliable, and
nobody should say it does.
