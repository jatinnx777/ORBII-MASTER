# ORBII — Play Console submission guide

Everything you need to paste into Play Console. Read the **verdict at the top**
first — it changes what track you should launch on.

---

## ⚠️ VERDICT: which testing track are you ready for?

| Track | Ready? | Why |
|---|---|---|
| **Internal testing** (≤100 invited testers) | ✅ **Yes, now** | Minimal review. Perfect for your first campus pilot. |
| **Closed testing** (invite/email-list, e.g. one campus) | ✅ **Yes** (once policy is live + Data Safety filled) | Light review. **This is the right way to do "one campus at a time."** |
| **Open testing** (anyone can join — "mass area") | ⚠️ **Not yet** | Full production-level review. Two real rejection risks below. |

**Your campus-by-campus strategy = closed testing per campus.** That's low-risk
on Play. **Do NOT jump to open testing yet** — fix the two items below first.

### The two things that can get OPEN testing / production rejected
1. **`SEND_SMS` (auto-send).** Google's SMS policy only allows `SEND_SMS` for
   default SMS handlers or a few exceptions; "emergency SOS" is a **gray area
   and is frequently rejected** for non-default-handler apps. For open testing
   / production, the safe path is to **switch the SMS fallback to the SMS
   *composer* (one tap to send)**, which needs **no** special permission. Tell
   me and I'll make that the Play build. (For internal/closed testing with your
   own testers, auto-SMS is fine.)
2. **Always-listening microphone foreground service.** High scrutiny. You'll
   need the prominent in-app disclosure (below), an accurate Data Safety form,
   and possibly a short demo video on request. Justifiable for a safety app, but
   expect questions.

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

**DO NOT declare audio/voice as collected.** Voice detection and SOS recordings
are processed and stored **only on the device and never sent off it**, so under
Play's definition that audio is **not "collected."** (Don't over-declare — it
must match reality, and reality is on-device only.)

---

## 3. App content declarations
- **Privacy policy URL:** your hosted link.
- **Ads:** No ads.
- **Target audience & content:** 16+ (or 18+). Not designed for children.
- **Data safety:** as section 2.
- **Foreground service:** declare the **microphone** foreground service. Use
  case: *"User-initiated, opt-in voice-activated emergency SOS. The app listens
  on-device for the user's chosen safety phrase and triggers an emergency alert.
  No audio leaves the device."*
- **Full-screen intent (`USE_FULL_SCREEN_INTENT`):** *"To show the SOS countdown
  over the lock screen when a voice trigger fires, so the user can cancel or let
  it dispatch without unlocking."*

---

## 4. Permissions declaration (Sensitive app permissions)

**`SEND_SMS`** (only if you keep auto-send for the Play build):
> ORBII is a personal-safety SOS app. When the user fires an SOS, ORBII sends
> the user's pre-set emergency contacts an SMS containing the user's live
> location, so help can reach them even with no internet connection or when the
> contact does not use the app. SMS is sent only as part of a user-initiated
> emergency and is core to the app's safety function. There is no in-app
> alternative that reaches non-app contacts offline.

> ⚠️ If this is rejected, ask me to switch to the SMS composer (one-tap), which
> removes the `SEND_SMS` permission entirely.

**`RECORD_AUDIO` + microphone foreground service:**
> Used only for opt-in, on-device voice-activated SOS. Audio is never recorded
> to a server or shared. The user explicitly enables Voice SOS.

---

## 5. Store listing notes
- **Prominent disclosure (required):** before requesting microphone/location,
  the app must show a plain-language notice of what's collected and why. (Your
  in-app permission prompts cover part of this; tell me and I'll add a one-time
  disclosure screen on first launch to be fully safe.)
- **Short description idea:** "One-tap SOS that alerts your circle and people
  nearby — works offline."
- Include the **safety disclaimer** (PRIVACY_POLICY §10) in the listing /
  in-app, so users don't treat ORBII as a guaranteed emergency service.

---

## Recommended launch path
1. **Internal testing** now → your first ~20–30 campus testers. (auto-SMS OK)
2. **Closed testing** per campus → invite by email list. (auto-SMS OK among your
   testers; policy must be live)
3. Before **open testing / production**: switch SMS to the composer (or win the
   SEND_SMS declaration), add the disclosure screen, and submit for full review.
