# ORBII Field Testing Protocol

Physical tests that cannot be faked in a simulator, plus the observability that
tells you when something has quietly stopped working in production.

**Why this document exists.** Roughly 800 lines of Kotlin in the mesh, the SMS
lifeline, and the offline helper alert have never run on two real phones. They
are written, reviewed, and unproven, and until these tests pass nobody should
describe them as working. The voice pipeline ships, but its hardest cases
(muffled through fabric, street noise) have never been measured, only reasoned
about.

Record every result. A test with no written outcome did not happen.

---

## Part 1: Acoustic, does it hear her

The trigger is the whole product. Everything else is downstream of a detection
that either happens or does not.

### Equipment
Two Android phones, one running ORBII armed, one recording as a control. A
notebook. A quiet room, a busy road, and a shopping street.

### 1.1 Placement matrix

Say the trigger phrase at normal shouting volume, once per cell. Fifteen
attempts per cell. Record hits out of fifteen.

| Placement | Quiet room | Busy road | Crowded street |
|---|---|---|---|
| In hand, screen off | | | |
| Trouser pocket | | | |
| Jacket pocket | | | |
| Handbag, unzipped | | | |
| Handbag, zipped | | | |
| Backpack | | | |

**What to watch.** The zipped-handbag row is the one that matters. Auto-gain
lifts toward `TARGET_RMS = 3000` with a ×12 ceiling (≈ +21.5 dB), and fabric
can attenuate more than that recovers. If that row is materially worse than
unzipped, the ceiling is the constraint, not the model.

**Pass mark:** ≥ 12/15 in hand and in a trouser pocket in all three
environments. Below 10/15 in any pocket row is a blocker, not a tuning note.

### 1.2 Which path fired

Voice SOS has four independent firing paths. A hit rate hides which one is
doing the work. Use the in-app **Voice Debug** screen (`VoiceDebugScreen`) and
record, for each detection, which of these fired:

- phrase match (`"help help"`, `"bachao bachao"` …)
- single word at confidence ≥ 0.88
- cross-utterance repeat inside 12 s
- fusion (soft word + sub-threshold YAMNet scream)

**What this tells you.** If nearly everything is arriving via the repeat path,
`SINGLE_CONF = 0.88` is set too high for real speech and should come down. If
fusion never fires, YAMNet is contributing nothing and the second model is
costing battery for no recall.

### 1.3 False positives, the test that protects the network

Arm Voice SOS and leave the phone running, doing nothing deliberate, for these
periods. Count every countdown that starts.

| Scenario | Duration | Countdowns |
|---|---|---|
| Television, drama or news | 2 h | |
| Normal conversation, 3+ people | 1 h | |
| Music, vocals | 1 h | |
| Commute, bus or metro | 1 h | |
| Overnight, phone on a table | 8 h | |

**Pass mark: zero.** Not "low". A false SOS wakes a circle, dispatches
strangers, and burns a free-tier dispatch. One in eight hours is one every
night, and a helper network that learns alerts are usually false is worse than
no network.

`SINGLE_CONF` was already raised 0.62 → 0.88 because the model emitted `help`
from TV chatter. If the television row is non-zero, that threshold is still
too low.

### 1.4 Calibration

sql/79's companion change seeds the noise floor from ~600 ms of real audio at
service start. Verify it works:

1. Arm in a quiet room. Check logcat for `calibrated noise floor=`.
2. Arm on a busy road. The logged value should be visibly higher.
3. Arm in a quiet room, then walk onto the road **without re-arming**, and
   confirm detection still works. Calibration seeds the floor; the leaky
   integrator has to carry it from there.

```
adb logcat -s VoiceGuard | grep -E "calibrated|gate"
```

### 1.5 Survival

The service is useless if Android kills it.

- Arm, lock the phone, leave it 4 hours. Fire the trigger. Does it work?
- Arm, then restart the phone. `BootReceiver` should re-arm.
- Test on a **Xiaomi, Oppo, Vivo and Samsung** specifically. Their task killers
  are the aggressive ones and they are most of the Indian market. `OEMHelpScreen`
  exists for this reason; confirm its instructions actually match each OEM's
  current settings UI.
- Check the liveness beacon. The service stamps a heartbeat every 30 s; a stale
  stamp is proof the OS paused it.

---

## Part 2: RF, the mesh that has never run

**Status: unproven.** Two phones minimum, three to test a relay hop.

### 2.1 Bring-up

1. Phone A: arm mesh SOS with mobile data and wifi **off**.
2. Phone B: ORBII open, mesh listening, data **on**.
3. Fire the SOS on A.
4. Confirm B receives the advertisement and POSTs to `mesh-bridge`.
5. Confirm a real alert lands for A's circle.

**Record: time from trigger on A to alert delivered.**

### 2.2 Range

Open ground, no obstructions. Walk B away from A in 10 m steps and record the
last distance at which the packet is received.

| Mode | Expected | Measured |
|---|---|---|
| 1M PHY (fallback) | 30–80 m | |
| Coded PHY (long range) | 150–400 m | |

`boostCapable` detection decides which is used. Log which one was actually
negotiated, do not assume Coded PHY was used just because the device supports
it.

### 2.3 The relay hop

Three phones. A offline, B offline, C online. Position so **A cannot reach C
directly**, and B is between them. Fire on A.

This is the test the entire offline story rests on. If the packet does not
reach C via B, the mesh is a single-hop broadcast, not a mesh, and the product
claim has to change.

### 2.4 Blind courier

Verify B carries a payload it cannot read. On B, dump the received advertisement
and confirm it is opaque: the sealed box should reveal no coordinates, no name,
no phone number. NaCl sealed boxes are anonymous-sender, so B has no key.

**If B can read anything, stop and fix it before any further testing.** The
privacy claim on the website depends on this being true.

### 2.5 Dead-zone reality

Basement car park, lift, metro tunnel, rural stretch with no bars. For each:
does the mesh find a peer, and does the SMS lifeline fire in parallel?

### 2.6 Battery

Mesh advertising plus scanning plus voice listening, all at once, for 4 hours.
Record the drain. A responder app that costs 40% of a battery per shift will be
uninstalled, whatever it does.

---

## Part 3: Dispatch and escalation

### 3.1 Two accounts, always
`sos_events_nearby` excludes `e.user_id <> auth.uid()`. Testing both apps on one
login shows nothing, forever, from any location. Two accounts, two devices,
within 15 km.

### 3.2 The wave ladder
Fire a real SOS with a verified helper on duty nearby and let it run without
responding. Verify:

- wave 1 dispatches three helpers
- nothing escalates while an arrival code is outstanding
- after the 4-minute stall window with responders but no arrival, wave 2 fires
- entering a correct arrival code stops escalation
- the victim answering "I'm safe" stops it permanently

### 3.3 The race sql/79 fixes
Invoke `escalate-sos` twice within a second, deliberately, while an SOS is
mid-ladder. Before sql/79 this double-dispatched a wave and reset the stall
timer. After it, the second invocation should skip the locked row.

```
select wave, last_wave_at from sos_escalation where sos_id = '<id>';
```

Run it twice, confirm `wave` advanced by exactly one.

### 3.4 Arrival code brute force
Enter a wrong PIN ten times. The eleventh must be refused for that helper on
that SOS, and a **different** helper must still be able to check in. The lock is
scoped per `(sos_id, user_id)` precisely so one bad actor cannot lock a real
responder out of a scene.

---

## Part 4: Observability

### 4.1 What exists after sql/80

| Sink | What it catches |
|---|---|
| `client_errors` | App crashes (already live) |
| `function_errors` | Edge function failures (new) |
| `push_outbox_health()` | Queue depth and stuck rows |
| `push_outbox_alarm()` | Cron, every minute, writes a `fatal` row if emergency pushes have been stuck over 2 minutes |

The signal that matters is **`oldest_pending_s`**, not the error count. A drain
that dies silently throws no exceptions at all; rows just stop being marked
sent. Measure the queue, not the failures.

### 4.2 Sentry, optional

`function_errors` **records**; it does not **notify**. If you want to be woken
up, set a DSN and the shared reporter forwards to it:

```
npx supabase secrets set SENTRY_DSN="https://<key>@<host>/<project>" \
  --project-ref henbkyjefhzmxqozlczd
```

Sentry's free tier covers 5,000 events a month, which is far more than this
will produce. Nothing depends on it: with no DSN set, the forwarder is a no-op
and the database sink is unaffected.

### 4.3 Verify it fires

Break it on purpose, once, and confirm you find out:

1. Rename `push_claim` in the database.
2. Invoke `drain-push`.
3. Confirm a `fatal` row appears in `function_errors`.
4. Rename it back.

An alarm nobody has ever seen fire is an untested alarm.

---

## Part 5: Release gate

Do not ship a build claiming offline capability until every box holds:

- [ ] 1.3 false positives: **zero** across all five scenarios
- [ ] 1.1 in-hand and trouser-pocket detection ≥ 12/15 in all environments
- [ ] 1.5 survives 4 hours locked on Xiaomi, Oppo, Vivo and Samsung
- [ ] 2.1 mesh bring-up delivers a real alert
- [ ] 2.3 three-phone relay hop confirmed
- [ ] 2.4 relaying phone provably cannot read the payload
- [ ] 3.3 double-invoked escalation advances the wave exactly once
- [ ] 4.3 a deliberately broken drain produces a `fatal` row
- [ ] 6.1 the offline SMS composer appears by itself and sends in one tap
- [ ] 6.2 impact detection is off and cannot self-trigger

Until 2.1, 2.3 and 2.4 pass, the honest description of the mesh remains
**"built, in hardware testing"**, on the website, in the deck, and in the room.

---

## Part 6: The offline engine

Added Aug 2026. All of it is written, tested in Node, and unproven on a phone.

You need two phones and about twenty minutes. Nothing here needs a developer.
Write down what actually happened, including "nothing happened", which is a
result.

---

### 6.1 The offline SMS appears by itself

**What this proves.** When her phone has no internet, the text to her emergency
contacts is put in front of her instead of sitting behind a button on another
screen.

**Read this before you start, or the test will fail for the wrong reason.**

- **Do NOT use Airplane Mode.** Airplane mode switches off the SMS radio too, so
  the message could never send even if everything worked. Turn off **Wi-Fi** and
  **mobile data** instead, and leave the SIM working. That is also the real
  situation this feature is for: signal, no data.
- **Do NOT use a Test SOS.** A test SOS deliberately skips this, so that
  practising never texts anyone by accident. You have to fire a real one.
- **Set your own second phone as the ONLY emergency contact first.** A real SOS
  texts whoever is in that list. Put everyone else back afterwards.

**Steps**

- [ ] On phone A, open Settings and remove every emergency contact except phone B
- [ ] Turn off Wi-Fi on phone A
- [ ] Turn off mobile data on phone A (leave the SIM on, you should still see bars)
- [ ] Go outside or near a window so it has a GPS fix
- [ ] Fire a real SOS and let the countdown run to zero

**What should happen**

- [ ] The app moves to the live SOS screen
- [ ] Within a second or two, the phone's own messaging app slides up on top
- [ ] The message is already written, addressed to phone B
- [ ] It says `ORBII SOS:` then your name, then `needs help now`
- [ ] It contains two numbers separated by a comma, like `28.99391,77.01604`
- [ ] It ends with a code starting `OB1:`
- [ ] You tap send **once** and it goes
- [ ] Closing the messaging app puts you back on the live SOS screen, not a blank one

**What each failure means**

| What you see | What it means |
|---|---|
| No composer at all | Either no emergency contacts, or the phone still had data |
| Composer appears but is empty | The message builder failed; capture a logcat |
| Your name is missing, it says "Someone" | Expected if your name is not written in English letters |
| Message splits into 2 or 3 parts | A real bug. Report it. It must always be one message |

- [ ] **Put your real emergency contacts back afterwards**

---

### 6.2 Fall detection is switched off

**What this proves.** The impact detector cannot start a countdown by accident,
because it is not running at all in this build.

It is off on purpose. Every threshold in it was worked out from published
research, not measured on the phones ORBII actually ships to, and until somebody
has dropped a real phone we do not trust it near an SOS.

**Steps**

- [ ] Open `src/services/volumetricShock.ts` (**not** `App.tsx`)
- [ ] Find the line `export const ENABLE_IMPACT_DETECTION`
- [ ] Confirm it says `false`

**Then check it behaves**

- [ ] Put the phone in your pocket and walk around for five minutes
- [ ] Set the phone down hard on a table, three times
- [ ] Drop the phone onto a bed or sofa from waist height, twice
- [ ] Confirm **no** countdown ever starts

Any countdown starting here is a serious bug. Note exactly what you were doing.

---

### 6.3 The app survives sitting offline

**What this proves.** The part of the app that carries other people's emergency
messages does not leak memory or crash while it waits for a connection.

**Steps**

- [ ] Turn off Wi-Fi and mobile data
- [ ] Open ORBII, sign in, then press home so it runs in the background
- [ ] Leave it for at least 10 minutes, longer if you can
- [ ] Come back to the app

**What should happen**

- [ ] The app is still running and opens instantly, not a fresh loading screen
- [ ] Nothing has crashed
- [ ] Turn Wi-Fi back on and leave it for a minute
- [ ] The app is still fine

If you can run `adb logcat -s ReactNativeJS`, you should see a line like
`[vault] js=0 native=0 cap=100 ttlMs=21600000 fromNative=true` when the app
starts.

- [ ] `fromNative=true` (if it says `false`, tell an engineer, nothing is broken
      but a setting is not crossing over correctly)
- [ ] No lines containing `Unhandled` or `Possible unhandled promise rejection`

---

### 6.4 Release gate for the offline engine

- [ ] 6.1 composer appears pre-filled, sends in one tap, stays one message
- [ ] 6.2 `ENABLE_IMPACT_DETECTION` is `false` and no countdown ever self-starts
- [ ] 6.3 ten minutes backgrounded and offline with no crash

Until 6.1 passes on a real phone, the honest description of the offline SMS
remains **"built, in hardware testing"**. The same rule as the mesh.

---

---

## Part 7: Referral attribution

Added Aug 2026, build 32.21.0 (26705), the first build that can capture a code
at all.

**Two routes in, and only ONE of them is testable before Play.** Read that before
testing, or you will spend an evening proving a working feature is broken.

| Route | How it arrives | Testable on a sideload |
|---|---|---|
| Play Install Referrer | Play Store carries `?referrer=` through the install | **No** |
| Typed code | Field on the profile setup screen | Yes |

---

### 7.1 Why the referrer route cannot be tested by sideloading

`captureInstallReferrer()` asks the Google Play Store what referrer string came
with this install. On a sideloaded APK the Play Store never handled the install,
so there is nothing to hand back. The library returns
`SERVICE_UNAVAILABLE` or `FEATURE_NOT_SUPPORTED` and the function resolves
`null`.

**That is correct behaviour, not a bug.** The field stays empty and the tester
types the code instead.

It also means the flag matters: the function records that it has already asked,
so it never reconnects on later launches. **If you sideload and then want to test
the Play route later, uninstall first.** Updating over the top keeps app data,
keeps the flag, and the referrer is never read.

---

### 7.2 Typed code, on a sideload (test this now)

Two phones. Phone A is the ambassador, phone B is the new user.

**Before you start:** an ambassador must exist. `sql/104` created `ORBII01` for
jaykumar2470f@gmail.com.

- [ ] Install 32.21.0 on phone B, fresh (not an update)
- [ ] Start signup, reach the profile setup screen
- [ ] In **Campus ambassador code (optional)**, type `ORBII01`
- [ ] Within a second the hint reads **"Recognised: SRM University Sonepat"**
- [ ] Finish setup and add one emergency contact

That hint is the test. It means the code was checked against the live database
before signup finished.

**Then, on phone A:**

- [ ] Open `orbii.in/ambassador`, sign in with the ambassador's email
- [ ] **Still to count** shows 1
- [ ] **People counted** shows 0

**Both numbers are correct.** A referral only becomes counted when the referred
user has verified their email, has an emergency contact, has somebody in their
circle who is NOT the ambassador, and 24 hours have passed.

- [ ] Add a third person to phone B's circle
- [ ] Wait 24 hours, or run `select public.ambassador_activation_sweep();`
- [ ] **People counted** becomes 1

---

### 7.3 What each failure means

| What you see | What it means |
|---|---|
| No hint under the field | Phone had no network, or the code does not exist |
| "Recognised" but nothing on the dashboard | `bindReferral` failed. Check logcat for `[referral]` |
| Counted stays 0 after 24h | Almost always the circle condition. Check `ambassador_activation_gap` |
| Dashboard says "not an ambassador yet" | Signed in with a different email than the `ambassadors` row |

The third row is the one to expect. **The circle requirement is the strictest
condition and the least obvious**, and it exists so an ambassador cannot vouch
for accounts they created themselves (sql/101).

---

### 7.4 Install Referrer, after Play (test post-launch)

Only possible once 32.21.0 is live on Play.

- [ ] Uninstall ORBII completely from the test phone
- [ ] Open, on that phone:
      `https://play.google.com/store/apps/details?id=in.orbii.app&referrer=ref%3DORBII01`
- [ ] Install from that page
- [ ] Open the app and reach profile setup
- [ ] The code field is **already filled** with `ORBII01`

If it is empty, check `adb logcat -s ReactNativeJS | grep referral` for
`captured from install referrer`. Absent means Play did not carry the string,
which usually means the link was not the route actually used to install.

---

### 7.3 Activation: turning a signup into money

**Status: the bind is proven (29 Aug, ORBII01 shows 1 signup). Activation has
never run.** This is the half that decides whether an ambassador is actually
paid, so it is the half a person will notice.

**What this proves.** That a bound referral survives the four anti-farming gates
and produces a real ledger credit. Until this passes once, the programme can
attribute a signup and cannot pay for one.

**You need THREE accounts, or two people.** This is the part that catches
everyone out, so read it before setting anything up:

| Account | Role |
|---|---|
| A | The ambassador. Owns ORBII01. `jaykumar2470f@gmail.com` |
| B | The referral. Types the code |
| C | B's circle member. **Must not be A** |

C is the whole point. `sql/101` requires a corroborating circle member who is
NOT the ambassador being paid, because otherwise one ambassador account vouches
for every account it created. A borrowed phone or a friend is easier than
juggling three logins on one handset, and the device cap is 3 per phone anyway.

**Steps**

1. Account B: sign up, type `ORBII01` at profile setup, finish.
2. Confirm on `/admin` that ORBII01 shows **signups 1, 1 waiting**.
3. Account B: add **any emergency contact**. A phone number in the box is enough.
4. Account C: sign up on a second phone.
5. Account B: invite C to B's circle. **C must accept.** A pending invite is not
   a membership and will not count.
6. **Wait 24 hours.** Not negotiable, it is checked against `created_at`.
7. `/admin` → Ambassadors → **Run sweep now**.
8. ORBII01 should read **counted 1**, and earned should move to Rs. 4.

**What each failure means**

| Symptom | Cause |
|---|---|
| Counted stays 0, waiting stays 1 | Almost always the circle condition. Check C accepted, and that C is not A |
| Sweep says activated 0 on the same day | 24 hours have not passed. Check B's signup time |
| Counted 1 but earned Rs. 0 | The ledger insert failed. Read `ambassador_ledger` directly |
| Referral shows `held_at` | Device cap. More than 3 activations from that phone |

Use the **"Why signups are not counting"** panel on `/admin` before doing any of
this by hand. It groups every stuck referral by the gate it is failing, in plain
English, and it will usually answer the question in one look.

**Then test the money.** Once counted is 1, the withdrawal threshold is Rs. 100,
so a single referral will not let you request a payout. To exercise that path
without twenty-five real signups, insert ledger rows by hand in SQL, request a
payout from `/ambassador`, approve it in `/admin`, and reverse the rows
afterwards. **The payout path has never run either**, and finding out it is
broken while an ambassador is waiting for money is the worst time.

---

### 7.5 Release gate for referrals

- [ ] 7.2 typed code recognised, and reaches the dashboard as "still to count"
- [ ] 7.2 converts to "counted" after the circle condition is met
- [ ] 7.4 install referrer prefills the field, on a real Play install

Until 7.4 passes, the only working route is the typed code, and the poster and
ambassador pack should tell people to type it rather than relying on the link.
