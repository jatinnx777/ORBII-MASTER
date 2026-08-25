# ORBII, Play Store Permissions & Compliance Pack

This is your defense against a Play Store rejection. ORBII requests **background
microphone** and **background location**, the two most heavily scrutinised
permissions on Google Play. Rejections here are common and kill launch momentum.
Follow this and you clear the bar.

There are three things Google checks:
1. A **prominent in-app disclosure** shown BEFORE you request the sensitive
   permission (mic / background location), with accept/decline options.
2. A **Data Safety form** that matches what the app actually does.
3. A **privacy policy** that documents each permission (done, at
   orbii.in/privacy-policy, "Permissions We Request and Why").

---

## 1. In-app prominent disclosure (REQUIRED, show before the permission prompt)

Google requires a disclosure screen in your own UI, before the system
permission dialog, that says what data is accessed, why, and that it happens in
the background. Use copy like this.

### Microphone / Voice SOS disclosure

> **ORBII needs to listen for your SOS word**
>
> To trigger help hands-free, ORBII listens for your chosen distress word using
> your microphone, even when the app is closed or your screen is off.
>
> Your audio is processed entirely on your device to detect that word. It is
> never recorded, uploaded, or shared during normal use.
>
> [ Allow microphone ]   [ Not now ]

### Background location disclosure

> **ORBII needs your location during an emergency**
>
> When you trigger an SOS or start a Safe Journey, ORBII shares your live
> location with your trusted circle so they can reach you, even if your phone
> locks or the app is in the background.
>
> ORBII does not track or store your location at any other time.
>
> [ Allow location ]   [ Not now ]

**Rules:**
- Show this screen BEFORE calling the Android permission request, not after.
- The user must be able to decline and still use the rest of the app.
- Do not bury this in the privacy policy or a settings menu; it must be a
  clear, standalone in-context screen.

---

## 2. Data Safety form answers (fill in Play Console exactly like this)

Answer honestly, your on-device design is an advantage here.

**Does your app collect or share user data?** Yes (collect), and share only in
the limited ways below.

| Data type | Collected? | Shared? | Purpose | Notes |
|-----------|-----------|---------|---------|-------|
| Approx. + precise location | Yes | Yes (with the user's own trusted circle / verified responders during SOS) | App functionality (emergency) | Only during active SOS or Safe Journey. Not for tracking or ads. |
| Name | Yes | No | Account, personalisation | From Google Sign-In |
| Email address | Yes | No | Account | From Google Sign-In |
| Phone number | Yes (optional) | Shared with the user's own circle | App functionality | User-provided |
| Contacts (emergency contacts the user adds) | Yes | No | App functionality | Only the contacts the user adds |
| Photos (profile / responder docs) | Yes (optional) | No | Account / responder verification | Responder docs stored privately |
| Voice or sound recordings | **Yes** | No (private bucket) | App functionality (safety) | SOS **incident** recordings ARE uploaded during an active SOS (kept up to 90 days). The **voice-trigger detection** is separate and stays on-device. |
| Other user-generated content | Yes (only if community feed is enabled) | Yes (visible to other users) | App functionality / social | Community feed posts & comments. Skip this row entirely if the feed is disabled for launch. |
| App activity / diagnostics | Yes | No | Analytics, crash reporting | Standard |

**Key declarations to tick:**
- Data is encrypted in transit: **Yes**
- Users can request data deletion: **Yes** (orbiisafety@gmail.com, in-app)
- Committed to Play Families policy: only if you target children (you do not, target adults)

**IMPORTANT on Audio (two different things):**
1. **Voice-trigger detection** runs entirely on-device and is never uploaded, this
   part is NOT collected.
2. **SOS incident recordings** ARE uploaded to a private storage bucket during an
   active SOS and kept up to 90 days, so **"Voice or sound recordings" must be
   declared as collected.** Do not tick "not collected".
Either way, you MUST still show the microphone disclosure above so reviewers
understand why a safety app holds background mic.

---

## 3. App content / declarations checklist

- **App category:** Health & Fitness (or Lifestyle). Safety fits Health & Fitness well.
- **Target audience:** Adults (18+ or 13+, not children). Avoids the Families programme.
- **Privacy policy URL:** https://orbii.in/privacy-policy
- **Foreground service:** In your Play Console "App content", declare the
  foreground service type. ORBII's is best declared as `microphone` (and/or
  `location` while an SOS is active). Android 14+ requires the manifest
  `foregroundServiceType` to match, make sure the manifest and the declaration agree.
- **Sensitive permissions form:** You will be asked to justify background
  location and microphone in a short text box. Reuse this:

  > ORBII is a personal safety app. Background microphone is used only to detect
  > the user's hands-free SOS trigger word, processed entirely on-device; the
  > audio is never recorded or uploaded. Background location is shared with the
  > user's own trusted contacts only during an active SOS event so help can reach
  > them. Neither permission is used for tracking, advertising, or any purpose
  > beyond the core safety feature. On-device processing is documented in our
  > privacy policy.

- **Demo video (often required for background location/mic):** Record a short
  screen capture showing the disclosure screen, the user granting permission,
  and the SOS feature working. Reviewers frequently ask for this. Have it ready.

---

## 4. Common rejection reasons (avoid these)

- Requesting mic/location permission with NO in-context disclosure first. (#1 above fixes this.)
- Data Safety form not matching real behaviour.
- `foregroundServiceType` in the manifest not matching the declared use.
- Privacy policy that does not mention the specific permissions. (Fixed.)
- Claiming a health/medical emergency capability you cannot back up. Keep copy to
  "alerts your contacts", never "guarantees rescue" or "notifies police" unless true.
