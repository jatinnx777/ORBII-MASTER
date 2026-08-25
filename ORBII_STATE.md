# ORBII, state of the project (source of truth)

Single handover doc. Read this first in any new session. Last updated **19 Aug 2026**.

Founder: **Jatin**, 19, solo, non-technical, learning to code.

Three repos, three separate git histories. Do not cross-commit.

| What | Path | Notes |
|---|---|---|
| Main app | `D:\ORBII` | React Native / Expo 54, Android first |
| Website | `D:\ORBII\website` | Astro, its own git repo, deploys to orbii.in on push |
| Helper app | `D:\ORBII-HELPER` | Separate app, `in.orbii.helper`, shares the Supabase project |

Backend: one Supabase project (`henbkyjefhzmxqozlczd`), Postgres + RLS + edge
functions + realtime, free tier. Both apps use it.

---

## 1. What ORBII is

A women's safety app for India whose thesis is **get rid of the button**. She says
"help" out loud and the phone acts, hands-free. Voice listening runs on-device;
audio never leaves the phone, never hits a server, is never sold. That is the
anti-Life360 stance and it is the product's spine, not marketing.

Free for safety. Paid for guaranteed verified response.

---

## 2. Commercial model

- **Verified-helper dispatch is FREE for everyone.** Free plan = 2 dispatches per
  calendar month. ORBII Plus (₹99/mo) = unlimited plus offline extras. Enforced
  server-side in `notify-sos` + `try_consume_free_dispatch` (sql/56).
- **Helpers are paid in ORBII coins, never cash from the user.** 10 coins = ₹1.
  200 coins (₹20) per **confirmed arrival**, tied to the arrival-code handshake
  so it cannot be farmed. Redeem at 500+ coins. sql/56.
- **Plus-only right now:** Disaster mode, ORBII Community, circle safe-zones /
  geofencing. `ALWAYS_GATED` set in `entitlements.ts`; gated screens render
  `<PremiumLock>`. Everything else is free during early access.
- **Coupon unlock.** Card billing is not wired. Plus is unlocked with a coupon at
  checkout: PremiumUpgrade → "Get ORBII Plus" → CheckoutScreen. `redeem_coupon`
  RPC (sql/59) writes the entitlement server-side. Seed code `ORBIIPLUS`.
  Add more: `insert into coupons (code, plan_type) values (...)`.
- **University B2B:** ₹200/student/year, bundled into the fee like insurance so
  it costs the college nothing out of pocket. The old "10% back to the college"
  giveback was **dropped**; revenue is 100% ORBII's.
- **Hard rule: student licences only.** No dashboard, no data access, no reports
  for the college. ORBII never sells or hands over user data, to a college or to
  anyone. This is not negotiable and it is a selling point, not a limitation.
- Billing (Play / Razorpay) is **not** wired. `create-order` and `verify-payment`
  edge functions exist and are deployed but the flow has never processed money.

---

## 3. Feature status, honestly

### Working (real, on-device or a proven server path)
- Hands-free Voice SOS. On-device Vosk, English + Hindi, both models bundled in
  the APK (this is why it is ~138 MB). Fires on a single confident "help".
  10-second cancelable countdown. On fire: circle live location + nearby-user
  alert + evidence recording.
- Circles, one-tap 112, Community feed (posts / comments / replies + in-app
  notifications), Safe Journey, geofences, ghost mode, deadman switch, safety
  PIN, single-device login.
- Location history timeline, half-screen SOS map, place presets.
- Age gate and under-18 tracking block (DPDP Rule 10).
- Verified responder **system** end to end in code: apply, KYC, verify, dispatch,
  staged escalation, arrival codes, coins. What is missing is **real humans in
  the pool**.

### Built but never tested on real hardware (needs two physical phones)
- SMS lifeline (SOS over cell signal with data off).
- Offline SOS mesh relay (BLE, sealed end to end, bridges via `mesh-bridge`).
- Offline helper alert (location-free BLE ping + RSSI homing, Plus only).
- Disaster mode hub (I need help / I'm safe over SMS, helplines, tips).
- Mesh Phase 2, Coded PHY long range, is **code-complete** in
  `OrbiiMeshService.kt`: `boostCapable` detection, `startExtendedAdvertising` on
  `PHY_LE_CODED` with a 1M-PHY fallback, extended scanning. Needs a range test.

**Never describe anything in the second list as working.** On a safety app,
under-claim. This has already caused one website rewrite.

### Removed (3 Aug 2026, founder's call)
Bluetooth nearby chat, encrypted 1-to-1 DMs, presence / people-nearby. Deleted
entirely: screens, `mesh-chat` / `mesh-nearby` / `mesh-identity` services, native
CHAT channel. **The mesh SOS relay and helper alert were kept.**

### Parked
ggwave acoustic SOS (research), E2EE circle location (`E2EE_CIRCLE_SPEC.md`), iOS.

---

## 4. Design system (v32, "warm editorial")

`src/theme/colors.ts` is the single source. Nothing brand-related is hardcoded in
a screen; always reference a token. Retinting that file restyles the whole app.

| Token | Hex | Use |
|---|---|---|
| cream | `#FAF9EC` | the ground. Warm ivory, never grey, never white |
| creamDeep | `#F3F0DF` | pressed / alt surface / tint band |
| ink | `#17161C` | near-black text, dark editorial bands |
| lavender (`brand`, `peach`) | `#8672CE` | the one accent, CTAs, links, emphasis |
| coral | `#EF605E` | SOS and danger **only**, never anything calm |
| gold | `#D6A64F` | premium (ORBII Plus) and highlights |
| sage | `#4FA383` | all-clear, verified, confirmed |

The palette is shared with the website deliberately, so orbii.in and the phone
look like one company.

**Note:** an earlier rebrand (v27, Jun 2026) went mint green → cream/peach with a
yellow egg mascot (`assets/mascot/*.png`). v32 then moved the accent to lavender.
`PRD.md` §4 describes the old mint palette and is **outdated**.

Home screen anatomy, worth knowing because the Helper app copies it: a MapLibre
map fills the top ~55%, floating glass controls ride over it, and a draggable
bottom sheet carries everything else.

Tabs: **Home, Community, Emergency, Profile** (`TabNavigator.tsx`). The Missions
tab was removed; Responder Missions is a golden row on Profile.

---

## 5. Architecture

### Stack
Expo 54 / RN 0.81.5 / TypeScript. Redux for user + community slices. React
Navigation (`AppNavigator`, `AuthNavigator`, `TabNavigator`).

**Version pinning matters.** `react` and `react-native` must be pinned exact.
A `^19.1.0` range let npm resolve react 19.2.8 against RN's renderer 19.1.4 and
the Helper app died on the JS thread. Always install Expo packages with
`npx expo install`, never plain `npm i`, or you get SDK 57 packages in an SDK 54
project (this broke `expo-device`, then `expo-font`). `npx expo-doctor` catches
both.

### Native Kotlin modules (`android/app/src/main/java/com/orbii/app/`)
| File | Job |
|---|---|
| `VoiceGuardService.kt` / `VoiceGuardModule.kt` | on-device Vosk keyword spotting, foreground service |
| `ScreamDetector.kt` | YAMNet scream classification |
| `PreRollBuffer.kt` | keeps audio from *before* the trigger |
| `VoiceDenoiser.kt` | pre-processing |
| `VoiceModelDownloader.kt` | model management |
| `OrbiiMeshService.kt` / `OrbiiMeshModule.kt` | BLE mesh SOS relay |
| `OrbiiSmsModule.kt` | SMS lifeline |
| `HelperOverlayModule.kt` | full-screen alert over other apps, `TYPE_APPLICATION_OVERLAY`, red edge glow |
| `BootReceiver.kt` | re-arm after reboot |

`VoiceGuardModule.kt:283` handles the Android 14 full-screen-intent revoke path.

### Edge functions (`supabase/functions/`)
`notify-sos`, `escalate-sos`, `mesh-bridge`, `notify-geofence`,
`notify-location-share`, `notify-sharing-off`, `score-community`,
`publish-blog`, `create-order`, `verify-payment`.

All ten are deployed. Six of them were **written but never deployed** for a long
time, including `mesh-bridge` (so the BLE mesh had nowhere to deliver) and the
two payment functions. If something backend-ish does not work, check it is
actually deployed before debugging the code.

`supabase-js` returns a thenable builder, not a Promise. `admin.rpc(...).catch()`
throws `TypeError: not a function`. This crashed `score-community` and was only
caught by invoking the deployed function.

### SQL (`sql/`, 80 files, run in number order)
Notable ones:

| File | What |
|---|---|
| 21 | `sos_events_nearby` |
| 23 | `helper_profiles` |
| 26 | premium helper gate, adds `circle_only` |
| 27 | admin portal + `is_admin()` |
| 38 | `dispatch_verified_helpers` |
| 46 | `dispatch_community_helpers` |
| 56 | coins, `submit_arrival_code`, `try_consume_free_dispatch` |
| 59 | `redeem_coupon` |
| 65 | DPDP |
| 71 | Voice Quests storage (**not yet run**) |
| 73 | midnight wipe |
| 76 | community bridging |
| 77 | BDSM integrity |
| 78 | SOS escalation waves |

`sql/55_whats_missing.sql` is read-only; zero rows means fully migrated.

**Postgres gotchas that have bitten:** changing a function's return type needs
`drop function if exists` first (42P13), and if the last statement of a script
fails, the SQL editor rolls back the whole script, so earlier `create table`s
silently never happened. plpgsql takes **one** `declare` section per function,
not one per variable.

---

## 6. Algorithms worth knowing

### Community bridging (sql/76, `src/algorithms/bridging.ts`)
X's Community Notes matrix factorisation: `r̂_un = μ + i_u + i_n + f_u · f_n`,
λ_i = 0.15, λ_f = 0.03. A post ranks high only if people who usually **disagree**
both rate it well. Factor bound tightened to 0.25 (X publishes 0.50, calibrated
for millions of raters; we have far fewer).

**It silently failed at first.** Factors initialised at ±0.03 never escaped their
own gradient, so the model collapsed to a weighted average and "bridging" did
nothing. Fixed: init ±0.4, epochs 300 → 1000. The **factor** catches brigading,
not the intercept: a post with 8 same-camp ratings legitimately earns a higher
intercept because there is more evidence.

### BDSM (sql/77)
X's inauthentic-behaviour model (github.com/xai-org/x-algorithm): bidirectional
transformer, time-aware RoPE, 8 task heads, min-actions gate. `cadence_cv`, the
coefficient of variation of gaps between actions, is the load-bearing feature.
`bdsm_score_all()` originally called `bdsm_overlap()` once per user inside a loop,
an O(n²) self-join; hoisted into a temp table.

### SOS escalation (sql/78)
Five waves. A wave of 3 helpers → arrival proven by code → 90s grace → ask the
victim → 45s → next wave. Only an entered arrival code stops it. Accepting a
dispatch does not.

---

## 7. The Helper app (`D:\ORBII-HELPER`)

A separate app because the two products have **opposite privacy postures**.

| | ORBII | ORBII Helpers |
|---|---|---|
| Identity | pseudonymous is fine | verified, real name, government ID |
| Location | hers, guarded, opt-in, wiped nightly | theirs, continuous while on duty, that *is* the job |
| Data held | as little as possible | enough to be accountable for a rescue |

One binary would mean one Data Safety declaration and a permission set that is
the union of both, which is exactly the "safety app that tracks you" people are
right to distrust.

Package `in.orbii.helper`. Same Expo/RN versions, same palette file copied
verbatim, same MapLibre style, so both apps look like one company. Green leads
in the Helper app (it is the logo and ORBII already uses green for on-duty and
confirmed); coral stays reserved for an actual emergency.

Screens: SignIn, ProfileStep, Onboarding (document checklist), TrainingStep,
Duty (map + GO button + sheet), IncomingRequest (full-screen takeover),
ArrivalCodeModal, Wallet, AdminReview.

Its own SQL lives in `D:\ORBII-HELPER\sql\`: 01 onboarding, 02 admin + arrival
verification, 03 dispatch diagnostics + the bridge below.

### The bridge between the two helper systems
ORBII's dispatch reads `helper_profiles.verification_status = 'verified'`.
The Helper app writes `helper_applications.status = 'approved'`. These are
different tables, so approved helpers were being dispatched as ordinary
bystanders and never got the verified push. `admin_approve_helper` now writes
**both**, and rejection unwinds it. Do not break this.

### Why a helper sees no emergencies
`sos_events_nearby` excludes `e.user_id <> auth.uid()`. **Testing both apps on
one login shows nothing, forever, from any location.** Use two accounts.
Other causes: no GPS fix, `circle_only`, further than the radius, older than
15 minutes. `helper_dispatch_debug` (sql/03) distinguishes them.

---

## 8. Working rules (these matter more than the code)

- **Honesty first.** Never claim untested features as proven or live. No
  fabricated stats, no "India's first". On a safety app, under-claim.
- **No em dashes.** Anywhere. Chat, code comments, website copy, pitch decks.
  Use commas, periods, or parentheses.
- **Never sell or hand over user data.** Not to colleges, not to anyone.
- **A failure must never look like the good state.** This is the recurring bug
  class in this project: an admin queue stuck on "Loading" looks like an empty
  queue; a helper screen saying "All quiet" looks the same whether nobody needs
  help or the app is broken. Always return a reason and render it.
- Commit to the correct repo. Local commits only unless asked to push. Pushing
  the website **deploys** it.
- Long commit messages via a scratchpad file and `git commit -F`.

---

## 9. Build and deploy

```powershell
# APK
$env:JAVA_HOME='C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot'
cd android; .\gradlew.bat assembleRelease --console=plain
```

- **Never `gradlew clean`.**
- Never run the ORBII and Helper builds at the same time. They share
  `C:\Users\jatin\.gradle\caches` and a stale daemon deadlocks on the journal
  lock.
- Bump `versionCode` **and** `versionName` in `android/app/build.gradle` each
  build. Currently `26.5.7` / `26696`, package `com.orbii.app`.
- arm64-only for shipping. The Windows emulator is x86_64 and RN 0.81's
  `libreactnative.so` does not survive arm translation, so add
  `-PreactNativeArchitectures=arm64-v8a,x86_64` for emulator testing.
- Output: `android/app/build/outputs/apk/release/app-release.apk`. Copy finished
  builds to `C:\Users\jatin\Downloads`.
- Website: `cd website; npm run build`. Typecheck: `npx tsc --noEmit`.
- Tests: `npx vitest run`. 27 tests across `consent`, `circle-location`,
  `bridging`. React Native's Flow syntax breaks Rollup, so the config uses alias
  stubs.

---

## 10. Open items

**Founder's side**
1. **Login:** custom SMTP (Brevo) in Supabase so email OTP actually arrives. The
   Magic Link template must use `{{ .Token }}`, a code, not a link. The Brevo key
   is a real secret; the Supabase anon key is public by design and RLS-gated.
2. **Seed verified responders.** One-time, make yourself admin in the Supabase
   SQL editor: `update profiles set role='admin' where email='jaykumar2470f@gmail.com';`
   (needs sql/27). Then approve applicants through the admin portal, which sets
   all three flags at once. Do not hand-edit the flags.
3. Run `sql/79_backend_hardening.sql` (app) and `D:\ORBII-HELPER\sql\03_dispatch_debug.sql`.
   Verified applied against the live project on 22 Aug: sql/71 (`voice_samples`
   exists), helper sql/01 and sql/02. Verified NOT applied: sql/79
   (`push_outbox`, `rate_ok` missing), helper sql/03 (`helper_dispatch_debug`
   missing).
4. Play **Data Safety** declaration before any AAB upload: audio, location, date
   of birth. Plus a separate declaration for `in.orbii.helper`.
5. File a provisional patent on hands-free + on-device + offline-mesh before
   showing it widely.
6. Two-phone mesh test: deploy `mesh-bridge`, set `MESH_SECRET_KEY`, then test.

**Engineering**
- Full-screen notification for an incoming SOS in the Helper app (the main app
  already declares `USE_FULL_SCREEN_INTENT` and handles the Android 14 revoke
  path; needs porting).
- Road-distance re-ranking of top candidates. Everything is straight-line PostGIS
  today, which understates distance across a river or a railway line.
- iOS. Nothing exists.

---

## 11. Traction and positioning

- **Voted #1 Product of the Week** on Smol, a global builder platform: 43 votes,
  4.8★, first of 48 launches, by a wide margin.
- Positioning against Life360 is on privacy, and it has to stay honest: ORBII now
  does have continuous location sharing inside a circle, so the argument is about
  **consent, visibility and deletion**, not about never having the capability.
  The blog post on this was rewritten once for exactly that reason.
- Pitch decks in `pitch/`: `PITCH.md` (investor), `UNIVERSITY_PITCH.md` (full),
  `CLOSED_ROOM_PITCH.md` (the one Jatin actually uses). Placeholders
  `[YOUR WHY]`, `[YOUR BACKING]`, `[CAMPUS SIZE]` still need filling.

---

## 12. Other docs in this repo

| File | Keep because |
|---|---|
| `AGENTS.md` | accessibility rules, a hard constraint for any UI work |
| `MIGRATION.md` | SQL migration ledger |
| `DEPLOY.md`, `INSTALL.md`, `PUSH_SETUP.md` | deployment runbooks |
| `PLAY_CONSOLE_ANSWERS.md`, `PLAY_STORE_PERMISSIONS.md`, `PLAY_STORE_SUBMISSION.md` | Play submission answers, needed at every release |
| `PRIVACY_POLICY.md` | the source the website policy is generated from |
| `MESH_SPEC.md`, `OFFLINE_HELPER_ALERT_SPEC.md`, `E2EE_CIRCLE_SPEC.md`, `CIRCLE_MAP_SPEC.md` | specs for unfinished or parked work |
| `HELPER_APP.md` | the reasoning behind the app split |
| `FUNDING_TECH.md`, `pitch/*` | fundraising |
| `ml/MODEL_BRIEF.md`, `ORBII-DATASHEET/*` | the voice model work |
