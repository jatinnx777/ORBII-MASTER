# ORBII Circles: how it actually works

A factual description of every Circles flow as built, for review against a
comparable product. Written from the shipping code and the applied database
migrations, not from a roadmap. Where something is unproven, it says so.

Platform: React Native (Expo SDK 54), Android shipping, iOS not shipped.
Backend: Supabase (Postgres + PostgREST + row-level security), Edge Functions.
Market: India. Version described: 32.48.0, September 2026.

---

## 0. The model

A **circle** is a small named group. One person owns it. Every member holds a
**role** (`owner`, `admin`, `member`) and optionally a **relation** they choose
for themselves (`mother`, `father`, `daughter`, `son`, `sister`, `brother`,
`partner`, `grandparent`, `friend`, `roommate`, `colleague`, `other`).

Role is what you may do. Relation is who you are. They are separate on purpose,
and **only the person a relation describes can set it**, so a flatmate cannot
be listed by someone else as their daughter. There is no free-text relation
field: a label every other member reads is not a place to write a sentence.

**Hard limits, enforced in the database, not the client:**

| Limit | Value | Where |
| --- | --- | --- |
| Members per circle, owner included | **4** | `circle_member_limit()`, enforced by a BEFORE INSERT trigger that takes `FOR UPDATE` on the parent circle so two simultaneous joins cannot both pass |
| Pending invites | Count toward the cap | so four valid invites cannot overfill a circle |
| Circles owned, free tier | **1** | client-side gate; more requires ORBII Plus, Rs 149/month |
| Circles joined | Unlimited, free | you never pay to be in someone else's circle |

Four is a deliberate product decision, not a paywall or a technical limit. The
stated reasoning in the migration: past roughly four people, a circle stops
being people who would actually come and becomes an audience.

---

## 1. Creating a circle

Four steps, one screen.

1. **Name it.** Minimum two characters.
2. **Pick a kind.** `family`, `friends`, `trip`, `college`, `women`,
   `emergency`, `general`. Kind sets the circle's colour.
3. **Photo.** Optional, skippable.
4. **Create.**

On create, in one database round trip:

- The circle row is inserted with `owner_id = auth.uid()`.
- A BEFORE INSERT trigger assigns a **six-letter join code**.
- An AFTER INSERT trigger adds the owner to `circle_members` as `owner`.

The profile photo, if one was picked, uploads **after** the circle exists and
is not awaited. It was previously awaited before the insert, which meant the
person who tapped "Create" waited out a 1 to 3 MB upload on a mobile uplink
before the request was even sent. Nothing about a circle depends on the photo.

If the person is on a phone-only demo profile with no real account, creation is
refused with an explicit message rather than a generic permission error.

---

## 2. Joining a circle

Three routes. There is **no directory search**, and that is the central design
decision in this whole feature.

### 2a. Join code (primary)

Six letters from a 22-letter alphabet: `ABCDEFGHJKLMNPRTUVWXYZ`. **I, O, Q and
S are excluded** because the code gets read aloud across a room and written on
paper, and I/1, O/0, S/5 is where that fails. 22^6 is about 113 million
combinations.

Flow: the owner reads the code out. The joiner types it. They are in.

Server-side, `join_circle_by_code()` (SECURITY DEFINER):

1. Rejects anonymous callers.
2. **Rate limits to six wrong codes per hour**, per user.
3. Uppercases and trims the input, so case and a stray space do not matter.
4. Returns `null` for no match, so a typo is a message and not an error.
5. Returns the circle id if the caller is **already a member**, so tapping join
   twice takes you to the circle instead of failing.
6. Refuses if the caller has been **revoked** from that circle. A revocation is
   a decision somebody made about a person, and a join code is not a way around
   it.
7. Refuses if the circle is full.
8. Otherwise inserts membership, un-deleting a previous tombstoned row if one
   exists.

The owner or an admin can **rotate the code** at any time via
`rotate_circle_code()`, which invalidates the old one. The server enforces who
may rotate; the client does not.

### 2b. Invite by username

`inviteByUsername()` writes a row to `circle_invites` with a token and an
expiry. The invitee sees it in their pending invites and accepts or declines.
Pending invites count against the four-person cap.

### 2c. Invite link / token

`acceptInviteByToken()` handles a deep link carrying an invite token, used
during first-run onboarding so someone invited before they installed the app
lands directly in the circle.

### What was deliberately removed

Adding people by **searching a directory** was removed in September 2026.
`find_user_by_phone` was revoked from the app role, and the app stopped writing
phone numbers into the public directory table entirely. The 31 numbers already
stored there were cleared.

The stated reasoning: a searchable directory of women who installed a personal
safety app is the worst asset this product could own, and every mitigation on
it (rate limits, exact match only, never returning the number) is a patch on a
hole that did not need to exist. A code inverts the model. Nothing is
enumerable, and the person joining must have been told the code by someone who
had it.

**This is a real functional trade.** A competitor with directory search makes
adding a friend one tap faster. ORBII gives that up on purpose.

---

## 3. Live location sharing

**Strictly opt-in. Off by default. Never automatic.**

### Starting it

The person picks a duration from a wheel: **30 minutes to 8 hours in half-hour
steps**, or **"Until I turn it off"**.

Then:

- **Hard stop for declared minors.** Anyone who has stated they are under 18
  cannot start location sharing at all. This is DPDP Rules 2025 Rule 10: a Data
  Fiduciary must not track, monitor or profile a child. The check lives inside
  the one function that can start tracking, so no caller can route around it.
  Voice SOS, circle alerts and one-tap 112 work normally for minors. Only
  continuous sharing is withheld. Users whose age was never asked are treated
  as adults, not as minors, because the date-of-birth field post-dates many
  accounts.
- Foreground location permission is required. Background is requested but
  **best-effort**: without it, sharing updates only while the app is open,
  which still works.
- A persistent Android foreground-service notification runs the whole time,
  reading "ORBII is sharing your location".
- One position is pushed immediately so the circle sees the person straight
  away rather than after the first interval.

### While running

- Updates every **60 seconds or 40 metres of movement**, whichever comes first,
  at balanced (not highest) accuracy.
- Each update carries position, GPS accuracy, **battery percentage**, **charging
  state** and **speed in km/h**.
- Speed is `null` rather than `0` when the platform will not say. Both Android
  and iOS report unknown speed as a negative number, and rendering that as
  0 km/h asserts "stationary" about a phone that never said anything.
- For a timed window, a notification warns **one hour before it ends**.
- The background task **self-stops** when the window expires, even with the app
  closed.
- "Until I turn it off" stores no expiry and schedules no warning. It runs until
  somebody stops it.

### Stopping it

Anyone can stop at any time, and nothing prevents that. A safety app you can be
locked into is a tracking device.

What is guaranteed instead is that **stopping is never silent**. When sharing is
turned off manually, everyone in the circle is told the time it stopped and the
last place that person was seen. That is information a circle can act on,
rather than a dot that quietly stopped moving.

Automatic expiry does **not** fire that alert, because the circle was already
warned an hour ahead and a second alarm would be noise.

### Precision control

Independently of on/off, each person chooses how precisely they are seen:

| Setting | Meaning |
| --- | --- |
| **Exact** | Position to within a few metres |
| **This street** (500 m) | Roughly which block. Enough to know she got home |
| **This neighbourhood** (2000 m) | The part of town, nothing narrower |

**The snap happens in the database, not in the app.** The true coordinate never
crosses the wire, so this is not a display setting a determined reader could see
past. The grid carries a per-user stable jitter, which prevents averaging many
readings back into a real point. When precision is set, the map must draw a
circle, not a pin.

**An active SOS ignores precision entirely**, and the UI says so, because a
neighbourhood is useless to somebody trying to reach her.

---

## 4. The circle map

A Leaflet WebView, satellite imagery only (Esri, keyless). Shows:

- A pin per sharing member, in a **fixed colour by their position in the
  circle's sorted roster**, so the same person is the same colour every session.
  With at most four people, four colours are always unambiguous.
- **Trails**: the last 12 hours of movement, per member.
- **Stops**: detected dwell points with duration.
- **Geofence rings** for any safe zones.
- **Freshness**, computed server-side and returned with each row rather than
  derived per screen. A fix from four minutes ago and one from four days ago
  used to arrive identically shaped, and one screen (the history sheet a parent
  actually reads) rendered a forty-minute-old pin exactly like a live one.
- **`unreachable`**: sharing is on and nothing has arrived for **20 minutes**.
  That is the shape of a dead battery, a basement, or a phone that was taken,
  and it is a state the circle should be told about rather than left to infer.

---

## 5. Check-ins

"I got home", without turning on a location stream.

The only way to tell a circle you were fine used to be leaving sharing on and
hoping somebody looked at the map. That trades a permanent stream of position
for one sentence sent once.

- Four one-tap presets: *Got home*, *Reached safely*, *On my way*, *All good*.
- Optional free-text note, **140 characters**.
- **Location attachment is OFF by default.** "I am safe" and "I am safe, and
  here is exactly where" are different messages and only one is always wanted.
  Defaulting it on would quietly turn a reassurance into a disclosure.

Check-ins land in a per-circle **feed** alongside arrivals and SOS events.

The 140-character note is the only free-text surface in the product. ORBII
removed messaging entirely in August 2026, and this is not a reopening of that
decision.

---

## 6. Safe zones (geofences)

A circle member can define a zone **on** another member, with that member's
knowledge.

- Drawn as **polygon corners on a map**, then reduced to the centroid and a
  radius covering the farthest corner, clamped **100 m to 5000 m**, because that
  is what the OS geofencing API can actually monitor.
- **Time windows**: a zone can be "expected inside" only between two times, in
  IST, and **overnight windows work** (22:00 to 06:00 for a hostel curfew).
  No window means all day.
- The person a zone is set on **acknowledges or declines it**. A zone is not
  something done to somebody silently.
- Leaving a zone during its active window raises an event, which the person can
  **authorise** ("yes, I meant to leave") or which **escalates** if unanswered.
  A cron job escalates stale unanswered leaves after 5 minutes.
- Zone history and visit durations are viewable.

This is the one Circles feature that is **premium-gated** (`circle_geofencing`).

---

## 7. Trips and replay

- A shared trip has a label, optional destination, start and end, and status
  (`active`, `arrived`, `expired`, `cancelled`).
- **Trip replay** plays back a member's recorded path on the map.
- A **day timeline** is derived from the trail: alternating stop and move
  entries with clock times, so a parent reads "home until 08:40, moving, college
  09:15 to 16:00" rather than a line on a map.

Related, outside Circles proper: **Safe Journey** lets someone start a trip with
an expected arrival time. If it lapses without arrival, ORBII starts an SOS
countdown on its own.

---

## 8. SOS, and how it changes everything above

This is the part the rest of the product exists for.

When an SOS is active:

1. **The person's location row is released regardless of sharing state.** She
   may have turned sharing on for the walk home and let it lapse two hours ago.
   Her mother opening the map during the emergency must not see a grey pin from
   nine o'clock.
2. **It is labelled as an emergency release, not as sharing.** Saying "sharing"
   would misstate what she agreed to and would outlive the emergency.
3. **It closes by itself when the SOS resolves.** The override lasts exactly as
   long as the emergency.
4. **Precision is ignored.** Exact position, even for someone normally at
   neighbourhood precision.
5. The circle receives push alerts; a server-side fan-out handles delivery.
6. The SOS trigger reason is carried through and shown, so the circle can read a
   crash differently from a manual tap. Current triggers: `manual`, `voice`,
   `impact`, `geofence`, `disaster`, `scream`, `shake`, `crash`.

The stated principle: an SOS **is** the consent request. A safety app whose
location sharing is unavailable during the one event it was installed for has
the feature and not the function.

---

## 9. Presence alerts

A scheduled server sweep, independent of anyone having the app open:

- **Low battery** on a sharing member.
- **Unreachable**: sharing on, nothing received for 20 minutes.

Each alert is de-duplicated so a circle is told once, not every sweep.

---

## 10. Leaving, removing, revoking

- **Leave**: any member may leave. Owners cannot leave; they delete the circle
  instead.
- **Remove**: owner and admins can remove a member.
- **Revocation**: a removal writes to `circle_revocations`, and a revoked person
  cannot rejoin by code. This is checked in the join path, the SOS fan-out, the
  location read and the feed read, so a revoked member stops receiving
  everything, not just stops appearing.
- Memberships are **soft-deleted** (`deleted_at`), and the unique index over
  live members is partial, so somebody removed and later re-added does not
  collide with their own tombstone.

---

## 11. Deliberate omissions

A reviewer should treat these as decisions, not gaps:

| Not built | Reason |
| --- | --- |
| **Messaging / chat** | Removed August 2026. A safety app is not a chat app, and a message thread is a place an abuser reads. |
| **Directory search for people** | Removed September 2026, replaced by join codes. See section 2. |
| **Circles larger than four** | Past four it is an audience, not people who would come. |
| **Driving reports / crash-free scores / weekly driving grades** | Not built. The crash detector exists, but scoring someone's driving is a different product. |
| **Location history beyond the trail window** | Trails are 12 hours by default. There is no permanent movement archive. |
| **Silent tracking of minors** | Legally prohibited in India and enforced in code. |

---

## 12. Honest limits

State of things as shipped, without varnish:

- **iOS is not shipped.** Android only.
- **Crash detection is armed but its thresholds are unvalidated.** They were
  reasoned from physics, not measured from real crashes. It is speed-gated
  (arms above 6.9 m/s), cancellable via countdown, labelled "possible crash",
  and has its own switch. It records every decision including rejections so the
  thresholds can improve from real road data. **Do not describe it as proven.**
- **Background location is best-effort.** Android OEM battery managers kill
  background services aggressively, and this is not fully solved.
- **Circle creation was broken in production for a day in September 2026** by a
  row-level-security policy that let the insert pass and then refused to let the
  owner read back the row they had just created. Fixed. Mentioned because a
  review of a flow should know where it has actually failed.
- **The four-person cap is untested at social scale.** It may be correct. It may
  turn out to be the reason someone picks a competitor.
- **Offline behaviour of circle features is limited.** SOS has an offline path
  (SMS and mesh relay). The circle map, feed and sharing do not.

---

## 13. One-line summary of the philosophy

Every Circles feature is built so that the person being seen controls how much
is seen, for how long, and can always stop, **except during an active SOS**,
where the emergency outranks the setting for exactly as long as the emergency
lasts.
