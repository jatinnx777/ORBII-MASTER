# ORBII — PRD + State of the Project

A handover document. Paste this into a new chat at the start of a session so the assistant has everything in one place.

---

## 1. What ORBII is

**ORBII** is a women-first personal safety app for India. The product promise: *"I have a guardian protecting me."* Calm, soft, Apple-quality polish — not corporate, not cybersecurity, not government. Built around three primitives:

1. **Circles** — small groups of trusted people who can see each other's live safety status (Family, College, Trip, etc.). Modeled on Life360 but explicitly *not* a social network.
2. **SOS** — a single button (or shake, or voice keyword) that broadcasts your live location to your circle, your emergency contacts, and gives you a one-tap escalation to 112 (India's universal emergency line).
3. **Safe Journey / Watch over me** — tell ORBII when you'll arrive somewhere; if you don't confirm by ETA, your circle is alerted and SOS auto-fires.

### Founder + constraints

- **Founder:** Jatin Kumar, 19, non-technical, learning to code by shipping ORBII.
- **Budget:** ₹0. Everything runs on free tiers (Supabase free, Carto map tiles, no paid SMS gateway, no Picovoice license).
- **Engineering style:** working > perfect, free > paid, simple > complex. Safety-critical paths get the most attention; everything else can be MVP.

---

## 2. Tech stack (current)

> **Not Flutter.** Any prior description that mentioned Flutter, Riverpod, or `.dart` is wrong — this is a React Native app.

| Layer | Choice |
|---|---|
| Mobile framework | React Native 0.81.5 (Expo SDK 54, bare workflow with manual `android/` folder) |
| Language | TypeScript (strict mode) |
| State | Redux Toolkit + react-redux (NOT Zustand) |
| Navigation | React Navigation native-stack + bottom-tabs |
| Backend | Supabase (Postgres + Realtime + Auth + Storage) |
| Auth | Google OAuth (PKCE flow, real) + Phone OTP bypass (`TEST_OTP_BYPASS = true`, code `123456`) |
| Map | MapLibre GL Native with Carto Voyager basemap (free, no key) |
| Routing | OSRM public instance |
| i18n | i18next + react-i18next |
| Animations | React Native Animated (no Reanimated yet) |
| Native modules | None custom right now (the Picovoice wake-word + AccessibilityService modules were cut) |
| Secure storage | `expo-secure-store` via a hybrid adapter (keys prefixed `sb-` or `orbii:secure:` route to Keystore) |
| Audio recording | `expo-audio` (via `useAudioRecorder` hook) |
| Sensors | `expo-sensors` (Accelerometer for shake) |
| Battery | `expo-battery` |
| Files | `expo-file-system` |
| Notifications | `expo-notifications` (lock-screen widget, persistent SOS shortcut, voice-wake) |
| Build | Gradle assembleRelease, ARM64 + x86_64 only (armeabi-v7a + x86 dropped due to NDK 27 linker bug) |
| Version | `versionCode 26527` / `versionName "26.5.17"` (last build at time of writing) |

---

## 3. Folder layout (high level)

```
d:\ORBII\
├── App.tsx                     # Root: hooks, providers, navigation container, global listeners
├── android/                    # Bare-workflow Android project (manual)
├── sql/                        # SQL migrations to paste into Supabase SQL Editor
│   ├── 01_friend_system.sql    # users_public + (legacy) messages
│   ├── 03_sos_events.sql       # SOS history table
│   ├── 06_reset_profile_tables.sql
│   ├── 08_friends_tables.sql   # (legacy — friend graph still backed by these)
│   ├── 09_circles.sql          # Circles foundation (tables + RLS + trigger)
│   ├── 10_circles_rls_fix.sql  # RLS hotfix: TO authenticated + phone column on users_public
│   └── 11_sos_audio.sql        # audio_path column + sos-recordings bucket + RLS
├── web/                        # Static landing pages for orbii.app
│   ├── README.md               # Deploy instructions (Cloudflare/Vercel/GitHub Pages)
│   └── join/index.html         # /join/<token> → deep-link to app, fallback to Play Store
├── src/
│   ├── components/common/      # Reusable UI primitives
│   ├── hooks/                  # useNotificationsBadge, useSafetyTips
│   ├── i18n/                   # locales (en + hi populated; pa/ta/bn stub)
│   ├── navigation/             # AuthNavigator, AppNavigator, TabNavigator, types
│   ├── redux/                  # store + slices + persist
│   ├── screens/                # One folder per feature
│   ├── services/               # Pure logic + side-effect modules
│   ├── theme/                  # colors, spacing, radius, shadows, typography
│   ├── types/                  # Shared TS types
│   └── utils/                  # validation, geo helpers
└── PRD.md                      # This file
```

---

## 4. Design system

Single-brand mint palette. Red **only** for SOS/emergency UI. Borders are near-invisible (`rgba(0,0,0,0.05)`) so cards feel lifted, not line-art.

```ts
// src/theme/colors.ts
brand:       '#57C691'   // official ORBII mint, default for everything calm
brandSoft:   '#E2F4EB'   // wash for tinted card backgrounds
brandMid:    '#AEE8CC'   // secondary mint accent
brandDeep:   '#1E8E5A'   // CTA / pressed accent
primary:     '#FF4D4D'   // SOS only
success:     '#57C691'   // identical to `brand` — single colour everywhere
error:       '#FF4D4D'
textPrimary: '#111827'
textSecondary: '#6B7280'
textMuted:   '#9CA3AF'
background:  '#F7FAF8'
surface:     '#FFFFFF'
border:      'rgba(0,0,0,0.05)'
```

```ts
// src/theme/spacing.ts
radius.sm = 8   radius.md = 14   radius.lg = 24   radius.xl = 28
shadows.card = { offset: (0,4), opacity: 0.06, radius: 14, elevation: 3 } // soft diffuse
shadows.sheet = { offset: (0,-2), opacity: 0.07, radius: 18, elevation: 6 }
shadows.hero  = { offset: (0,8),  opacity: 0.10, radius: 22, elevation: 6 }
```

**Hard rules**
- Never introduce a new green — use `brand` (or `success`, which is the same value).
- Never use red for non-emergency UI.
- Cards at rest = `radius.lg` (24px) + `shadows.card`. Bottom sheets = `radius.xl` (28px) + `shadows.sheet`.

---

## 5. Features — what's IN

### 5.1 Authentication
- **Google OAuth** via Supabase PKCE flow, real session. Redirect URI `orbii://auth/callback`.
- **Phone OTP test bypass** (`TEST_OTP_BYPASS = true`, code `123456` in `src/services/auth.ts`). Creates a local-only profile with no real Supabase session, so server-backed features (circles, friends, audio upload) will fail or short-circuit for these users with a clear message.
- **Profile setup** runs as a 4-step wizard after sign-in (identity → photo → phone → first emergency contact). New users land on Home with at least one contact already in state — fixes the common dead-button activation gap.

### 5.2 Circles (the core social primitive)
- SQL tables: `circles`, `circle_members`, `circle_invites`, `circle_events`, `shared_trips`. All RLS-scoped to `authenticated`, `is_circle_member()` helper function for member checks.
- Service: `src/services/circles.ts` (create, list, leave, delete, invite by username, invite by phone, accept by token, etc.) + `circles-bootstrap.ts` (hydrate + refresh + active-circle persistence).
- Redux slice: `src/redux/slices/circlesSlice.ts` with `setupNeeded` flag — the screen surfaces a friendly *"paste sql/09_circles.sql into Supabase"* card when the tables don't exist.
- Screens: **CirclesScreen** (tab), **CircleDetailScreen**, **CircleCreateScreen**, **CircleInviteScreen** (phone-number-first search via `users_public.phone`).
- Aesthetics: animated `CirclesHero` empty state (breathing mint rings, floating member-kind chips, no Lottie — pure RN Animated).
- Home header: `CircleSelectorPill` (active circle + dropdown sheet, "Create" + "See all" footer).
- Deep-link join: `orbii://join/<token>` and `https://orbii.app/join/<token>` both accepted; handler in `App.tsx` claims the invite + routes to the circle.

### 5.3 SOS pipeline
- **Manual** — hold the Home shield (long-press for instant) → `CountdownScreen` (5 s cancel window) → `ActiveSOSScreen`.
- **Voice** — fully offline, on-device. Bundled Vosk models (English + Hindi, in `android/app/src/main/assets/vosk-model-en|hi`) run inside the native `VoiceGuardService` foreground service. No speech API, no network, nothing downloaded. Built-in keywords: "help", "save me", "bachao"/"बचाओ", "madad"/"मदद" + the user's custom phrases. In-app toggle and always-on background protection are the same engine; a trigger fires the `orbii://voice-sos` deep link, quota-gated for free tier in `App.tsx`.
- **Shake** — `expo-sensors` Accelerometer; 3 hard shakes (1.8 g spikes) within 1.5 s → countdown. Default ON. Toggle in Settings → Emergency triggers. Currently foreground-only.
- **Hardware (volume triple-press)** — **CUT.** AccessibilityService removed alongside the helper system.

**On real (non-test) SOS fire:**
1. `broadcastAlert` → Supabase realtime channel `orbii:alerts` (every authenticated app hears it).
2. `broadcastSOSViaWhatsApp` → opens `whatsapp://send?phone=…` per emergency contact, falls back to `wa.me`. India distribution killer feature.
3. `useSOSRecorder` (in ActiveSOSScreen) → starts 60 s `expo-audio` capture, uploads to private `sos-recordings` Supabase bucket at `<userId>/<sosId>.m4a`, attaches `audio_path` to the `sos_events` row.
4. Local notification fires on every nearby circle phone with the danger channel.

**Active SOS screen has:**
- Always-visible red **"Call 112 (Emergency)"** button under the status banner.
- **Auto-escalation prompt** at 90 s if no responder accepted: *"No response yet — call 112?"*
- **PIN guard** on Cancel: if user set a Safety PIN, dismissing the SOS requires it. PIN is FNV-1a hashed and stored in Android Keystore via SecureStore.

### 5.4 Safe Journey / Watch over me
- Three flows under one Safety-tab section titled "Watch over me":
  - **Safe Journey** (free) — destination + ETA, alerts on overdue.
  - **Ghost Mode** (premium) — silent live trip, no alarm unless you go missing.
  - **Deadman Timer** (premium) — countdown, fires SOS if not dismissed.
- **Lock-screen widget** — persistent low-importance notification (Android channel `safe-journey`), re-posted every 60 s with live ETA + minutes remaining. Two actions: **"I'm safe"** (PIN-guarded if set) and **"+15 min"** (extends without unlock). Bare tap opens `SafeJourneyActive`.

### 5.5 Battery-aware mode
- `src/services/battery-aware.ts` + `<BatteryWarning>` banner mounted at the top of Home's bottom panel.
- Below 20% AND unplugged → soft danger banner.
- Ambient 30 s helpers refresh gates with `shouldDampenWork()` so it skips ticks when low; SOS critical path never dampens.

### 5.6 Other screens still in
| Screen | Purpose |
|---|---|
| `Home` | Map + circle selector + bottom sheet (status, SOS + Voice cards, alerts strip, safety tip card) |
| `Safety` | "Watch over me", Digital Safety, Personal Safety, Intelligence, System Status sections |
| `Settings` | Profile, Emergency triggers (Shake + PIN + Practice), Privacy, Circles, Preferences, About, Plans, Sign out |
| `Notifications` | AsyncStorage-backed inbox (10 s poll for badge) |
| `EmergencyContacts` + `ContactForm` | CRUD over `emergency_contacts` table |
| `EditProfile` | Single-page edit |
| `Profile` | Hero card + sections (avatar, sos count, contacts) |
| `Premium` | Plans tab — UI only, no Razorpay/UPI yet |
| `Friends` | Legacy friend-graph UI (kept for now, but chat removed) |
| `SOSCountdown` + `ActiveSOSScreen` + `ResolvedModal` | Full SOS flow |
| `History` + `IncidentDetail` | SOS history |
| `Onboarding` | Pre-auth carousel (legacy single-page) |
| `Welcome` + `Login` + `PhoneSignIn` + `PhoneVerify` + `LanguageSelector` + `ProfileSetup` | Auth flow |
| `Circles` + `CircleDetail` + `CircleCreate` + `CircleInvite` | Circles feature |
| `SafeJourneyStart` + `SafeJourneyActive` | Safe Journey |
| `GhostStart` + `GhostActive` | Ghost Mode |
| `DeadmanStart` + `DeadmanActive` | Deadman Timer |
| `CommunityAlerts` | Nearby SOS broadcasts (now circle-scoped, helper-respond path simplified) |
| `OEMHelp` | Android OEM autostart walkthrough |
| `SafetyPin` | Set / change / remove the 4-digit cancel PIN |
| `About` | Legal + version |

---

## 6. Features — what's CUT (and why)

| Cut | Reason |
|---|---|
| Helper gig economy (HelperVerification, HelperDashboard, AcceptSOS, HelperNavigation, Withdraw, IdVerification) | Separate product. Needs KYC + payments + dispatch + moderation. At 0 budget, can't ship. ~30% codebase reduction. |
| Standalone friends graph in user-facing UI | Circles is the trust primitive now. `friends` table still exists in DB but the Friends screen is in maintenance mode. |
| Friend-to-friend chat (ChatThreadScreen, SupportChatScreen, `messages` table consumption) | Slack-in-a-safety-app made no sense. |
| Hardware triple-press SOS + native Kotlin AccessibilityService | Discoverability ~0%. Scary install-time permission. |
| Background Voice SOS wake-word stack (Picovoice, `OrbiiVoiceService.kt`, `WakeWordProvider`, `src/services/wake-word/`, `VoiceSetupScreen`) | Required paid Picovoice key; foreground-only voice is enough for MVP. |
| `community_alerts` strangers respond flow | Replaced with circle-only response. Helper navigation route removed. |
| Legacy theme aliases (`primaryDeep`, `accent`, `surfaceMuted`, `darkSoft`) | Still in `colors.ts` for back-compat but all resolve to brand mint. |
| `voiceDetection`, `backgroundVoice`, `hardwareSOS` settings flags | Removed from `appSlice`, `persist.ts`, `storage.ts`. |
| `HelperState`, `HelperJob`, `HelperJobStatus`, `HelperVerificationStatus`, `IdDocumentKind`, `IsHelper`/`idVerification`/`idKind`/`idNumber`/`idPhotoUri` fields on `UserProfile` | Cleaned from `src/types/index.ts`. `HelperSummary` renamed to `Responder`; `SOSRecord.helpers` → `SOSRecord.responders` everywhere. |

---

## 7. SQL migrations — order of operations

User pastes these into Supabase SQL Editor and runs them once each. Order matters.

1. `sql/01_friend_system.sql` — `users_public` directory + (legacy) `messages` table.
2. `sql/03_sos_events.sql` — SOS history.
3. `sql/06_reset_profile_tables.sql` — profile schema (run once, destructive on tables, idempotent if you already ran it).
4. `sql/08_friends_tables.sql` — friend graph tables.
5. **`sql/09_circles.sql`** — circles foundation (tables + initial RLS + trigger).
6. **`sql/10_circles_rls_fix.sql`** — re-applies RLS with `TO authenticated`, adds `users_public.phone` for phone-search invite. Run this AFTER 09.
7. **`sql/11_sos_audio.sql`** — adds `sos_events.audio_path`, creates the private `sos-recordings` Storage bucket, applies owner-only RLS.

If the user hits *"new row violates row-level security policy for table circles"* — they haven't run 10. The client now detects this and shows a friendly setup card.

---

## 8. Build pipeline

```bash
# Typecheck (strict mode)
npx tsc --noEmit

# Build release APK (Android only; iOS not configured)
cd android && ./gradlew assembleRelease
# Output: android/app/build/outputs/apk/release/app-release.apk
```

**Version bumping**: in `android/app/build.gradle`, both `versionCode` (integer) and `versionName` (string) need updating per build. Pattern is `versionCode 26527` / `versionName "26.5.17"` (the leading 265 is sentinel, last two/three digits are the build counter).

**APK size**: ~82 MB. Won't get meaningfully smaller without dropping Hermes or splitting per-ABI.

**Native deps that needed `npx expo install`**: `expo-sensors`, `expo-audio`, `expo-file-system`, `expo-battery`. All bundled with autolinking — no manual config plugins required beyond `expo-audio`.

---

## 9. Honest status — what works vs. what's a demo

### Solid
- Circles end-to-end (with SQL run): create, invite by username, invite by phone, accept link, browse members.
- Manual SOS button → countdown → broadcast → contacts WhatsApp ping → active screen.
- Call 112 button + 90 s auto-escalate prompt.
- Audio recording on real SOS (60 s) → Supabase Storage upload.
- PIN guard on SOS cancel + Safe Journey end.
- Safe Journey lock-screen widget with "I'm safe" / "+15 min".
- Shake detection (foreground only).
- Battery banner + work dampening.
- 4-step Profile Setup wizard.
- Google login (real Supabase session).
- Premium mint design system — consistent across every screen.

### Demo / weak (be honest with the user)
- **Phone OTP** is a fake bypass (`TEST_OTP_BYPASS = true`, code `123456`). No real SMS gateway. Phone users have no Supabase session → can't create circles, can't upload audio, can't invite by phone. Must flip `TEST_OTP_BYPASS` off and wire MSG91/Twilio before shipping.
- **Voice SOS** works only while ORBII is open. If the phone is in a pocket / screen off, it doesn't fire. Honest about this in the UI copy.
- **Shake SOS** dies when the app backgrounds. Needs a foreground service to be useful in real panic.
- **Premium / Plans tab** has UI but no Razorpay/UPI integration. Subscription state is local-only.
- **Notifications inbox** is AsyncStorage-backed, not server-side. Doesn't survive reinstall.
- **i18n**: English + Hindi populated. Punjabi / Tamil / Bengali files exist but mostly fall through to English. Language selector still shows all 5.
- **Friends graph** is in maintenance mode. UI works, no chat anymore.
- **`orbii.app` landing page** for `/join/<token>` exists at `web/join/index.html` but isn't deployed anywhere. User needs to point Cloudflare Pages / GitHub Pages / Vercel at the `web/` directory (see `web/README.md`).

### Deliberately deferred / unbuilt
- 10-step onboarding wizard (the current 4-step is good enough for MVP).
- Background shake detection (needs Kotlin foreground service — multi-session job).
- Discreet fake-call screen ("pretend you're on a call with mom").
- Audio playback in `IncidentDetail` (recording uploads, but no in-app player yet).
- Battery / power-state escalation in real time (we just dampen; don't aggressively conserve).
- Multi-device session count, push notifications for circle events from server side.
- Real subscription flow (Razorpay test mode + entitlement webhook).

---

## 10. Where new work usually lives

When the user asks for changes, the answer is almost always one of:

| Ask | Look here |
|---|---|
| "Change the colour of X" | `src/theme/colors.ts` (single source) |
| "Change the SOS broadcast" | `src/services/sos.ts` + `src/services/community.ts` + `src/services/whatsapp-sos.ts` |
| "Change what happens when X notification fires" | `src/services/notifications.ts` (channels + categories) + `App.tsx` (`addNotificationResponseReceivedListener`) |
| "Add a screen" | New folder under `src/screens/<Feature>/`, register in `AppNavigator.tsx` + `navigation/types.ts` |
| "Add a database table" | New file in `sql/` numbered sequentially, plus a service wrapper in `src/services/` |
| "Add a setting toggle" | Add field to `appSlice.ts` + `PersistedApp` in `persist.ts` + a Row in `SettingsScreen.tsx` |
| "Bump the version" | `android/app/build.gradle` → `versionCode` and `versionName` |
| Auth flow | `src/services/auth.ts` (Google + phone bypass + bootstrapProfile + emptyProfile) |
| Circles | `src/services/circles.ts` + `circles-bootstrap.ts` + `circlesSlice.ts` |
| Map markers | `src/components/common/MLMapView.tsx` (COLOURS map at top) |

---

## 11. Things the assistant should NOT do

Hard-learned through this codebase. **Do not** in any session:

1. **Migrate to Flutter / Kotlin / SwiftUI.** Multiple times the user has briefly considered this; the answer has always been "Path A — stay React Native." Push back firmly.
2. **Rewrite a 1000-line screen "from scratch."** Always patch in place. Last full rewrite attempt of `HomeScreen.tsx` left things broken for a day.
3. **Hardcode user data** (names, phone numbers, locations, photo URIs, helper counts, alerts). Everything must come from Redux / Supabase / hooks. Empty states + loading skeletons instead of mock data.
4. **Introduce a new green or a new red.** The palette is single-brand mint + SOS-only red. Use existing tokens.
5. **Ship a fake feature.** If a feature can't actually work (because of a missing native module, missing payment integration, missing SMS gateway), say so explicitly and either skip it or wire an honest "coming soon" state.
6. **Skip `npx tsc --noEmit` before building APK.** Always typecheck. The user expects an APK every session and a broken build wastes the turn.
7. **Forget to surface the SQL migration step.** Every time a SQL file is added or changed, the assistant should remind the user to paste it into Supabase SQL Editor → Run.

---

## 12. Memory the assistant has about the user

Persisted at `C:\Users\jatin\.claude\projects\d--ORBII\memory\`:

- **User profile** — Jatin Kumar, 19, founder/CEO of ORBII, non-technical, learning to code.
- **Project memory** — Women's safety SOS app, 6-day MVP target (now well past that), ₹0 budget, free-tier stack.
- **Feedback memory** — working > perfect, free > paid, simple > complex, safety-critical paths get priority.

Refer back to these before assuming new constraints.

---

## 13. Open questions for the next session

These came up in conversation but never got resolved:

1. **Real SMS gateway.** MSG91 has the cheapest India rates. Decision deferred until Premium revenue starts.
2. **Razorpay vs. Stripe vs. UPI direct.** Premium UI exists; no entitlement system or webhook yet.
3. **Domain.** `orbii.app` isn't registered or pointed anywhere yet. Required for the WhatsApp join link to work for users without the app installed.
4. **App store listings.** Play Store account costs $25 one-time. Decision deferred.
5. **Background shake / wake-word.** Needs a Kotlin foreground service — same architectural cost. Worth it eventually; not this month.
6. **Onboarding carousel.** There's an `OnboardingScreen` (legacy carousel) that runs before auth. Has not been touched in the mint-design pass. Probably needs a re-skin.

---

## 14. The single most important sentence

**The app exists to make sure that when a woman in India is in trouble, pressing one button — or shaking the phone, or saying "help" — gets a real human to her location as fast as possible.** Every design decision should serve that. Cute mascots, premium gradients, slick animations: yes, but never at the cost of the SOS button being one tap away on every screen and the alert reaching real humans within seconds.
