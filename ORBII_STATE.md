# ORBII, State of the Project (source of truth)

A single, current handover doc. Read this first in any new session. It replaces
the old PRD / project-brief docs. Last updated: 2026-08-03.

Founder: Jatin, 19, solo, non-technical, learning to code. App repo: `D:\ORBII`
(React Native / Expo, Android first). Website: `D:\ORBII\website` (Astro, its own
git repo, deploys to orbii.in). Backend: Supabase (Postgres + RLS + edge
functions + realtime), free tier.

## What ORBII is
A women's safety app for India whose thesis is "get rid of the button." She says
"help" out loud and her phone acts, hands-free. Voice listening is on-device;
audio never leaves the phone, never hits a server, is never sold (the anti-Life360
privacy stance). Free for safety; paid for guaranteed verified response.

## The model (current, after E-Cell feedback Aug 2026)
- **Verified-helper dispatch is FREE for everyone.** Free plan = 2 dispatches per
  calendar month. ORBII Plus (₹99/mo) = unlimited + offline extras (offline helper
  alert). Enforced server-side (notify-sos + `try_consume_free_dispatch`, sql/56).
- **Helpers are paid in ORBII coins, never cash from the user.** 10 coins = ₹1.
  200 coins (₹20) per CONFIRMED arrival (tied to arrival-code handshake so it
  can't be farmed). Redeem at 500+ coins (₹50). sql/56.
- **Plus-only features (gated NOW, even in early access):** Disaster mode, ORBII
  Community, and circle safe-zones/geofencing (a circle EXTRA; basic circles stay
  free). Enforced by an ALWAYS_GATED set in entitlements.ts, gated screens render
  `<PremiumLock>`. Everything else stays free during early access.
- **Coupon unlock:** in-app card billing isn't wired, so Plus is unlocked via a
  COUPON at checkout. PremiumUpgrade > "Get ORBII Plus" > CheckoutScreen (coupon
  field). redeem_coupon RPC (sql/59) writes the entitlement server-side. Seed code
  'ORBIIPLUS'. Add codes: `insert into coupons (code, plan_type) values (...)`.
- **Nav:** Missions tab REMOVED from the bottom bar (now 4 tabs: Home, Community,
  Safety, Profile). Responder Missions is a golden row on Profile (below the plan
  card). Missions dashboard shows ORBII coins + the rate (10 coins = ₹1), never
  rupee amounts.
- **University B2B:** college adopts ORBII for every student at ₹200/student/year,
  bundled into the fee like insurance, so it costs the college nothing out of
  pocket. NOTE: the old "10% back to college" giveback was DROPPED, revenue is
  100% ORBII's. (Pitches updated Aug 3.)
- Billing (Play/Razorpay) is NOT wired yet; Plus is unlocked free in early access.

## Feature status
WORKING (real, mostly on-device or proven server path):
- Hands-free Voice SOS (on-device Vosk, EN+HI). Fires on a single confident
  "help". 10s cancelable countdown. On fire: circle live location + nearby-user
  alert + evidence recording.
- Circles, one-tap 112, Community feed (posts/comments/replies + in-app
  notifications), Safe Journey, geofences, ghost mode, deadman switch, safety PIN,
  single-device login.
- Verified responder SYSTEM (apply, KYC, verify, dispatch, staged escalation,
  arrival codes, coins). The CODE is complete; what's missing is real humans in
  the pool (recruit + verify, see below).

BUILT BUT UNTESTED on real hardware (needs a 2-phone test):
- SMS lifeline (SOS over cell signal, data off).
- Offline SOS mesh relay (BLE, sealed end-to-end, bridges via mesh-bridge fn).
- Offline helper alert (location-free BLE ping + RSSI homing, Premium).
- Disaster mode hub (I need help / I'm safe over SMS, helplines, disaster tips).

REMOVED (Aug 3 2026, per founder):
- Bluetooth nearby chat + encrypted 1-to-1 DMs + presence/People-nearby. Deleted
  entirely (screens, mesh-chat/mesh-nearby/mesh-identity services, native CHAT
  channel). The mesh SOS relay and helper alert were KEPT.

PARKED:
- ggwave acoustic SOS (research idea).
- E2EE circle location (future safeguard, E2EE_CIRCLE_SPEC.md).
- iOS.

## Circle geofencing "did you mean to leave?" (Aug 2026)
A circle member sets a zone on another member. On EXIT the fenced person is asked
first (distinct notification channel `geofence-leave` + action buttons). Confirm =
cleared, kept in history. Deny / (optional cron) no-answer = the circle is alerted
via notify-geofence. Files: geofence.ts, notifications.ts, GeofencesScreen,
App.tsx handler. SQL: 57 (authorize/deny/pending), 58 (cron auto-escalate — DONE,
URL+anon key filled in, ready to run; needs pg_cron + pg_net extensions).

**Community Guardian (Path B, built Aug 4):** any user can opt into a
consent-gated "help people nearby" mode (no KYC), reusing helper-mode →
helpers_live as non-verified, so free users' SOS (dispatch_community_helpers)
reaches them. CommunityGuardianScreen + a Profile row for non-responders. No SQL
(set_helper_location is SECURITY DEFINER). Guardrails: explicit consent + code of
conduct + honest note that alerts to unverified guardians carry a location.

**Mesh Phase 2 (Coded PHY long-range) is DONE** in OrbiiMeshService.kt:
boostCapable detection, startExtendedAdvertising on PHY_LE_CODED with a 1M-PHY
fallback, extended scanning. Nothing to build; needs the 2-phone range test. The
mesh FRONTIER (Wi-Fi Aware, helper-sealed exact location) is bigger + crypto-
sensitive and waits until the base mesh is validated on real phones.

## Key file map
- SOS: src/services/sos.ts, src/screens/SOS/*
- Mesh (SOS relay + helper alert): src/services/mesh.ts, mesh-crypto.ts,
  mesh-helper-alert.ts; native android/app/src/main/java/com/orbii/app/mesh/*
- Coins: src/services/coins.ts, src/screens/Responder/CoinsWalletScreen.tsx, sql/56
- Geofence: src/services/geofence.ts, src/screens/Geofence/GeofencesScreen.tsx
- Premium: src/screens/Premium/PremiumUpgradeScreen.tsx
- Responder: src/responder/*, src/services/helper-profile.ts, helper-mode.ts
- Auth: src/services/auth.ts (Supabase email OTP + phone OTP)
- Edge functions: supabase/functions/notify-sos, mesh-bridge, notify-geofence

## Open action items (founder's side)
1. LOGIN: custom SMTP (Brevo) in Supabase so email OTP arrives + Magic Link
   template must use `{{ .Token }}` (a code, not a link). See top priority.
2. Seed verified responders (the correct flow, Aug 3):
   a. ONE-TIME make yourself admin (Supabase SQL editor, runs as superuser):
      `update profiles set role='admin' where email='jaykumar2470f@gmail.com';`
      (Requires sql/27_admin_portal.sql to have been run.)
   b. Your first responders tap Profile > "Become an ORBII Responder" > Apply.
   c. You (admin) open Profile > ADMIN > "Responder approvals" and tap Approve.
      That calls admin_approve_responder, which sets ALL three flags at once
      (role='responder', is_verified=true, helper_profiles.verification_status=
      'verified') so a responder is never left half-verified. AdminRespondersScreen
      + src/services/admin.ts. Do NOT hand-edit the flags in SQL anymore.
   d. The approved responder opens the Missions tab and goes online to be
      dispatchable. Their role now refreshes on app launch/resume (refreshUserRole
      wired in App.tsx), no re-login needed.
3. Patent: file a provisional patent early to protect the hands-free + on-device +
   offline-mesh idea before showing it widely. (In the ₹2.5L funds line.)
4. Deploy notify-sos (`supabase functions deploy notify-sos`) once responders
   exist, so the free 2/month dispatch takes effect. Not urgent until then.
5. 2-phone mesh test: deploy mesh-bridge + set secret MESH_SECRET_KEY, then test.

## SQL migrations (run in number order for a fresh DB)
Latest applied: through 57 (56+57 run Aug 3). Newest: 56 (coins), 57 (geofence
authorize), 58 (OPTIONAL geofence auto-escalate cron). Check state anytime with
`sql/55_whats_missing.sql` (read-only; zero rows = fully migrated).

## Build
- APK: `$env:JAVA_HOME='C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot';
  cd android; .\gradlew.bat assembleRelease --console=plain`. Never `gradlew clean`.
  Output: android/app/build/outputs/apk/release/app-release.apk. Bump versionCode +
  versionName in android/app/build.gradle each build.
- Website: `cd website; npx astro build`.
- Typecheck: `npx tsc --noEmit`.

## Working rules (important)
- Honesty first: never claim untested features as proven/live; no fabricated
  stats or "firsts"; on a safety app, under-claim. No em dashes in any copy.
- Commit to the correct repo (app vs website are separate git repos). Local
  commits only unless asked to push; pushing the website deploys it.
- Pitches: PITCH.md (investor/stage), UNIVERSITY_PITCH.md (full), CLOSED_ROOM_PITCH.md
  (the one Jatin is using). Fill [YOUR WHY] / [YOUR BACKING] / [CAMPUS SIZE].
