# ORBII — Deploy checklist (what's live vs pending)

Two kinds of backend code update **differently**:

- **SQL files** (`sql/*.sql`) → run in Supabase **SQL Editor** (paste the file, Run).
- **Edge Functions** (`supabase/functions/*`) → **deploy** them:
  `supabase functions deploy <name>`  (or edit + Deploy in the dashboard).

> Rule of thumb: I add a file under `sql/` → you **run** it. I change a file under
> `supabase/functions/` → you **deploy** it. All SQL here is idempotent (safe to
> re-run), so if unsure whether one was run, just run it again.

---

## SQL migrations to run (SQL Editor)

Tick each once you've run it. Run in order; the recent ones are what matter now.

- [ ] `sql/65_dpdp.sql` — consent log + delete-my-data
- [ ] `sql/66_helper_caps.sql` — free users get 0 verified helps + per-level monthly caps
- [ ] `sql/67_geofence_schedule.sql` — geofence "hours they should be inside"
- [ ] `sql/68_geofence_ack.sql` — fenced person's Keep / Decline consent
- [ ] `sql/69_responder_slots.sql` — best-3 responder matching + no-show recovery
      (anon key already inserted; returns a cron job id like `5` = success)

## Edge functions to deploy (`supabase functions deploy <name>`)

- [x] `notify-sos` — free=0 + stop escalating only when a helper is actually moving
- [ ] `notify-geofence` — "X left College at 9:42" alert to the whole circle

---

## How to know it worked
- **SQL:** no red error in the editor. `sql/69`'s last line returns a number (the
  cron job id) = the recovery loop is scheduled.
- **Function:** the terminal prints `Deployed Functions on project ...`.
  (`WARNING: Docker is not running` is fine — deploy doesn't need it.)

## Ops reminders
- Weekly DB backup: `powershell -File scripts\backup-supabase.ps1` (free-tier has
  no auto-backups). Keep a copy off your laptop.
- At real launch: Supabase **Pro** ($25/mo) adds daily backups + no pausing.
