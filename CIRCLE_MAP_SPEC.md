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

## Roadmap to make it best-in-class (research-backed)
Ordered by value. The starred items are what turns this into a paid campus product.

1. **Location history UI (breadcrumbs).** "Where was she at 9:40?" Life360's most-
   loved premium feature. Data is already stored; add a timeline + trail on the
   map (`circle_member_trail` is ready). Free = today only; Plus = 7–30 days.
2. **★ Campus control-room (web dashboard).** The B2B money-maker: a browser
   dashboard for the college safety office — opted-in students on a campus map,
   live SOS feed, who has left a campus geofence, incident log, one-click call.
   Colleges buy the dashboard + bulk student licences (₹200/student). Build on the
   same `circle_locations` + `sos_events` + geofence data; gate to a campus-admin
   role.
3. **★ Safe Walk / Follow Me.** A single trip you share live with your circle OR
   campus security, auto-expiring at arrival (extends the existing Safe Journey).
   The #1 campus-safety feature across every competitor.
4. **Places + arrive alerts.** We alert on leave; add "Arrived at College" too,
   and show saved places (geofences) on the Circle map as labelled areas.
5. **Battery + reliability.** Adaptive cadence (slow when still, fast when moving),
   significant-change updates, a persistent foreground-service notification, and
   surfacing a member's low battery ("Priya · 12% · updated 4m ago"). Battery is
   the #1 reason people uninstall Life360 — win here.
6. **Precision & freshness.** Draw the accuracy circle, hard "updated Xs ago",
   grey out stale pins, and a "request an update" nudge. Campus buyers ask for
   "accurate to ~10 m."
7. **Consent & control.** Per-circle sharing (share with family, not classmates),
   a pause/ghost mode with a clear "you're paused" banner, and an always-visible
   "who can see me" list. Trust is the moat vs Life360's privacy backlash.
8. **Driving / fall / crash detection (later).** Life360's upsell tier; big build,
   post-launch.

## Monetization
- **Plus (students/families):** unlimited history, all zones, the Circle map.
- **★ Campus B2B:** ₹200/student/year bundled, unlocks the control-room dashboard
  for the safety office. That dashboard is the thing a college signs a cheque for.

## Honesty guardrails
- Sharing is opt-in and pausable; never on by default.
- Only your own circles ever see you (RLS).
- Say plainly what's live vs in testing. Location sharing is a v1 first cut until
  proven on real phones (background reliability + battery vary by OEM).

Related: geofencing (sql/41/57/62), Safe Journey, [[project_orbii]].
