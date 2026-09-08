# ORBII Circle (iOS) — what is actually built

Last worked on **8 September 2026**.

## The one-line answer

**Roughly 45 percent, and it now does the thing it exists for.** Live map with
your own position and the distance to her, it knows what kind of alarm it is
answering, 23 tests, clean typecheck, and the iOS bundle builds. What it has
never had is a device to run on.

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

## Added on 8 September

**The map.** `src/components/AlertMap.tsx`. MapLibre on OpenFreeMap tiles, the
same stack and the same tiles as Android, so both apps render one world with no
key and no billing account.

It reads `circle_members_locations` rather than the SOS row, and this matters:
during an active SOS that view keeps updating from her phone (sql/118), while
the SOS row holds only where she was when she raised it. A pin drawn once from
the SOS row is a pin that goes stale while somebody drives to it. The camera
follows, and there is a Directions button that hands off to Apple Maps.

**It knows what kind of alarm it is.** The title comes from the SOS trigger
(sql/120) instead of always saying "needs help". A detected impact reads as a
possible fall or crash, with a line saying she may not be able to answer a
call, because "needs help" implies somebody chose to ask and the sensible
response to that is to phone them.

**It understands a bubbled position.** If she is sharing a neighbourhood rather
than a point (sql/123), the marker is drawn wider and paler and the screen says
so in words. Without that, somebody navigates to the centre of a square
kilometre believing it is exact.

**Everything else from sql/118 to 126** is in `src/services/locations.ts`:
`emergency`, `age_seconds`, `unreachable`, battery, charging, speed. Each one
defaults to the safe reading if the server predates it, and age is computed
locally rather than reported as zero, because zero means "just now" and that is
the one wrong answer that costs something.

## Also on 8 September

**How far away am I.** The map shows the reader's own position and the distance
to her, which is the first question anybody answering an alarm asks and the one
that decides whether they set off or call somebody closer. Asked once rather
than watched: a moving blue dot is a navigation feature, and continuous
positioning would drain the reader's battery during the exact hour they need
it. Not shown for a bubbled position, because a precise-looking distance from
the centre of a cell she deliberately blurred is a number computed from a point
she is not standing on.

**The push token bug is fixed, for both apps.** push_tokens had `user_id` as
its primary key, so it held one token per PERSON and every registration
replaced the previous device. A parent with both ORBII and ORBII Circle
installed would have had one of them go quiet, and it would have been whichever
they opened first: the app whose entire job is receiving an emergency
notification. sql/127 makes the key `(user_id, token)`. Nothing downstream
needed changing, because every reader already did
`.select('token').in('user_id', ids)`.

**Four dead dependencies removed:** React Navigation, native-stack,
react-native-screens and expo-linking were installed and never imported.
Navigation is hand-rolled state in `App.tsx`, which is right for three screens.
`expo-location` was also unused and is kept, because it is what the distance
above is built on.

**`newArchEnabled` is pinned to true** rather than inherited from the SDK
default, so an SDK bump cannot silently change the runtime underneath it.

**The pure logic moved to `src/lib`.** Formatting and geometry now live in
modules that import nothing, which is where they belonged and is also the only
way they could be tested: they previously sat beside the Supabase client, which
pulls in react-native, which is Flow-typed and cannot be parsed by the test
runner.

## What is verified, and what that is worth

**23 tests pass**, up from none. They cover the parts a compiler cannot check:
that an emergency outranks every other status on a card even when the row is
also stale and not sharing, that a blurred position is never described as a
point, that "taken this on" and "arrived" never read the same, and that a phone
clock running fast cannot print "-1 minutes ago" on an emergency screen.

**It typechecks clean** under `strict`. First time it has been checked at all.

**The iOS bundle builds.** `npx expo export --platform ios` produces 795
modules and 2.4MB of Hermes bytecode with MapLibre in it. That proves every
import resolves and the JavaScript is valid, which typecheck alone does not.

**It has still never run.** A bundle is not a build and a build is not a
device. Nothing here has been seen on a screen. Treat every layout number as a
guess until somebody opens it.

## What does not exist

**No tests.** The Android app has 177.

**Push only routes SOS notifications.** A tapped low-battery, unreachable,
arrival or check-in notification does nothing, because there is no screen in
this app to route them to yet.

**No everyday view.** It answers alarms. It cannot show you where everyone is
on an ordinary Tuesday, which is what most of the Android circle work has been
about.

## Why it stopped

The honest reason: **you cannot build an iOS app without a Mac.** Expo can
bundle the JavaScript from Windows, but producing a signed `.ipa` needs Xcode,
which needs macOS. The options are a borrowed Mac, a Mac mini, or EAS Build
(Expo's hosted macOS builders, which do work from Windows and cost money per
build past the free tier).

Nothing in the code is blocked. The toolchain is.

## What I would do next, in order

1. **Run it on a Mac.** This is now the only thing standing between the app and
   being real, and everything below is guesswork until it happens. The order
   has changed because the app is no longer missing its main screen.

2. **Fix whatever the first run breaks.** Expect layout problems. Nothing here
   has been seen at any size on any device.

3. **Route the other notification kinds**, once there is somewhere to send
   them.

4. **Decide whether it gets an everyday view** or stays purely an alarm
   answering app. Staying small is a defensible answer.

## What not to claim

Nobody has run it. A clean typecheck and a successful bundle mean the code is
valid, not that the app works, and the difference is every layout, every
permission prompt, every push token and every map frame.

Until somebody answers a real alert on a real iPhone, the honest description is
a prototype, and the 5 September blog post announcing that development started
remains the strongest thing that should be said about it publicly.
