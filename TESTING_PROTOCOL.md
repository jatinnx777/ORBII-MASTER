# ORBII — Field Testing Protocol

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

## Part 1 — Acoustic: does it hear her

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

### 1.3 False positives — the test that protects the network

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

## Part 2 — RF: the mesh, which has never run

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
negotiated — do not assume Coded PHY was used just because the device supports
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

## Part 3 — Dispatch and escalation

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

## Part 4 — Observability

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

## Part 5 — Release gate

Do not ship a build claiming offline capability until every box holds:

- [ ] 1.3 false positives: **zero** across all five scenarios
- [ ] 1.1 in-hand and trouser-pocket detection ≥ 12/15 in all environments
- [ ] 1.5 survives 4 hours locked on Xiaomi, Oppo, Vivo and Samsung
- [ ] 2.1 mesh bring-up delivers a real alert
- [ ] 2.3 three-phone relay hop confirmed
- [ ] 2.4 relaying phone provably cannot read the payload
- [ ] 3.3 double-invoked escalation advances the wave exactly once
- [ ] 4.3 a deliberately broken drain produces a `fatal` row

Until 2.1, 2.3 and 2.4 pass, the honest description of the mesh remains
**"built, in hardware testing"**, on the website, in the deck, and in the room.
