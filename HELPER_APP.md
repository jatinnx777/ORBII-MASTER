# ORBII Helper — outline for the dedicated responder app

Working notes for splitting verified helpers out of the main app. Written after
removing the signup flow from ORBII (v32.13.0); nothing here is built yet.

---

## Why it splits

The main app is for a woman who might need help. Every screen in it should
serve that. Asking her to upload an Aadhaar card so she can respond to other
people's emergencies is a different product wearing the same skin, and it made
the settings screen read like a gig-work signup.

There is a second reason, and it is the stronger one. The two apps have
**opposite privacy postures**:

| | ORBII | ORBII Helper |
|---|---|---|
| Identity | Pseudonymous is fine | Verified, real name, government ID |
| Location | Hers, guarded, opt-in, deleted nightly | Theirs, continuous while on duty, that is the job |
| Data held | As little as possible | Enough to be accountable for a rescue |
| If deleted | She loses protection | The network loses a responder |

Trying to serve both from one binary means one policy, one Data Safety
declaration, and one permission set that has to be the union of both. That
union is exactly the "safety app that tracks you" people are right to distrust.

---

## Scope of v1

Deliberately small. A helper app that does four things well beats one that
half-does twelve.

**1. Verification.** Aadhaar, PAN, selfie, live-match. Screens already exist at
`src/responder/ResponderApplicationScreen.tsx` and
`ResponderVerificationScreen.tsx` and can be ported nearly as-is; the upload
pipeline and status polling work.

**2. Duty toggle.** On duty / off duty, with a visible foreground notification
whenever location is being shared. Same non-negotiable as the main app: if we
know where someone is, their phone says so.

**3. Alerts and navigation.** Receive a dispatch, accept, navigate, enter the
arrival code. `HelperAlertScreen` and `HelperNavigationScreen` port over.

**4. Arrival codes.** The victim reads a code aloud once the helper is
physically in front of her, and only then can the rescue be closed. Nobody
completes a rescue they never attended. Already built in `sql/51`.

Not in v1: earnings, coins, leaderboards, chat, a social layer. They can wait
until someone has actually been helped.

---

## What the two apps share

Same Supabase project. Same tables. The split is at the client, not the data.

Ported from the main app:
- `services/supabase.ts`, auth, push tokens
- `services/mesh*` for offline relay
- The theme tokens, so both look like ORBII
- `Row` / `RowGroup` / `Glass*` primitives

Helper-only:
- Verification upload and polling
- Duty state and continuous location
- Dispatch queue and arrival codes

---

## The dispatch contract, now that waves exist

`sql/78` changed what a helper app has to handle. Dispatch is no longer one
shot:

1. Wave 1 goes to the 3 nearest available helpers.
2. If nobody arrives within 4 minutes, wave 2 goes to **3 different** people.
   `next_wave_helpers()` excludes anyone already dispatched.
3. If people arrive and the SOS is still open 90s later, the victim is asked
   directly whether she is safe.
4. No answer in 45s means another wave, up to 5.

Two consequences for the helper app:

- **A dispatch can arrive for an SOS other helpers are already at.** The UI must
  say so ("2 people are already there, it is still open") or arriving helpers
  will assume it is handled and stand around, which is the exact failure the
  escalation exists to catch.
- **Accepting is not arriving.** Only an entered code counts. The app should be
  blunt that tapping accept does nothing for her by itself.

---

## Unverified helpers stay in the main app

Worth being explicit, because it is easy to get backwards. Splitting the app
does **not** mean help becomes verified-only.

An ordinary ORBII user who is nearby and willing still gets the alert, the
distinct tone, the overlay and the edge glow, and can still respond. At current
density they are the only helpers that exist, and a neighbour who comes is worth
more than a verified stranger who does not.

Verification buys accountability, not permission.

---

## Play Store notes

- **Separate listing**, separate package id (`in.orbii.helper`).
- Its Data Safety declaration is genuinely different: continuous location,
  government ID documents.
- Continuous background location needs a prominent-disclosure video. For a
  responder app, "we share your location while you are on duty so we can send
  you the nearest emergency" is a clean, honest justification, much easier than
  the equivalent for a consumer app.
- The stalkerware policy is not a concern here in the way it is for ORBII: the
  person being located is the user, and they toggled it on.

---

## Rough order

1. New Expo project, port theme + supabase + auth.
2. Duty toggle and location publishing to `helpers_live`.
3. Alert reception, accept, navigate.
4. Arrival codes.
5. Verification upload.
6. Play listing and prominent-disclosure video.

Steps 1 to 4 are the product. 5 and 6 are what make it legal to grow.
