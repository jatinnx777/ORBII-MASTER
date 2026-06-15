# ORBII — React Native → Flutter Migration Plan

> **Status (2026-06-15):** RN app **paused** by founder decision.
> - ✅ **Phase 1** — skeleton (theme, GoRouter auth gate, Supabase init,
>   Google + phone-OTP sign-in).
> - ✅ **Phase 2** — Home (flutter_map 60% + fixed 42% sheet, Protection hero,
>   **Protection Strength pill + sheet ported**, SOS button → cancellable
>   countdown screen, Voice card, Helpers card), `geolocator` location service +
>   `permission_handler` wiring. `flutter analyze` clean.
> - ✅ **Phase 3** — native Voice SOS. `VoiceGuardService.kt` (Vosk + VAD +
>   phrase matching + full-screen-intent) ported verbatim into `orbii_flutter`;
>   RN bridge replaced by `VoiceGuardPlugin` MethodChannel (`com.orbii.app/
>   voiceguard`) registered in `MainActivity`. Dart `VoiceGuardService` +
>   `voiceProvider` drive arm/disarm with a duration picker; `orbii://voice-sos`
>   deep link → instant SOS via `app_links`. Manifest (FGS-mic perms, service,
>   deep link), Vosk/JNA gradle deps + ProGuard rules added. `flutter analyze`
>   clean.
> - ✅ **Phase 3 native verification (2026-06-15):** `flutter build apk --debug`
>   AND `--release` both succeeded. Kotlin compiles, Vosk + JNA resolve, no
>   duplicate classes, manifest merges with all perms + `<service>` +
>   `foregroundServiceType="microphone"` + both deep links, native libs
>   (`libvosk.so` + `libjnidispatch.so`) packaged for arm64/armeabi-v7a/x86_64,
>   `org/vosk/{Model,Recognizer}` in dex, MethodChannel name + 4 methods match
>   both sides, and R8 (release) passes with the Vosk/JNA ProGuard rules (no
>   `java.awt` error). Added `kotlin.incremental=false` (pub cache on C:, project
>   on D: broke the incremental cache). **Runtime items (deep-link launch,
>   service lifecycle, Vosk model download/recognition) NOT run — no device was
>   connected; left as an on-device checklist.**
> - ✅ **Phase 4** — safety network layer. Services ported faithfully against the
>   unchanged backend: `circles_service` (CRUD + members hydrate + invites by
>   username/phone + accept/decline), `users_service` (search + `find_user_by_
>   phone` RPC — never a direct phone read), `helpers_service` (`set_helper_
>   location` + `nearest_helpers` PostGIS RPCs) + `helper_mode_service` (ping
>   loop), `presence_service` (Realtime presence channel `orbii:presence`),
>   `community_service` (broadcast `orbii:alerts` + `sos_events` backfill +
>   `sos_responders`), `live_location_service` (broadcast `sos-live:{id}`).
>   Providers: circles / presence / helpers. Screens: Circles list + detail
>   (invite sheet), Community Alerts (respond). Home now joins presence, renders
>   peer markers, shows the live nearby count, and routes to Circles/Community.
>   `flutter analyze` clean. NO schema/RLS/bucket changes.
> - ⏳ **Stubbed for later phases:** helper-availability toggle UI + DB-backed
>   nearby-count (service ready, Home uses presence count); live-location wired
>   into an active-SOS responder screen (service ready); actual SOS dispatch into
>   `sos_events` + audio recording; foreground `speech_to_text`; profile/settings
>   /notifications screens (Phase 5). Map raster OSM → OpenFreeMap vector for
>   visual parity.
> - Next: Phase 5 (SOS dispatch + periphery screens).
> **Goal:** Preserve ORBII *exactly as it works today* (feature parity, not pixel
> parity) while moving the client codebase from React Native/Expo to Flutter.
> **Hard constraints:** Keep the existing Supabase backend, schema, RLS, Realtime,
> Storage and Auth **untouched**. No paid APIs. No OpenAI. No Google Maps.

---

## 0. Read this first — scope reality

This is **not** a refactor. It is a full client rewrite in a different language
(Dart) with a different UI framework, a different state model (Riverpod instead
of Redux), a different navigation library, and a **re-implementation of the
Android native voice service in Kotlin against Flutter's platform-channel API**.

What is being rewritten:

| Layer | Today (RN) | Count |
|---|---|---|
| Screens/feature folders | `src/screens/*` | **15** |
| Service modules | `src/services/*.ts` | **40** |
| Redux slices | `src/redux/slices/*` | **7** |
| Native Android modules | `com/orbii/app/voice/*` | **3 Kotlin files** |
| SQL migrations (**stay as-is**) | `sql/*.sql` | 18 |

What is **NOT** changing: the entire Supabase backend (Postgres, PostGIS, RLS,
Realtime broadcast, Storage buckets, Auth providers, all 18 SQL migrations).
Flutter talks to the same project URL + anon key via `supabase_flutter`.

> ⚠️ The working RN app is days from publishable and already passes Play
> Protect. A Flutter rewrite restarts the native-reliability work (battery/Doze,
> OEM autostart, foreground-service lifecycle, Vosk model download) that took
> significant effort to get right. **Recommend shipping the RN build first, then
> migrating in parallel — do not block launch on this.** See §9.

---

## 1. Target stack

| Concern | RN today | Flutter target |
|---|---|---|
| Language | TypeScript | Dart (latest stable) |
| State | Redux Toolkit + react-redux | **Riverpod** (StateNotifier/AsyncNotifier) |
| Navigation | React Navigation (native-stack + tabs) | **GoRouter** |
| Backend SDK | `@supabase/supabase-js` | **`supabase_flutter`** |
| Map | MapLibre RN + OpenFreeMap | **`flutter_map`** + OpenFreeMap tiles |
| Routing/ETA | OSRM (public) | OSRM via `http` (unchanged endpoint) |
| Location | `expo-location` | **`geolocator`** |
| Permissions | `PermissionsAndroid` / expo | **`permission_handler`** |
| Notifications | `expo-notifications` | **`flutter_local_notifications`** |
| Background service | Kotlin `VoiceGuardService` | **`flutter_background_service`** + native Vosk (Kotlin, kept) |
| Foreground STT | `expo-speech-recognition` | **`speech_to_text`** |
| On-device wake/phrase | Vosk (Kotlin) | **Vosk (Kotlin, reused almost verbatim)** |
| Audio record (SOS) | `expo-audio` | **`record`** |
| Local storage | AsyncStorage | **`shared_preferences`** |
| Secure storage | expo-secure-store | **`flutter_secure_store`** |
| Background tasks | — | **`workmanager`** (deadman/heartbeat) |
| Haptics/blur/gradient | expo-* | `flutter` built-ins + `flutter_blur`/gradients |

---

## 2. Supabase backend — the contract that must not change

The Flutter client must reproduce **exactly** these interactions. Table/RLS
definitions live in `sql/` and are the source of truth.

### Tables (do not migrate data; reuse)
- `profiles` — owner-scoped private profile (email, phone, name, username, photo).
- `users_public` — directory (id, username, name, photo_url). **Phone column is
  no longer client-readable** (see `sql/18`); phone lookups go through the
  `find_user_by_phone(p_phone, p_exclude)` RPC. Flutter must call the RPC too.
- `emergency_contacts` — owner-scoped.
- `sos_events` / SOS audio (`sql/03`, `sql/11`) — Storage bucket for recordings.
- `circles` + members (`sql/09`,`10`,`14`) — owner-membership trigger + RLS.
- `friend_requests` / friends (`sql/01`,`08`) — **see §7, mostly removed.**
- `helpers` (`sql/12`) — nearby-helper radius search (PostGIS).
- `voice_usage` (`sql/13`) — quota tracking for Voice SOS.
- `avatars` bucket (`sql/17`) — public-read, owner-write profile photos.

### Realtime
- **Presence broadcast** (helpers/peers on the map) → `supabase_flutter`
  `channel.onBroadcast` / presence. Reproduce `joinPresence`, `subscribePresence`,
  `countPresenceNearby` from `src/services/community.ts`.
- **Live location sharing** during active SOS (`src/services/live-location.ts`).

### Auth
- Google OAuth + phone OTP. `supabase_flutter` `signInWithOAuth` +
  `signInWithOtp`/`verifyOTP`. Deep-link redirect (see §6).

### RPCs / SECURITY DEFINER
- `find_user_by_phone(text, uuid)` — exact-match phone lookup (added in `sql/18`).
- Any radius/helper functions in `sql/12`.

> **Rule:** every Supabase call in Flutter must map 1:1 to an existing RN service
> function. Build a `lib/services/` that mirrors `src/services/` file-for-file so
> the mapping is auditable.

---

## 3. Service-by-service mapping (`src/services/*.ts` → `lib/services/*.dart`)

| RN service | Responsibility | Flutter notes |
|---|---|---|
| `supabase.ts` | client init (URL + anon key) | `Supabase.initialize` in `main()` |
| `auth.ts` | OAuth/OTP, profile load, `syncProfile`, avatar upload | `supabase_flutter` + `image_picker` |
| `profile-sync.ts` | mirror profile → `profiles` + `users_public` | same upserts |
| `users-public.ts` | directory search, **phone RPC**, username lookup | call `find_user_by_phone` RPC |
| `emergency-contacts.ts` | CRUD owner-scoped | direct |
| `circles.ts` / `circles-bootstrap.ts` | circle CRUD + members hydration | direct |
| `friend-requests.ts` / `friends*` | **mostly delete (see §7)** | keep only circle-invite path |
| `helpers.ts` / `helper-mode.ts` | nearby helper count + responder flow | PostGIS RPC |
| `community.ts` | presence, nearby alerts, broadcast | Realtime presence |
| `live-location.ts` | publish live location during SOS | Realtime |
| `sos.ts` / `sos-history.ts` / `sos-recording.ts` | SOS lifecycle, audio, history | `record` + Storage |
| `voice-detection.ts` | foreground keyword listener | `speech_to_text` |
| `voice-phrases.ts` / `voice-limits.ts` | custom phrases + quota | `shared_preferences` + `voice_usage` |
| `background-voice.ts` | **native VoiceGuard bridge** | platform channel → Kotlin (§5) |
| `location.ts` | GPS convergence (BestForNav, ≤35m) | `geolocator` high-accuracy |
| `osrm.ts` / `routing.ts` | route + ETA | `http` to OSRM |
| `notifications.ts` / `notification-inbox.ts` | local notifs, full-screen-intent, inbox | `flutter_local_notifications` |
| `deadman.ts` | dead-man's-switch heartbeat | `workmanager` |
| `shake-detection.ts` | **CUT** (already removed from Home) | drop |
| `battery-aware.ts` | dampen background work on low battery | `battery_plus` |
| `whatsapp-sos.ts` | WhatsApp deep-link fallback | `url_launcher` |
| `entitlements.ts` / `rate-limit.ts` / `voice-limits.ts` | premium gating, quotas | direct |
| `secure-store.ts` / `session.ts` / `storage.ts` | tokens, session, KV | `flutter_secure_store` + `shared_preferences` |
| `analytics.ts` / `logger.ts` / `error-reporting.ts` / `net.ts` / `app-info.ts` / `safety-pin.ts` | infra | direct ports |

---

## 4. Screen-by-screen mapping (`src/screens/*` → `lib/features/*`)

Migrate in this order (each is a vertical slice: UI + its providers + services):

1. **Auth** + **Onboarding** — sign-in gate; nothing else works without it.
2. **Home** — map (60%) + bottom sheet (40%), Protection Hero, **Protection
   Strength pill + sheet**, SOS button, Voice card, Helpers card, Alerts strip.
3. **SOS** — countdown, ActiveSOS, recording, live location, resolve flow.
4. **Safety** — safety tools tab.
5. **Circles** — create/join, members, invite-by-phone (RPC), invite-by-username.
6. **Community** — nearby alerts / responder.
7. **Profile** + **Settings** + **About** — edit profile (avatar upload), prefs.
8. **History** — SOS history list.
9. **Notifications** — inbox.
10. **OEMHelp** — autostart/battery instructions (per-OEM).
11. **Premium** — upgrade/plans.
12. **SafeMode** — minimal SOS-only mode.

Design system to reproduce in a Flutter `ThemeData` + shared widgets:
Warm Greige — bg `#F2EEEB`, surface `#FAF8F6`, gold `#FFD77A`, danger `#FF6B57`,
success `#7BC47F`, voice `#8B7CF8`, text `#2D2D2D`/`#8A837D`. 60/40 map/sheet.

---

## 5. Native Android voice service (the hard part)

Today: `com/orbii/app/voice/VoiceGuardModule.kt` + `Package.kt` expose a RN
NativeModule; `VoiceGuardService.kt` is a foreground microphone service running
**Vosk** with VAD (RMS gate), model download, phrase matching, full-screen-intent
SOS trigger via `orbii://voice-sos`, START_STICKY restart, wake lock, auto-stop.

Migration approach — **reuse the Kotlin, swap only the bridge**:
- Keep `VoiceGuardService.kt` essentially as-is (Vosk, VAD, phrase logic, wake
  lock, full-screen intent). It has no RN dependency in its core.
- Replace `VoiceGuardModule`/`Package` (RN bridge) with a **Flutter
  `MethodChannel`** (`com.orbii.app/voiceguard`) exposing: `startGuard(phrases,
  durationMs)`, `stopGuard()`, `requestDisableBatteryOptimization()`,
  `isIgnoringBatteryOptimization()`.
- Pair with `flutter_background_service` for the Dart-side lifecycle, or keep the
  service fully native and just start/stop it via the channel (preferred — less
  surface area, matches today's design).
- Keep `proguard-rules.pro` Vosk/JNA keep + `-dontwarn java.awt.**` rules.
- Keep the `orbii://voice-sos` deep link → routed by GoRouter (§6).

---

## 6. Deep links & permissions

**Deep links** (GoRouter `redirect` + `uni_links`/`app_links`):
- `orbii://voice-sos` — fired by the native service → open SOS countdown/active.
- OAuth redirect URI for Supabase sign-in.

**Permissions** (`permission_handler`), requested at the same moments as today:
- Location (fine) — Home bootstrap.
- Microphone (`RECORD_AUDIO`) — Voice SOS arm.
- Notifications (`POST_NOTIFICATIONS`, API 33+) — startup.
- Battery optimization exemption (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`) — via
  native channel, not `permission_handler`.
- Foreground-service-microphone manifest entries — reproduce in Flutter
  `AndroidManifest.xml`.

---

## 7. Social features to REMOVE (do not port)

Per the migration brief, strip all social-networking concepts. Keep only the
**circle / trusted-helper** model.

- ❌ Friends / friend requests as a social graph (`friend-requests.ts`,
  `sql/01`,`08`) — keep ONLY the path that turns a phone/username lookup into a
  **circle invite**. Delete the standalone friends list/feed.
- ❌ Messaging / chat — none ships; ensure nothing is added.
- ❌ Social feed / community chat — the "Community" tab is **nearby SOS alerts
  only**, not a feed. Port the alert/responder flow; drop any feed framing.
- ✅ Keep: Circles (trusted contacts), nearby **helpers** for SOS response,
  emergency contacts, presence on map.

---

## 8. Notifications inventory (reproduce each)

- Full-screen-intent **helper alert** ("someone nearby needs help") → tap routes
  to CommunityAlerts.
- **Voice wake** notification when a phrase is heard.
- **Listening badge** (ongoing) while Voice SOS is armed.
- **Pinned SOS shortcut** (ongoing quick-trigger).
- **Safe-journey widget** (ongoing trip status).
- Channel: `sos` (high importance, full-screen). Recreate channels in Flutter.

---

## 9. Phased plan (recommended)

**Phase 0 — Ship RN first.** Finish security (`sql/18` applied) + Protection
Strength, publish the RN build. Migration runs in parallel, not as a blocker.

**Phase 1 — Skeleton.** New Flutter app, `supabase_flutter` init, theme, GoRouter
shell, Auth + Onboarding. Verify sign-in against the live Supabase project.

**Phase 2 — Core safety.** Home (map + sheet + Protection Strength), SOS
countdown/active/recording, location convergence, emergency contacts.

**Phase 3 — Native voice.** MethodChannel + reused `VoiceGuardService.kt`,
foreground `speech_to_text`, phrases/quota, battery/OEM flows.

**Phase 4 — Circles + presence.** Circles CRUD, invite-by-phone RPC, Realtime
presence/helpers on map, Community alerts/responder.

**Phase 5 — Periphery.** History, Notifications inbox, Settings, Profile, About,
Premium, SafeMode, deadman/workmanager.

**Phase 6 — Parity sign-off.** Walk every flow in this doc against the RN app;
parity is the acceptance test, not screenshots.

---

## 10. Definition of done

- [ ] Every `src/services/*` function has a `lib/services/*` equivalent hitting
      the same Supabase table/RPC/channel.
- [ ] Every screen in §4 reachable with identical flows.
- [ ] Native voice service fires `orbii://voice-sos` from the background.
- [ ] All notifications in §8 reproduced.
- [ ] All permissions in §6 requested at the same moments.
- [ ] No Friends/Messaging/Feed/Chat remnants (§7).
- [ ] Supabase schema/RLS/Storage **unchanged** (no new `sql/` files required by
      the client rewrite).
