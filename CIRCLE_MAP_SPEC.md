# ORBII Circle Map + Live Location — spec & roadmap

The Life360-style layer: see everyone in your circle live, and know the moment
someone leaves a safe area. Paired with geofencing, this is the feature a college
safety office pays for. Founder view (Jatin): as important as Voice SOS and the
mesh; build it best-in-class.

## What's built (v1, needs device testing)
- **Opt-in live sharing.** A toggle starts a background location task that posts
  your position (~every 60s / 40m of movement) to `circle_locations`. Off forgets
  your last position. (circle-location.ts, sql/63.)
- **Circle map.** Full-bleed map (fast, inlined Leaflet + CARTO tiles) showing
  every circle member who's sharing, as coloured avatar pins, with a live list
  ("updated 2m ago"). CircleMapScreen. On Home + Plus-gated.
- **Breadcrumb history** stored server-side (`circle_location_history` +
  `circle_member_trail` RPC) — data accrues from day one; the history UI is a
  fast-follow.
- **Leave alerts** already exist (geofencing): "Justin left College at 9:42 PM"
  to the whole circle.
- **Privacy-first**: strictly opt-in, only visible to your own circles, pausable,
  RLS-enforced (`shares_circle_with`).

## The ONLY two things we build here (founder decision, Aug 2026)
Everything else on the old roadmap is cut. Just these two, done really well:

1. **Location history UI (breadcrumbs).** "Where was she at 9:40?" Tap a member on
   the Circle map to see their recent trail drawn on the map + a simple timeline.
   Data is already stored; `circle_member_trail` is ready.
2. **Precision & freshness.** Draw each member's accuracy circle, a hard
   "updated Xs ago" with a green/amber/grey freshness dot, and grey out stale
   pins so you always know how fresh and how precise a position is.

## HARD PRIVACY PRINCIPLE (non-negotiable)
**ORBII never hands a user's location or data to a college, an institution, or any
third party. We never sell ORBII's data. Ever.** The campus/B2B model is only ever
"the college pays so its students HAVE ORBII" — a bulk licence. The college gets
NO dashboard, NO student locations, NO data access. A student's position is visible
only to the people in her own circle, whom she chose, enforced by RLS. There is no
control-room, no admin data feed, and there never will be. This is the whole point
of a trustworthy safety app, and it is the line we do not cross.

## Cost / scale (survives ₹200/student)
The write-heavy risk is `circle_location_history`, not `circle_locations` (one
upserted row per user, bounded). Fixed in sql/64:
- **Movement-gated breadcrumbs:** `set_circle_location` only appends history when
  the user moved >50 m or 5 min passed, so a stationary phone writes ~nothing.
- **Prune cron:** pg_cron wipes breadcrumbs older than 48h hourly, so history can
  never grow unbounded. (Later: cheaper archive + longer retention for Plus.)
- Client posts ~every 60 s / 40 m; can be relaxed to 90–120 s if writes bite.

## Guardrails
- Sharing is opt-in and pausable; never on by default.
- Only your own circle ever sees you (RLS via `shares_circle_with`).
- Location sharing is a v1 first cut until proven on real phones (background
  reliability + battery vary by OEM).

Related: geofencing (sql/41/57/62), Safe Journey, [[project_orbii]].
