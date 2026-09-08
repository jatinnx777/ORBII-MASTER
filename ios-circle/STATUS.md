# ORBII Circle (iOS) — what is actually built

Last touched **4 September 2026**. Assessed **8 September 2026**.

## The one-line answer

**Roughly 10 percent, and the 10 percent is the skeleton rather than the
feature.** 1,050 lines against the Android app's 62,000. Three screens, six
services, no map, no tests, and it has never been compiled for iOS.

## What this app is

Not a port of ORBII. A **second, smaller app for the other side of an alarm**:
the parent or friend who receives it. She raises an SOS on Android; they open
Circle and answer it.

That is why it is small by design. It does not need voice recognition, evidence
recording, disaster mode, the helper economy or the community. It needs to
receive an alert, show where she is, and let somebody say "I am coming".

## What exists

| Area | File | Lines | State |
|---|---|---|---|
| Sign in | `src/screens/SignInScreen.tsx` | 207 | Written |
| Home / circle list | `src/screens/HomeScreen.tsx` | 208 | Written |
| Incoming alert | `src/screens/AlertScreen.tsx` | 263 | Written |
| Supabase client | `src/services/supabase.ts` | 32 | Written |
| Auth | `src/services/auth.ts` | 45 | Written |
| Alerts | `src/services/alerts.ts` | 61 | Written |
| Roll call | `src/services/rollcall.ts` | 68 | Written |
| Escalation | `src/services/escalation.ts` | 83 | Written |
| Push | `src/services/push.ts` | 83 | Written |
| Theme | `src/theme/*` | 210 | Written |

Expo SDK 57, React Native 0.86.3. It talks to the same Supabase project as the
Android app, so every backend change since 4 September applies to it too.

## What does not exist

**No map.** `@maplibre/maplibre-react-native` is not a dependency. The alert
screen can tell you an alarm arrived; it cannot show you where she is. On an
app whose entire job is answering an alarm, that is the missing half rather
than a missing feature.

**Never compiled.** Not once, for any target. It has no Xcode project, no
iOS build, no simulator run. Every line in it is unverified: the count above
is lines written, not lines that work.

**No tests.** The Android app has 177.

**Four days stale on a fast-moving backend.** Since 4 September the schema has
moved through sql/118 to sql/126: the emergency override, presence alerts,
arrival alerts, the SOS trigger column, bubbles, join codes and batched trails.
This app was written against sql/117 and knows about none of it. In
particular it will not read `emergency`, `unreachable` or `precision_m`, which
are exactly the fields an alert-answering app should be leading with.

## Why it stopped

The honest reason: **you cannot build an iOS app without a Mac.** Expo can
bundle the JavaScript from Windows, but producing a signed `.ipa` needs Xcode,
which needs macOS. The options are a borrowed Mac, a Mac mini, or EAS Build
(Expo's hosted macOS builders, which do work from Windows and cost money per
build past the free tier).

Nothing in the code is blocked. The toolchain is.

## What I would do next, in order

1. **Give it a git remote.** It had two commits and no remote and lived on one
   laptop. Copying it here fixes that: it is now inside a repo that pushes.
   The original at `D:\ORBII-CIRCLE` is untouched and can be deleted once you
   are happy this copy is complete.

2. **Bring it up to the current schema.** A day's work. The alert screen should
   show `emergency`, `unreachable` and the SOS `trigger` from sql/120, so a
   crash alert reads differently from a pressed button.

3. **Add the map.** MapLibre, same as Android, same OpenFreeMap tiles. Without
   it the app cannot do its job.

4. **Then, and only then, find a Mac.** Compiling an app that is missing its
   main screen tells you nothing except that it compiles.

## What not to claim

It is not "in development" in any sense a user would recognise. Nobody has run
it. Until it builds and someone answers a real alert on a real iPhone, the
honest description is a prototype, and the blog post from 5 September that
announced development started is the strongest thing that should be said about
it publicly.
