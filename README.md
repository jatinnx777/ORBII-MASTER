# ORBII

**Civilian-powered emergency response for India.** Press SOS → nearby ORBII users on the same realtime channel get a hard-vibrating alert with your live location and one-tap "I'll help" navigation. No paid APIs, no per-user infra cost, no enterprise stack — just a pragmatic free-tier MVP that actually works on two phones across a city.

> Status: Android-first. iOS works in dev (`expo run:ios`) but isn't the focus. The signed release APK is built locally via Android Studio's bundled JBR — see [Building the APK](#building-the-apk).

---

## Table of contents

- [What it does](#what-it-does)
- [Architecture at a glance](#architecture-at-a-glance)
- [How the app works on Android (end-to-end flow)](#how-the-app-works-on-android-end-to-end-flow)
- [Why these choices (free-tier constraints)](#why-these-choices-free-tier-constraints)
- [Project structure](#project-structure)
- [Building the APK](#building-the-apk)
- [Local development](#local-development)
- [Configuration](#configuration)
- [Recent changes](#recent-changes)
- [Known limitations](#known-limitations)

---

## What it does

| Feature | Trigger | Delivery |
|---|---|---|
| **SOS broadcast** | Big red button + 5s countdown | Every open ORBII app within Supabase Realtime gets the alert in <1s |
| **Hard-vibration alert** | Receiver sees a new SOS | 3-second buzz pattern (foreground via `Vibration` API, background via notification channel with `bypassDnd`) |
| **Voice SOS** | Saying "help", "bachao", "madad", or variants | Hands-free trigger → countdown → broadcast |
| **Helpers nearby count** | App in foreground | Live presence count of other ORBII users within 5 km |
| **Lock-screen shortcut** | Always present once signed in | Persistent notification with "Send SOS" action button |
| **Live responder tracking** | Responder taps "I'll help" | Their position publishes on `sos-live:{sosId}` channel; victim sees it move on the map (Swiggy-style) |
| **Silent SOS** | Toggle in home screen | Same broadcast, no screen flash, no countdown buzz — discreet for "phone visible to attacker" scenarios |
| **Safe Mode (journey guard)** | User starts a journey | Periodic check-ins; missed check-in escalates to SOS |

---

## Architecture at a glance

```
┌──────────────┐      Supabase Realtime           ┌──────────────┐
│  Phone A     │  ─────────────────────────────▶  │  Phone B     │
│  (victim)    │  broadcast: orbii:alerts          │  (responder) │
│              │  presence:  orbii:presence        │              │
│              │  ◀────────────────────────────   │              │
│              │  per-SOS: sos-live:{sosId}        │              │
└──────────────┘                                   └──────────────┘
       │                                                  │
       │ best-effort write                                │ best-effort read
       ▼                                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│  Supabase (free tier)                                           │
│   - Realtime channels  ← the actual delivery mechanism          │
│   - sos_events         ← history backfill (optional)            │
│   - sos_responders     ← who responded to what                  │
└─────────────────────────────────────────────────────────────────┘
```

**The realtime broadcast is the source of truth during an active emergency.** Database writes are best-effort backfill — if `sos_events` insert fails (RLS, no auth session, network), the alert still reaches every responder because broadcast doesn't depend on the DB. This is why the app works even before any Supabase tables exist.

### Stack

- **React Native 0.81** + **Expo 54** (managed workflow, prebuilt for Android)
- **TypeScript 5.9** strict
- **Redux Toolkit** + **AsyncStorage** for persistence
- **React Navigation 7** (native-stack + bottom-tabs)
- **Supabase** for realtime channels + presence + (optional) Postgres
- **expo-location** for GPS
- **expo-notifications** for the persistent SOS shortcut + alert push
- **expo-speech-recognition** for voice triggers (English + Hindi)
- **expo-haptics** + RN `Vibration` for tactile feedback
- **react-native-webview** + **Leaflet 1.9** + **OpenStreetMap** tiles for the map (zero-cost, no API key)

---

## How the app works on Android (end-to-end flow)

### 1. Cold launch (App.tsx → RootNavigator)

```
App boots
  ├─ Load Poppins + Inter fonts
  ├─ Hydrate Redux from AsyncStorage  (src/redux/persist.ts)
  ├─ prewarmBroadcastChannel()        ← opens the WebSocket immediately
  └─ Mount NavigationContainer
        └─ if !onboarded  →  OnboardingScreen
        └─ if !auth       →  AuthNavigator (phone + OTP, dev mode)
        └─ else           →  AppNavigator
                              ├─ showPinnedSOSShortcut()  ← lock-screen action
                              └─ Tabs (Home / Helpers / History / Profile)
```

Pre-warming the broadcast channel at launch is what makes the **first** SOS a user ever sends fast. Without it, the WebSocket handshake (3–8 s on a cold mobile network) gets paid on the SOS press.

### 2. The victim presses SOS

```
HomeScreen.handleSOSPress
  └─ navigation.navigate('SOSCountdown')
        └─ CountdownScreen (5-second deadline-based clock)
              └─ on deadline:
                    ├─ getCurrentLocation()
                    ├─ getSOSLocation(point)        ← reverse-geocode address
                    ├─ createSOS(profile, location)
                    │     ├─ supabase.from('sos_events').insert(...)   ← best-effort
                    │     └─ broadcastAlert({...})                      ← THE delivery
                    └─ navigation.replace('ActiveSOS')
```

The countdown uses a **`Date.now()` deadline**, not a `setSeconds(s - 1)` counter. This matters because Android background-throttles JS timers when a phone call comes in — a deadline-based clock catches up correctly when the JS engine resumes. If the deadline already passed during the call, SOS fires immediately.

### 3. The responder sees the alert

Every `HomeScreen` mount subscribes to `orbii:alerts`. When a broadcast arrives:

```
subscribeToAlerts callback
  ├─ alertFromBroadcast(broadcast, viewerLocation, myUid)
  ├─ dispatch(alertReceived(alert))           ← Redux store update
  ├─ Haptics.notificationAsync(Warning)       ← instant tactile cue
  ├─ Vibration.vibrate([0,800,200,800,200,800,200,800])  ← 3-sec buzz
  └─ fireLocalNotification(...)               ← push (works in background too)
```

The Redux store update is what drives the UI — the home screen's `nearbyAlerts` selector re-renders, the `AlertsBanner` component slides up + fades in (Animated API), and the badge softly pulses to draw the eye.

If the app is **backgrounded** when the alert arrives, the responder's phone still vibrates because the `'sos'` notification channel has its own `vibrationPattern: [0, 800, 200, 800, 200, 800, 200, 800]` and `bypassDnd: true`.

### 4. Responder taps "I'll help"

```
CommunityAlertsScreen → handleRespond
  ├─ respondToAlert(alertId, {userId, name, photoUri})  ← writes sos_responders row
  ├─ dispatch(incomingJobReceived({...}))                ← populates helper slice
  └─ navigation.replace('HelperNavigation')
        ├─ fetchRoute(origin, destination)               ← OSRM (free, no API key)
        ├─ watchLocation(...)                             ← real GPS stream
        ├─ publishLiveLocation(sosId, responder)          ← per-SOS channel
        │     └─ on every GPS tick: channel.send({point, at})
        └─ OSMMapView with route polyline + animated marker
```

### 5. Victim sees the responder approaching

`ActiveSOSScreen` subscribes to `sos-live:{sosId}` and on every position ping pushes the responder into a `Record<string, LiveResponder>` keyed by responder id. The map paints a green pulsing marker for each one. When the nearest responder is within 40 m the SOS auto-resolves.

### 6. Helpers nearby count

This is the only piece that doesn't rely on the broadcast channel — it uses **Supabase Realtime presence** (`orbii:presence`):

- Every authenticated app calls `joinPresence(self)` on mount with `{userId, name, photoUri, location}`.
- Presence handles join/leave/heartbeat automatically.
- `subscribePresence((peers) => ...)` re-fires on every roster change.
- The home screen filters by haversine distance ≤ 5 km and updates the count (animated count-up via `Animated.Value`).

No DB schema, no RLS, no `helpers_live` table — works the moment two phones open the app.

### 7. Voice triggers

`src/services/voice-detection.ts` wraps `expo-speech-recognition`:

- Continuous listening with `interimResults: true` so we react before the speaker finishes the word.
- Patterns are forgiving and Indian-accent-aware: `bachao`/`bachaao`/`bachhao`, `madad`/`madat`/`madaad`, `mujhe bachao`, `madad karo`.
- Scans **all** STT alternatives (top 3), not just the top one — STT often misses Hindi words on the top guess but gets them right at rank 2.
- Auto-restarts on every `'end'` or recoverable error so the session never silently dies.
- Requires a **dev build** — won't work in Expo Go because `expo-speech-recognition` is a native module.

---

## Why these choices (free-tier constraints)

| Need | Paid option | What we did | Cost |
|---|---|---|---|
| Real-time SOS distribution | Firebase Cloud Messaging + Cloud Functions | Supabase Realtime broadcast | ₹0 |
| Maps | Google Maps SDK (₹ per 1k loads) | Leaflet in WebView + OpenStreetMap tiles | ₹0 |
| Routing | Mapbox / Google Directions | OSRM public router | ₹0 |
| Reverse geocoding | Google Geocoding | Nominatim (OSM) | ₹0 |
| Auth | Firebase Phone Auth | Dev-mode OTP `123456` until launch | ₹0 |
| Push | FCM | `expo-notifications` (works on local/sideload APK without FCM project) | ₹0 |
| State persistence | Firestore | AsyncStorage + redux-persist | ₹0 |

The hosted Supabase free tier covers everything we need: realtime channels, presence, and the optional `sos_events` history table.

---

## Project structure

```
App.tsx                          — entry, font load, prewarm channel, nav root
android/                         — generated by `npx expo prebuild` (committed)
src/
  components/common/             — Button, Input, ScreenContainer, OSMMapView (Leaflet WebView)
  navigation/                    — Auth + App stack + bottom-tabs
  redux/
    store.ts                     — configureStore + typed hooks
    persist.ts                   — AsyncStorage hydration
    slices/
      userSlice.ts               — profile, auth status
      sosSlice.ts                — current location, helpers count, active SOS
      helperSlice.ts             — incoming job, job status
      communitySlice.ts          — live community alerts (merged broadcast + DB)
      appSlice.ts                — onboarded flag, silent SOS, safe-journey state
  screens/
    Onboarding/                  — first-launch screens
    Auth/                        — Phone, OTP, ProfileSetup, IdVerification
    Home/                        — main tab + SOS button + helpers count + alerts banner
    SOS/                         — Countdown, ActiveSOS
    Community/                   — CommunityAlerts (browse + respond)
    Helper/                      — HelperDashboard, HelperNavigation (responder side)
    Helpers/                     — Helpers tab (browse verified helpers)
    History/                     — past incidents + detail
    Notifications/               — in-app notification inbox
    SafeMode/                    — journey-guard flow
  services/
    supabase.ts                  — Supabase client (URL + anon key)
    auth.ts                      — phone OTP (dev mock)
    sos.ts                       — createSOS: DB insert + realtime broadcast
    community.ts                 — broadcast send/subscribe + presence (helpers count)
    live-location.ts             — per-SOS responder position publishing
    location.ts                  — GPS, permission, reverse geocode
    routing.ts                   — OSRM route fetch + step parsing
    helpers.ts                   — DB-backed verified-helper queries (fallback path)
    voice-detection.ts           — expo-speech-recognition wrapper
    notifications.ts             — channels, persistent SOS shortcut, push
    notification-inbox.ts        — local notification history
    analytics.ts                 — event tracking (console + queue)
    storage.ts                   — small key-value helpers
    session.ts                   — session TTL
  theme/                         — colors, typography, spacing, shadows, radius
  types/index.ts                 — shared TS types
  utils/geo.ts                   — haversine, formatDistance, formatEta
supabase/                        — SQL migrations (optional; app works without them)
eas.json                         — EAS Build profiles (cloud build path)
app.json                         — Expo config (permissions, plugins, package name)
```

---

## Building the APK

We build locally via Android Studio's bundled JDK to avoid the EAS free-tier queue (often 30–60 min during peak).

### Prerequisites

- Android Studio installed (provides the JDK at `C:\Program Files\Android\Android Studio\jbr`)
- Android SDK installed (Android Studio installs this automatically)
- Node 20+

### One-time setup

```bash
npm install
npx expo prebuild --platform android --clean   # generates android/ from app.json
```

### Build the release APK

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
cd android
./gradlew assembleRelease --no-daemon
```

Output: `android/app/build/outputs/apk/release/app-release.apk` (~71 MB, signed with the default Expo debug keystore — fine for sideload, replace before Play Store).

Install on a device:

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

Or transfer the APK file directly and tap to install.

### Type-check before building

```bash
npm run typecheck
```

### Cloud build (alternative)

If you want a Play-Store-ready signed APK with a shareable URL:

```bash
npx eas build -p android --profile preview
```

Free-tier queue applies. See `eas.json` for profile config.

---

## Local development

```bash
npm install
npm start          # Expo dev server
```

For a feature that uses native modules (voice detection, notifications, the persistent shortcut), Expo Go won't work — you need a dev build:

```bash
npx expo run:android    # installs a dev client APK on the connected device
```

After that you can `npm start` and the dev client will pick up JS changes via Fast Refresh.

---

## Configuration

### Supabase

Edit `src/services/supabase.ts`:

```ts
const SUPABASE_URL = 'https://<your-project>.supabase.co';
const SUPABASE_ANON_KEY = '<your anon key>';
```

The anon key is enough — we do not require RLS or signed-in users for realtime broadcast/presence. Optional schema for history backfill is in `supabase/`.

### Auth dev mode

In `src/services/auth.ts`, `DEV_AUTH_MODE = true` accepts any 10-digit Indian mobile and OTP `123456`. Flip to `false` once you wire real phone auth (Firebase or Supabase phone OTP).

### Permissions

Declared in `app.json` — fine location, coarse location, camera, photo library, microphone. No background location yet (see [Known limitations](#known-limitations)).

---

## Recent changes

This MVP went through several rounds of fixes after live two-device testing. Major shifts:

### Realtime delivery overhaul (community + presence)

- **Removed broken `profiles!inner` join** in `listNearbyAlerts` — was silently failing because the `profiles` table doesn't exist in our Supabase project. Query now reads only columns on `sos_events` itself.
- **Removed silent 2 km distance filter** in `alertFromBroadcast` — was dropping alerts during testing when phones were >2 km apart. Distance is now computed but never gates delivery; the receiving screen decides what to show.
- **Pre-warmed broadcast channel at app launch** (`prewarmBroadcastChannel()` in App.tsx) so the first SOS a user sends doesn't pay the WebSocket handshake cost.
- **Fast-path `broadcastAlert`** sends immediately if the channel is already SUBSCRIBED, with a cold-path retry loop as a safety net.
- **Helpers count via presence** — replaced the broken `helpers_live` table + `nearest_helpers` RPC dependency with a Supabase Realtime presence channel (`orbii:presence`). Works with anon key, no DB schema.
- **`alertsLoaded` reducer merges instead of replaces** — fixed the bug where the 30 s DB poll was wiping live broadcast alerts ~1 s after they appeared.

### Countdown survives interruptions

- **Deadline-based clock** in `CountdownScreen` — if a phone call comes in mid-countdown, JS timer pauses but the deadline doesn't move. When the app foregrounds, we resume from the deadline; if it already passed, we fire SOS immediately.

### Voice triggers (Indian-accent-aware)

- Patterns now match transliteration variants (`bachao`/`bachaao`/`bachhao`, `madad`/`madat`/`madaad`).
- Reads top-3 STT alternatives instead of only rank 1 — Hindi triggers often live below the (wrong) English top guess.
- Aggressive contextual hints + longer Android silence tolerances.
- Tighter restart loop (250 ms) so a missed segment doesn't gap the next one.

### Hard vibration on alert receive

- Foreground: `Vibration.vibrate([0,800,200,800,200,800,200,800])` (3 s pattern) + `Haptics.notificationAsync(Warning)`.
- Background: `'sos'` notification channel has the same pattern with `bypassDnd: true` and `lockscreenVisibility: PUBLIC`.

### Lock-screen SOS shortcut

- New `'sos-shortcut'` notification channel with `lockscreenVisibility: PUBLIC` and ongoing/sticky behavior.
- Persistent notification posted when the user signs in, dismissed on logout.
- Two action buttons: **"Send SOS"** (deep-links to `SOSCountdown`) and **"I'm safe"** (no-op).
- `Notifications.addNotificationResponseReceivedListener` in App.tsx routes the action via `navigationRef`.

### UI polish

- `AlertsBanner` slides up + fades in; badge softly pulses.
- Helpers count animates between values (`CountUp` component).
- Removed Aadhaar verification gate from the SOS flow until the verification backend is wired.

### Build path

- Switched from EAS cloud build to local Gradle (`./gradlew assembleRelease --no-daemon`) using Android Studio's bundled JBR. Cuts build time from 30–60 min queue to ~3 min local.

---

## Known limitations

- **Voice detection only runs with the screen on / app foregrounded.** True background listening needs an Android foreground service (planned next iteration). The persistent lock-screen shortcut is the safety net.
- **No background location yet.** Live tracking publishes only while the app is foregrounded. Adding `expo-location` background updates requires a foreground service notification too.
- **Phone auth is dev-mocked** (OTP = `123456`). Real Firebase phone auth needs a custom dev client + GoogleService-Info / google-services.json.
- **Aadhaar/PAN verification is stubbed.** Backend not wired; UI exists but the gate is currently bypassed.
- **OSM tile attribution** is required by the OpenStreetMap license — currently rendered in the map's bottom-right. Don't strip it.
- **Default debug keystore** on the local APK — fine for sideload and friend testing, must be replaced with a release keystore before Play Store upload.
