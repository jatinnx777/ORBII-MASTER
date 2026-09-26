# ORBII — Play Console submission guide

Everything you need to paste into Play Console. Read the **verdict at the top**
first — it changes what track you should launch on.

---

## ⚠️ VERDICT: which testing track are you ready for?

| Track | Ready? | Why |
|---|---|---|
| **Internal testing** (≤100 invited testers) | ✅ **Yes, now** | Minimal review. Perfect for your first campus pilot. |
| **Closed testing** (invite/email-list, e.g. one campus) | ✅ **Yes** (once policy is live + Data Safety filled) | Light review. **This is the right way to do "one campus at a time."** |
| **Open testing** (anyone can join — "mass area") | 🟡 **Feasible** (rejection risks fixed) | Full production-level review; the one remaining scrutiny item is the mic foreground service. |

**Your campus-by-campus strategy = closed testing per campus.** That's the
lowest-risk path on Play and the recommended way to start.

### ✅ Update: the two rejection risks are now FIXED in the app
1. **`SEND_SMS` — REMOVED.** ✅ Auto-send is gone. SMS now uses the system
   **composer** ("Text my contacts" button on the SOS screen → one tap to send),
   which needs **no** special permission. No SMS policy review, no rejection
   risk. (Verify: the APK manifest no longer contains `SEND_SMS`.)
2. **Prominent disclosure — ADDED.** ✅ A one-time "How ORBII uses your data"
   screen now appears on first launch, before any permission request.

**Remaining scrutiny (not a hard blocker):** the **always-listening microphone
foreground service**. Declare it accurately (section 3), keep the disclosure,
and be ready to provide a short demo video if Google asks. Justifiable for a
safety app.

---

## 1. Before you submit
- [ ] Host the privacy policy (PRIVACY_POLICY.md) at a public URL, e.g.
      `https://orbii.app/privacy`, and put that URL in Play Console → **App
      content → Privacy policy**.
- [ ] Fill the **Data Safety** form (section 2).
- [ ] Fill **App content** declarations (section 3).
- [ ] Add the **Permissions declaration** for SEND_SMS (section 4) — or remove
      auto-SMS for the Play build.

---

## 2. Data Safety form answers

**Does your app collect or share user data?** → **Yes**.
**Is all data encrypted in transit?** → **Yes**.
**Do you provide a way to request data deletion?** → **Yes** (email request).

Declare these data types as **Collected** (and "linked to the user", purpose:
**App functionality**; not for ads):

| Data type | Collected | Shared* | Notes |
|---|---|---|---|
| Name | Yes | No | Account + shown to your circle during SOS |
| Email address | Yes | No | Only if you sign in with Google |
| Phone number | Yes | No | Account + emergency contacts |
| Photos (profile) | Yes | No | Optional profile photo |
| Precise location | Yes | No | In-use / during SOS only. **Not** background |
| Contacts (emergency contacts you add) | Yes | No | Name + phone of contacts you enter |
| Push token / Device IDs | Yes | No | To deliver SOS notifications |
| Crash logs | Yes | No | Reliability |
| Diagnostics | Yes | No | Reliability |
| Purchase history | Yes | No | If you subscribe (via Razorpay) |

\* "Shared" in Play's sense = transferred to **third-party companies**. Your
service providers (Supabase, FCM, Razorpay) are processors, not "sharing", and
location shown to **other ORBII users during an SOS** is core functionality
disclosed in the policy — you generally answer **No** to "shared" but you MUST
describe the user-to-user visibility in the privacy policy (it is, in
PRIVACY_POLICY.md §4).

**DO declare audio as collected. The opposite instruction used to sit here and it
was wrong.** It said SOS recordings never leave the device. They always have: every
real SOS uploads the clip, plus a short pre-roll, to the private `sos-recordings`
bucket. Following the old advice would have been a Data Safety misdeclaration,
which is the kind Google removes apps for.

The correct split, and say it this way:

- **Voice-trigger listening: NOT collected.** Processed on-device, never uploaded,
  never stored, not even on the phone. Under Play's definition that is not
  collection.
- **SOS clip: COLLECTED.** Audio → Voice or sound recordings. Shared: No. Optional
  (denying the microphone stops it and the app still works). Purpose: App
  functionality. Retention: 90 days, enforced by `purge-sos-audio` (sql/149), and
  the owner can delete it sooner from History.

PLAY_CONSOLE_ANSWERS.md already had this right. This file was the one that
disagreed.

---

## 3. App content declarations
- **Privacy policy URL:** your hosted link.
- **Ads:** No ads.
- **Target audience & content:** 16+ (or 18+). Not designed for children.
- **Data safety:** as section 2.
- **Foreground service:** declare the **microphone** foreground service. Use
  case: *"User-initiated, opt-in voice-activated emergency SOS. The app listens
  on-device for the user's chosen safety phrase and triggers an emergency alert.
  The listening audio is never uploaded or stored. During an active SOS only, a
  short clip is uploaded to private storage the user alone can read, as evidence,
  and is deleted after 90 days."*
- **Full-screen intent (`USE_FULL_SCREEN_INTENT`):** *"To show the SOS countdown
  over the lock screen when a voice trigger fires, so the user can cancel or let
  it dispatch without unlocking."*

---

## 4. Permissions declaration (Sensitive app permissions)

**`SEND_SMS`** — ✅ **Not applicable.** The app no longer uses it (SMS goes
through the system composer). Nothing to declare.

**`RECORD_AUDIO` + microphone foreground service:**
> Used for opt-in voice-activated SOS. Trigger-word detection runs entirely
> on-device and that audio is never uploaded or stored. During an active SOS the
> app records a short clip and uploads it to a private bucket readable only by the
> user who raised it, as evidence; it is deleted after 90 days and the user can
> delete it sooner. Audio is kept for that purpose and no other: no ambient
> recording, nothing between emergencies. The user explicitly enables Voice SOS.

---

## 5. Store listing notes
- **Prominent disclosure:** ✅ done — a one-time "How ORBII uses your data"
  screen now shows on first launch before any permission is requested.
- **Short description idea:** "One-tap SOS that alerts your circle and people
  nearby — works offline."
- Include the **safety disclaimer** (PRIVACY_POLICY §10) in the listing /
  in-app, so users don't treat ORBII as a guaranteed emergency service.

---

## Recommended launch path
1. **Internal testing** now → your first ~20–30 campus testers.
2. **Closed testing** per campus → invite by email list (policy must be live).
3. **Open testing / production** → now feasible (SEND_SMS removed + disclosure
   added). Submit for full review; just declare the mic foreground service
   accurately and be ready with a demo video if asked.
