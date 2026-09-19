# Circles / Safety Network v2: architecture map

Written before any sprint code is changed, as Part 2 requires. Everything here
is read off the shipping tree at 32.50.0 and the applied migrations, not from
the roadmap or from these files' own comments, which have been wrong twice this
week.

---

## THE HEADLINE FINDING

**Safety Journey already exists, and it is entirely local to her phone.**

- `SafeJourney` is declared in [appSlice.ts:7](src/redux/slices/appSlice.ts#L7) and
  lives only in Redux, persisted to disk by [persist.ts:98](src/redux/persist.ts#L98).
- It carries **one `trustedContactId`**, not circle recipients.
- `shared_trips` exists in the database (sql/09) with `circle_id`, `label`,
  `destination`, `start_at`, `end_at`, `status`. The app **only ever reads it**:
  `listSharedTrips` at [circles.ts:597](src/services/circles.ts#L597) is the sole
  reference, and nothing anywhere writes a row.

So today, when she starts a Safe Journey:

- her phone knows
- her phone can start an SOS if the ETA lapses
- **her circle is told nothing, and can see nothing**

Part 7 of the sprint is not "build Safety Journey". It is **"connect the Safety
Journey that already runs on her phone to the circle that cannot see it"**, and
the server table for it was written a year ago and never wired up.

That is the single highest-value change in this sprint, and it is also smaller
than the spec assumes.

---

## 1. Architecture map

### Circles core

| Thing | Where | State |
| --- | --- | --- |
| `circles` | sql/09, 10, 14, 44, 61, 131, 135 | Live. Owner + name + kind + colour + `join_code`. |
| `circle_members` | sql/09, 84, 85, 86 | Live. Soft-deleted, partial unique index over live rows. |
| Member cap | `circle_member_limit()` = **4**, sql/86 | Enforced by BEFORE INSERT trigger with `FOR UPDATE` on the parent circle. Pending invites counted separately in the same file. |
| Owned-circle cap | `FREE_CIRCLE_LIMIT = 1`, [entitlements.ts:107](src/services/entitlements.ts#L107) | **Client-side only.** No server check exists. |
| Join codes | sql/125, applied 19 Sep 2026 | 6 letters from a 22-letter alphabet, rate limited to 6 wrong per hour, revocation-aware. |
| Invites | `circle_invites` + `inviteByUsername` / `acceptInviteByToken` | Live. Token + expiry. |
| Revocation | `circle_revocations` | Checked in join, SOS fan-out, location read, feed read. |
| Relation | `set_my_circle_relation` RPC | Self-set only. |

### Location

| Thing | Where | State |
| --- | --- | --- |
| Sharing task | `CIRCLE_LOCATION_TASK`, [circle-location.ts](src/services/circle-location.ts) | `expo-location` background task, 60s / 40m, Balanced accuracy. |
| Duration | 30 min to 8 h, **or "Until I turn it off"** | The always-on option passes `0`, stores no expiry, schedules no warning. |
| Minor block | `getAgeStatus() === 'minor'` inside `startCircleSharing` | Hard stop, DPDP Rules 2025 Rule 10. |
| Freshness | `ageSeconds`, `unreachable` computed **server-side**, sql/118 | Already correct. Part 14 is mostly already done. |
| Speed | `null` preserved when platform won't say | Already correct. Part 14's warning is already respected. |
| Precision | sql/123, exact / 500 m / 2000 m, snapped **in the database** with per-user jitter | Already correct. |
| SOS override | sql/118 | Active SOS releases the row regardless of sharing, labelled `emergency`, closes itself. |
| Battery | `battery`, `charging` on each row | Present. Part 15 is partly done. |

### SOS

| Thing | Where | State |
| --- | --- | --- |
| Event table | `sos_events`, upserted at [sos.ts:270](src/services/sos.ts#L270) | Triggers: `manual`, `voice`, `impact`, `geofence`, `disaster`, `scream`, `shake`, `crash` (sql/130, applied today). |
| Fan-out | `notify-sos` Edge Function | Server-side push. |
| Escalation | [escalation.ts](src/services/escalation.ts) | Claim-based: one person claims `calling_112` / `going_there` / `reached`, everyone sees who. This is genuinely good and Part 9 should build on it, not replace it. |
| Offline path | SMS + mesh relay | Exists. |

### Safe Zones

| Thing | Where | State |
| --- | --- | --- |
| Zones | [geofence.ts](src/services/geofence.ts), sql/67, 96 | Polygon corners reduced to centroid + radius, clamped 100 m to 5000 m. |
| Windows | `active_from` / `active_to`, IST, overnight supported | Live. |
| Consent | `acknowledgeZone` / `declineZoneOnMe` | Zones are not applied silently. |
| Escalation | `escalate_stale_geofence_leaves(5)` cron | 5-minute unanswered escalation. |
| Gating | `circle_geofencing` entitlement | Premium. |

### Android

| Thing | Value | Risk |
| --- | --- | --- |
| Declared FGS types | See below. **Checked in the merged manifest, not the source one.** | No gap. |
| Background location | `ACCESS_BACKGROUND_LOCATION` present | Play policy declaration needed; unchanged. |
| Battery exemption | `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` present | Part 13 says do not request blindly. Needs an audit of where it is actually invoked. |
| Boot | `RECEIVE_BOOT_COMPLETED` present | |

Every foreground service in the **merged** release manifest, with its declared
type. Our hand-written `AndroidManifest.xml` declares only two services, so
reading that file alone suggests `location` is missing. It is not: the Expo
location module contributes its own service and its own type at merge time.

```
microphone        com.orbii.app.voice.VoiceGuardService
connectedDevice   com.orbii.app.mesh.OrbiiMeshService
location          expo.modules.location.services.LocationTaskService
microphone        expo.modules.audio.service.AudioRecordingService
mediaPlayback     expo.modules.audio.service.AudioControlsService
dataSync          com.google.android.play.core.assetpacks.ExtractionForegroundService
```

Read from
`android/app/build/intermediates/merged_manifest/release/processReleaseMainManifest/AndroidManifest.xml`
in the 32.50.0 build. **There is no Android 14 foreground-service-type gap**,
and no work is needed here. This started the sprint as a suspected
safety-critical defect and turned out to be nothing, which is the whole reason
Part 2 says to audit before changing anything.

### Realtime

Only **two** live subscriptions exist:

- [CircleMapScreen.tsx:345](src/screens/Circles/CircleMapScreen.tsx#L345), `postgres_changes` on circle locations
- [MissionsScreen.tsx:99](src/responder/MissionsScreen.tsx#L99), responder missions

Everything else polls. There is **no Broadcast usage anywhere**, so Part 12's
"Broadcast is 90% fewer calls" has no baseline to compare against in this
codebase.

### Notifications

11 Android channels already defined in [notifications.ts](src/services/notifications.ts),
including `safe-journey`, `sos`, `safe-zone`, `safe-zone-arrival`,
`geofence-leave`, `incoming_sos`. Part 10's channel work is largely built; the
gap is **language and triggers**, not plumbing.

### Edge Functions

`create-order`, `drain-push`, `escalate-sos`, `mesh-bridge`, `notify-geofence`,
`notify-location-share`, `notify-sharing-off`, `notify-sos`, `publish-blog`,
`purge-helper-docs`, `score-community`, `verify-payment`.

### Deep links

`app.json` declares **`scheme: "orbii"` and nothing else.** No
`intentFilters`, no App Links, no verified domain. Part 6's WhatsApp link flow
needs an App Links setup that does not currently exist.

---

## 2. What the sprint asks for that is already done

Worth knowing before spending effort:

| Sprint part | Status |
| --- | --- |
| **14, Location truth model** | Mostly done. `ageSeconds`, `unreachable` and `speed = null` are already correct and server-computed. Needs the explicit state enum and UI, not new plumbing. |
| **15, Battery visibility** | Data is collected. Needs UI and escalation rules. |
| **16, SOS flow** | Most of it exists, including claim-based escalation, which is better than what the spec describes. |
| **17, Dispatch honesty** | Already respected. Nothing in the app claims responders were dispatched. |
| **20, Purpose-bound sharing** | This is already ORBII's design. |
| **25, What not to build** | Already true: no chat, no directory, no social feed. |

## 3. What is genuinely missing

| Gap | Size |
| --- | --- |
| **Safety Journey is invisible to the circle** | The big one. Table exists, writes do not. |
| **No journey state machine** | No `JOURNEY_OVERDUE` / `ATTENTION` states server-side. |
| **Owned-circle limit is client-side** | A modified client can create unlimited circles today. |
| **Family cap of 8** | `circle_member_limit()` is a constant, not per-kind. |
| **No App Links** | WhatsApp invite flow cannot work without them. |
| **No receiver-without-app** | Nothing exists. |
| **No incident timeline table** | Events exist scattered; no single ordered record. |

---

## 4. Feature classification, as Part 1 requires

**A, safety-critical:** journey visible to circle; journey overdue escalation;
SOS state improvements; location freshness surfaced; FGS type correctness.

**B, daily safety utility:** Walk With Me; battery visibility; safe-zone
arrival confirmation; notification language.

**C, coordination:** family cap of 8; multiple owned circles; invite sharing.

**D, retention:** incident timeline.

**E, parity:** receiver-without-app.

**F, scope creep, not doing:** behavioural scoring, AI danger inference,
campus platform, dispatch partners that do not exist.

Order of work follows A, then B, then C.

---

## 5. Proposed Phase 1, in the required format

### 5.1 Safety Journey becomes visible to the circle

**CURRENT** `SafeJourney` in Redux only, one trusted contact, no server row.
`shared_trips` exists and is never written.

**CHANGE** Write a `shared_trips` row on journey start; update status on
arrival, cancel and overdue; read it in the circle UI. Extend the table with
`eta_at`, `kind` and a `journey_state` enum.

**WHY** Without this the product's core loop does not reach the people it is
for. Part 7 is unimplementable otherwise.

**RISKS** A journey row is a location-adjacent disclosure; it must respect
revocation and precision. Writing on start adds a network call to a flow that
must work offline, so the write has to be best-effort and the local guard must
remain authoritative.

**VALIDATION** Start a journey with the network off and confirm the local
countdown and SOS still fire. Start one online and confirm a second device in
the circle sees it. Confirm a revoked member sees nothing.

### 5.2 Per-kind member cap

**CURRENT** `circle_member_limit()` returns a constant 4.

**CHANGE** Take the circle kind: `family` returns 8, everything else 4. Keep
the trigger and the `FOR UPDATE` lock exactly as they are.

**WHY** Product hypothesis, explicitly not a validated market fact.

**RISKS** Changing a cap upward is safe; the concurrency guard is untouched.
The pending-invite counter in sql/86 reads the same function and must be
checked to see that it picks up the new value rather than its own constant.

**VALIDATION** Fill a family circle to 8 and a friends circle to 4, then
attempt one more of each and read the error text.

### 5.3 Owned-circle limit moves server-side

**CURRENT** Client-side only, `FREE_CIRCLE_LIMIT = 1`.

**CHANGE** A BEFORE INSERT trigger on `circles` counting owned circles, with
the premium check read from the existing server-side entitlement source, never
from the client. Free moves 1 to 2.

**WHY** A client-side paywall is not a paywall.

**RISKS** If the server cannot see premium status reliably, paying users get
locked out, which is worse than free users getting extra circles. This must be
verified against the real entitlement source before the trigger is armed.

**VALIDATION** Confirm the trigger's premium read matches what the app shows
for a known Plus account, before enforcing.

---

## 6. Honest status of the claims in this document

**VALIDATED** (read directly from code or a live database query today): every
table, policy, limit and file reference above; that `shared_trips` is never
written; that the owned-circle check is client-side; that only two realtime
subscriptions exist; that `app.json` has no intent filters.

**ASSUMED**: nothing material is left in this category. The one item that was
here, a suspected missing `location` foreground-service type, was checked
against the merged manifest of the 32.50.0 build and is **not a defect**. It is
recorded above as a corrected finding rather than deleted, because "we thought
this was broken and it was not" is worth as much to the next person as a real
bug.

**UNPROVEN**: that 8 is the right family cap. That Broadcast would reduce
battery use here. That an overdue-journey escalation will not produce false
alarms at a rate that trains people to ignore it.

**NEEDS REAL-WORLD TESTING**: everything in Part 13. There is no OEM matrix,
no battery baseline, and no stale-location rate measured. Nothing in Part 12
should be changed until those numbers exist, and I will not produce a
percentage without measuring one.
