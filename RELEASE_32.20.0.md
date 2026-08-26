# ORBII 32.20.0 (build 26704)

Android only. `in.orbii.app`, arm64-v8a, 24 native libraries, all 16 KB aligned.

**Supersedes 32.19.0 and 32.18.0, neither of which was published.** If either is
sitting in a Play Console draft, discard it: uploading one consumes its
versionCode permanently and forces another bump.

---

## What this release actually is

A security release with two dormant features attached. Almost nothing in it is
visible to a user.

Nine defects were found in an audit of code written the same week, two of them
critical, and all nine are fixed. Six database vulnerabilities were closed and
verified against the production database rather than merely committed.

---

## Security

Six vulnerabilities closed. Every one confirmed live, not assumed from a
successful migration.

| Issue | Effect if exploited | Fix |
|---|---|---|
| Safety PIN stored in plaintext | Filesystem dump brute-forces a 4-digit space instantly and disables an active SOS | Keystore prefix corrected; migration moves existing hashes |
| `circle_visits` was `SECURITY DEFINER` with no caller predicate | Any signed-in account could read every user's location history: name, zone, arrival and departure times | `SECURITY INVOKER` plus an explicit predicate; `prosecdef` asserted in the verify block |
| RLS infinite recursion on `circle_members` | Circles feature entirely offline (42P17) | `is_circle_member()` `SECURITY DEFINER` helper, the pattern this repo had already used twice |
| `shares_circle_with()` counted tombstoned rows | A removed circle member kept the ability to geofence someone still in it | `deleted_at is null` on both sides of the join |
| `orbii_can_access_sos()` ignored soft deletes | A removed member could subscribe to a victim's live SOS location | Both branches now require live membership |
| `sos_responders` insert policy checked `user_id` but not `sos_id` | Three logins could occupy every capped responder slot on a real emergency. Genuine helpers are then told, correctly, that enough people are coming. Nobody comes | Direct insert revoked; `accept_sos_dispatch()` is the only way in |

**That last one was a regression introduced by the responder cap five commits
earlier.** Before the cap it was cosmetic noise on the victim's screen. The cap
turned it into a denial of rescue.

### Not fixed, and cannot be

`public.spatial_ref_sys` is owned by `supabase_admin`. `anon` holds write
privileges on it and we cannot revoke them, enable RLS on it, or move PostGIS out
of the public schema. Confirmed by a POST returning **400 on a CHECK constraint,
not 401**, meaning authorization passed.

It contains no user data, but every distance in ORBII resolves SRID 4326 through
it. Corrupting that row makes coverage gating and helper ranking return wrong
answers silently.

Mitigation shipped: `sql/95` runs a `pg_cron` job every five minutes that
verifies the definition against a known-good value read from the live database
and restores it if changed, logging to a `security_events` table that clients
cannot read. A Supabase support ticket is open.

---

## Audit fixes

Nine findings, all closed.

**Critical**

- **Sensor gaps counted as stillness.** The impact detector measured its
  four-second window against the newest sample without checking samples had been
  arriving. Android throttles sensors in background and battery saver, so:
  impact, app backgrounded, phone set on a table, app resumed, and the first
  sample satisfied a window nothing observed. A false SOS. Now a gap wider than
  four sample intervals abandons the watch.
- **Concurrent vault writes destroyed.** `flushVault` snapshotted storage, spent
  the network window, then blind-wrote. A `vaultHold` from the native mesh
  listener landing in that window was erased with no error and no log. Now
  re-reads and merges on `msgId`, with delivered ids removed.

**High**

- **A dead network emptied the vault.** The catch block said "stop trying the
  rest now" and then continued the loop, charging an attempt to every remaining
  packet against a connection known to be down. Flapping wifi reached
  `MAX_ATTEMPTS` in minutes and silently pruned other people's emergencies.
- **Non-Latin names erased from emergency SMS.** GSM-7 stripping reduces
  Devanagari to a single space, and `|| 'Someone'` did not catch it because a
  space is truthy. The message read `ORBII SOS:  needs help now`. Names must now
  survive 60 percent intact or fall back cleanly.

**Medium and low**

- Nearest-landmark search used a fixed 150 m radius, skipping buildings wider
  than 300 m and naming a farther one instead. Now per-polygon.
- The single-part SMS guard did not re-measure its own output.
- A timed-out online dispatch that landed anyway was reported as an SMS
  delivery. New `route: 'online_late'`.
- `MeshVault.read()` ran a synchronous `commit()` on the bridge thread on every
  status read. Now `apply()`, and only when pruning removed something.
- `circle_visits` scanned all geofence history with a correlated subquery. Now
  bounded to 30 days with two supporting indexes.

**Two of these were found by tests written for other fixes**, including a
regression introduced in the same change: `req.transmitOnline()` was called
outside its `try`, so a caller throwing synchronously escaped `dispatchSOS`
entirely and became an unhandled rejection during an emergency.

---

## Features

**Continuous SOS haptic pulse.** Runs for the length of an active SOS, survives
a screen lock, stops the instant the safety PIN verifies, before the
cancellation touches the network. Honours the user's alert-vibration setting
rather than overriding it: somebody who turned vibration off on a safety app most
likely did it because a buzzing phone gives away where she is hiding.
**Confirmed on hardware.**

**Offline SMS surfaced automatically.** When the phone has no data at the moment
an SOS fires, the pre-filled composer now opens over the live SOS screen instead
of waiting behind a button. Purely additive: `enqueueSOS`, `armOfflineSos` and
`armHelperPing` are untouched. It surfaces the one route needing a human hand,
because `SEND_SMS` is Play-restricted and the composer cannot send itself.
**Untested on hardware.**

**Impact detection.** Wired and **disabled** (`ENABLE_IMPACT_DETECTION = false`).
It opens the countdown, never `createSOS` directly. Every threshold was reasoned
from published fall-detection ranges, not measured on the phones ORBII ships to.

**Mesh vault.** Native store-and-forward for relayed SOS packets a phone caught
but could not upload. Closes a real hole: `tryBridge` previously dropped the
packet with the comment "someone else bridges", and when nobody in range had
internet the SOS died on a stranger's phone. **Untested on hardware.**

---

## Verification

| | |
|---|---|
| Unit tests | 107 across 7 files, all passing |
| Typecheck | clean |
| Kotlin | `compileReleaseKotlin` clean, no `MeshVault.kt` warnings |
| CI | GitHub Actions green on a clean Linux checkout |
| Migrations | 84 through 96 applied and verified against production |
| APK | 16 KB alignment verified on all 24 libraries |

### What is NOT verified

**Nothing in this release was tested on a physical phone except the haptic
pulse.** The offline SMS surfacing, the mesh vault's native persistence, and the
impact detector are all written, reviewed, tested in Node, and unproven on
hardware.

`TESTING_PROTOCOL.md` Part 6 is the checklist that would change that. Until 6.1
passes, the honest description of the offline SMS remains **"built, in hardware
testing"**, on the website, in the deck, and in the room.

---

## Deployment

1. `sql/84` through `sql/96`: **already applied and verified 27 Aug**
2. Upload `ORBII-v32.20.0.aab` to Play Console
3. Check the rollout percentage. A staged rollout below 100 percent means most
   users never receive this
4. Run `TESTING_PROTOCOL.md` Part 6 on two physical phones

### Play Console release notes

Nothing user-facing changed between 32.18.0 and 32.20.0. The differences are
security fixes, which correctly do not go in store notes. Use
`scratchpad/release-notes-32.18.0.txt` (462 characters, inside the 500 limit).

---

## Known open items

- `spatial_ref_sys` write access. Guarded, ticket open with Supabase
- Impact detection disabled pending hardware calibration
- SOS channel epochs disabled (`SOS_CHANNEL_EPOCH_ENABLED = false`)
- No verified responders in the pool. The dispatch engine is complete and has met
  zero real load
- `src/services/` remains 60+ flat files with three SMS paths
- iOS does not exist
