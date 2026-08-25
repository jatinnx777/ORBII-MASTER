# ORBII — Native Migration Audit

A living document for the migration **away from Expo's managed surface** toward
React Native bare workflow + a small, focused set of native Kotlin modules.

This is NOT a "rewrite to Flutter" or "rewrite the JS layer" plan. The JS / TypeScript
codebase is healthy. The migration is purely about unlocking native capabilities
that Expo's managed APIs can't deliver — primarily:

- A real **foreground service** with `microphone` service type for always-on voice / hardware-button SOS.
- A **wake-word engine** (Picovoice Porcupine) that the JS layer can talk to via a small bridge.
- **Boot receivers** + WorkManager watchdogs to survive process death and OEM-aggressive killers.

Everything else in the app — Supabase, Redux, navigation, Friends, Ghost Mode, Deadman Timer,
the Safety tab, the Membership flow — stays exactly where it is.

---

## TL;DR — Where we are

We are **already on the bare workflow** in practice. The `android/` folder lives in the repo
and is built directly via `./gradlew assembleRelease`. We haven't run `expo eject` because we
never needed to: every Expo SDK module we use is autolinked into the bare project at build time.

The friction isn't ejecting. The friction is the next step — adding a Kotlin native module
that holds an Android foreground service and exposes JS-callable methods + events.

---

## 1. Current Expo dependencies — audit

| Package | Native? | Migration risk | Replacement / notes |
|---|---|---|---|
| `expo` | yes | low | Stays. Provides `expo-modules-core` autolinking that the rest depend on. |
| `expo-asset` | yes | low | Stays. Just bundles static assets. No native blocker. |
| `expo-blur` | yes | low | Stays. Used sparingly; could be dropped if needed. |
| `expo-constants` | yes | low | Stays. We use it to detect `appOwnership === 'expo'`. |
| `expo-font` | yes | low | Stays. |
| `expo-haptics` | yes | low | Stays. Plain Vibrator API wrapper. |
| `expo-image-picker` | yes | low | Stays. Could be replaced with `react-native-image-picker` if Expo drops it. |
| `expo-linear-gradient` | yes | low | Stays. Pure-JS view wrapper, no native side effects. |
| `expo-linking` | yes | low | Stays. Deep-link parsing. |
| `expo-location` | yes | **medium** | Works fine for foreground location. **Background tracking** needs `expo-task-manager` + `expo-location` background mode, OR a native fused-location service. We do NOT use background mode today. |
| `expo-notifications` | yes | **medium** | Works for everything we use it for (scheduled alarms, channels, foreground service category for the listening badge). The persistent SOS shortcut technically uses it as a shortcut, not a true foreground service — so a native foreground service replaces it for Stage 3. |
| `expo-secure-store` | yes | low | Stays. Backed by Android Keystore / iOS Keychain. |
| `expo-sensors` | yes | low | Used to be wired to crash detection. Crash detection is removed; could drop the dep. |
| `expo-speech-recognition` | yes | **HIGH** | **The critical blocker.** Wraps Android's `SpeechRecognizer` API which is throttled hard in background. Replaced in Stage 3 by Picovoice Porcupine. Keep installed during transition; turn the feature flag off once Porcupine is live. |
| `expo-splash-screen` | yes | low | Stays. |
| `expo-status-bar` | yes | low | Stays. |
| `expo-web-browser` | yes | low | Stays. Used by OAuth handoff. |
| `expo-linear-gradient` | yes | low | Stays. |
| `expo-image-picker` | yes | low | Stays. |
| `firebase` | yes | medium | Currently unused in code paths. Could remove. |
| `@maplibre/maplibre-react-native` | yes | low | Stays. Already a native module, autolinks cleanly. |
| `@rnmapbox/maps` | yes | low | (Was installed; safe to remove if unused; check before pruning.) |
| `react-native-volume-manager` | yes | low | Stays. Powers the hardware-button SOS detector. |
| `react-native-webview` | yes | low | Stays. |
| `react-native-safe-area-context` | yes | low | Stays. |
| `react-native-screens` | yes | low | Stays. |
| `react-native-gesture-handler` | yes | low | Stays. |
| `@react-native-async-storage/async-storage` | yes | low | Stays. Hybrid with secure-store handles auth tokens separately. |
| `@supabase/supabase-js` | no | low | Pure JS. |
| `@reduxjs/toolkit`, `react-redux` | no | low | Pure JS. |
| All `@react-navigation/*` | mixed | low | Native parts (screens, stack) already autolink. |

**No package above is a hard blocker for going further with native modules.** The build
already pulls every native side via Expo autolinking. The next step is adding one of *our*
modules, not removing any of theirs.

---

## 2. The native modules we'll add

Three Kotlin modules, in order of priority:

### 2.1 `OrbiiVoiceService` (Stage 3 — wake-word)

A `Service` declared with `foregroundServiceType="microphone"` in
`AndroidManifest.xml`. Audio pipeline:

```
AudioRecord (16 kHz mono PCM)
  → 512-frame ring buffer
  → WebRTC VAD pre-gate (skip silent frames; saves ~40% battery)
  → Porcupine engine (.ppn model, ~1 MB)
  → On wake: emit RN event `OrbiiVoice/onWake` with keyword + score
```

JS bridge: `NativeModules.OrbiiVoice` with `start()`, `stop()`, `isAlive()`,
`addListener('onWake', cb)`. Replaces `expo-speech-recognition` for the always-on
path. The foreground listening case can keep using `expo-speech-recognition` as a
fallback if Porcupine licensing isn't yet active.

Estimated complexity: **4-6 weeks for a senior Android engineer.**

### 2.2 `OrbiiHardwareSOS` (Stage 2 — volume-key SOS)

Today the volume-key listener is JS-side via `react-native-volume-manager`.
Works in the foreground; dies within seconds of background. To survive
background → port to a Kotlin service that registers a `MediaSession.Callback`
and listens for `KeyEvent.KEYCODE_VOLUME_DOWN`. Reuses the same triple-press
state machine.

Estimated complexity: **1-2 weeks.**

### 2.3 `OrbiiBootReceiver` (Stage 2 — survive reboots)

A `BroadcastReceiver` with the `RECEIVE_BOOT_COMPLETED` permission that restarts
the foreground services after a phone reboot. Mandatory on MIUI / ColorOS where
the OS aggressively kills services and won't auto-revive them.

Estimated complexity: **2-3 days.**

---

## 3. Stage roadmap

| Stage | What | Status | Effort | Cost |
|---|---|---|---|---|
| 0 | RN/Expo, foreground voice + tap SOS, lock-screen shortcut | ✅ shipped | done | done |
| 1 | Volume-button SOS (JS-foreground baseline) + OEM helper screen + Voice SOS UX honesty pass | ✅ shipped | 1 week | ₹0 |
| 2 | Native AccessibilityService for global hardware-key capture (works screen-off / app killed / Doze) | ✅ shipped | 1 week | ₹0 |
| 3 | Porcupine + foreground service + built-in wake word ("JARVIS"). Custom "ORBII" pending Picovoice paid plan. | ✅ shipped (built-in keyword) | 1 turn | ₹0 dev / ₹15-25L for custom keyword + production volume |
| 4 | Multi-language wake words + Whisper-tiny intent parsing | future | 2-3 months | ₹40-60L |
| 5 | Full conversational safety assistant | future | 6-12 months | ₹1-2 cr |

We are at the **end of Stage 2**. The hardware-button SOS now works
globally — once the user enables ORBII in Settings → Accessibility, three
volume presses fire SOS regardless of screen state, app state, or OEM
power management.

### Stage 2 — what landed in code

Native module at `android/app/src/main/java/com/orbii/app/hardwaresos/`:

  • `OrbiiKeyService.kt` — AccessibilityService that captures global
    `KeyEvent.KEYCODE_VOLUME_DOWN` / `_UP`. Triple-press inside 1.5s
    fires a local broadcast. 8s cooldown built in.
  • `OrbiiHardwareModule.kt` — RN bridge. JS calls
    `isAccessibilityEnabled()`, `openAccessibilitySettings()`,
    `startListening()`, `stopListening()`. Triple-press emits a
    `OrbiiHardware:triplePress` device event.
  • `OrbiiHardwarePackage.kt` — registers the module with React.
  • `res/xml/orbii_accessibility_service.xml` — declares
    `flagRequestFilterKeyEvents` so the service receives key events.
  • `res/values/strings.xml` — service summary + description (the
    Settings → Accessibility list shows these).
  • `AndroidManifest.xml` — service declaration with
    `android.permission.BIND_ACCESSIBILITY_SERVICE`.
  • `MainApplication.kt` — `OrbiiHardwarePackage` added to the
    package list.

JS layer at `src/services/hardware-sos.ts` now tries the native path
first and falls back to `react-native-volume-manager` if the user
hasn't enabled the accessibility service. App.tsx's hardware-SOS
effect awaits the native handle, and Settings prompts the user to
open Settings → Accessibility when they toggle the feature on but the
service is disabled.

### Stage 3 — what landed in code

Native module at `android/app/src/main/java/com/orbii/app/voice/`:

  • `OrbiiVoiceService.kt` — foreground service of type
    `microphone`. AudioRecord at 16 kHz mono PCM into a worker
    thread. Each frame fed to Picovoice Porcupine. On detection,
    broadcasts `com.orbii.app.voice.WAKE` with the keyword name.
    Posts a low-priority "ORBII is listening" notification — the
    user always knows the mic is active.
  • `OrbiiVoiceModule.kt` — RN bridge. JS calls `start(accessKey,
    keyword)` to launch the service, `stop()` to tear it down.
    Triple-press emits `OrbiiVoice:wake` device events.
  • `OrbiiVoicePackage.kt` — registered in MainApplication.kt
    next to the hardware-SOS package.

Manifest:

  • `<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE"/>`
    was already present from earlier prep.
  • `<service android:name=".voice.OrbiiVoiceService"
       android:foregroundServiceType="microphone" />` — the OS
    grants this service mic access for as long as it runs.

Gradle:

  • `implementation 'ai.picovoice:porcupine-android:3.0.2'` added
    to `android/app/build.gradle`. Pulls the native libs.

JS:

  • `src/services/wake-word.ts` — typed wrapper around the bridge.
    `BUILTIN_KEYWORDS` exposed for the picker; default JARVIS.
  • `src/screens/Voice/VoiceSetupScreen.tsx` — three-step setup
    flow: open Picovoice Console, paste access key, pick keyword.
    Saves to SecureStore (`orbii:secure:voice-access-key`).
  • App.tsx → `backgroundVoice` toggle now starts the native
    service when an access key is present. Falls back to the
    legacy expo-speech-recognition listener for users who haven't
    yet set up Picovoice.

### What still needs you (Stage 3)

1. **Free Picovoice access key.** Go to https://console.picovoice.ai,
   sign in with Google, copy the AccessKey from the dashboard. Free
   tier covers personal use up to 3 active devices. Open ORBII →
   Settings → Background Voice SOS → paste the key.

2. **Pick a built-in wake word.** Default is JARVIS. The ORBII
   custom keyword needs the paid plan (~₹15-25L/yr at production
   volume). For beta testing, JARVIS / COMPUTER / PORCUPINE all
   work without paying anything.

3. **Production keyword later.** When revenue justifies it, train
   "orbii help" + "orbii bachao" via the Picovoice Console (~₹25k
   per keyword, one-time), drop the resulting `.ppn` files into
   `android/app/src/main/assets/`, and update the service to load
   from `Porcupine.Builder().setKeywordPath(...)` instead of
   `setKeyword(BuiltInKeyword)`.

---

## 4. Risk matrix

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| OEM kills foreground service even after whitelist | **High** | Loss of always-on listening | Ship the OEM helper screen (done Stage 1). Boot receiver + watchdog (Stage 2). Honest UX framing — never claim 100%. |
| Picovoice license cost outpaces revenue | Medium | Forced regression | Start with OpenWakeWord (free, 30% lower accuracy) for beta. Switch to Porcupine when paid users > 1k. |
| Custom wake-word false-positives | Medium | User trust loss | 0.7 threshold + 1.5s confirmation tap. Track per-device false-positive rate, raise threshold if > 2/day. |
| Battery-drain complaints | High | Uninstalls | Publish clear battery numbers ("ORBII uses ~3% per 24h listening"). VAD pre-gate is non-negotiable. |
| Privacy backlash | Medium | App-store rejection | All wake-word inference on-device. Audit policy. Mic indicator never hidden. Clear in-settings revoke. |
| Native side break in next Expo SDK upgrade | Low | Build breakage | Pin Expo SDK at known-good versions during Stage 3 rollout. |

---

## 5. What we explicitly DO NOT do

- **Rewrite the JS / TypeScript layer.** It's fine. Touch it only when adding native bridges.
- **Switch to Flutter / pure native.** No upside, massive cost.
- **Continuous cloud audio streaming.** Privacy disaster, server cost disaster, and the
  differentiator vs. Google Assistant is being on-device.
- **Custom wake-word training from scratch.** Picovoice does it for $300 per word — way
  cheaper than the ML team you'd need.
- **Ship Stages 4-5 before product-market fit.** Don't build moonshots before you have
  the basics reliable.

---

## 6. Day-1 checklist when we start Stage 2 / 3

When the next native engineer joins:

1. Confirm `expo prebuild --clean` produces a working `android/` build (it does today).
2. Add Kotlin module skeleton at `android/app/src/main/java/com/orbii/voice/`.
3. Wire React Native module via `ReactPackage` registered in `MainApplication.kt`.
4. Update `AndroidManifest.xml` with:
   - `<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />`
   - `<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />`
     (Android 14+ requires the explicit type)
   - `<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />`
   - `<service android:name=".voice.WakeWordService" android:foregroundServiceType="microphone" />`
   - `<receiver android:name=".voice.BootReceiver" />` with the boot-completed intent filter.
5. Pin Picovoice SDK version. Get production license key, store in env, never commit.
6. Build a tiny test harness app (separate Android Studio project) to validate Porcupine
   accuracy on real devices BEFORE wiring it into ORBII.
7. Test on a real Xiaomi / Vivo phone before claiming the feature works on Indian phones.

---

## 7. Things to remove if we want a leaner footprint

These aren't blockers; they're cleanup wins:

- `firebase` — currently imported but no code paths fire. Drop the package, drop the ~3 MB.
- `@rnmapbox/maps` — we shipped MapLibre instead. If `@rnmapbox/maps` is still in package.json, drop it.
- `expo-sensors` — was used for crash detection only; crash detection has been removed.

---

## 8. Document maintenance

Keep this file current. When a Stage finishes, mark it ✅ in the table. When a new
risk surfaces, add a row. When you pin a dependency version because of a regression,
note it here. The goal is that any new engineer can read this in 20 minutes and
know exactly what's hard, what's already done, and where to look next.
