# ORBII — Play Console Answer Sheet

Everything to paste/select in Play Console, plus the testing-track how-to.
Written for the app as it actually ships (targetSdk 36, foreground-service
microphone, foreground-only location, Google Sign-In, responder KYC).

> Razorpay in-app purchase is intentionally left in for now. Before you go to
> **production** you must either move Premium to Google Play Billing or hide the
> in-app purchase — see "Known landmine" at the bottom. It's fine for closed
> testing.

---

## 1. Testing track — what it is + how to do it yourselves

**Tracks (from least to most public):**
- **Internal testing** — up to 100 testers, live in minutes. Best for your own quick checks.
- **Closed testing** — invite testers by email list / Google Group.
- **Open testing** — anyone with the link.
- **Production** — the public store.

**The rule that affects you:** if your developer account is a **personal**
account created after **13 Nov 2023**, Google requires a **closed test with ≥ 12
testers who opt in and stay for 14 continuous days** before you can apply for
production. (Organisation accounts are exempt.)

**How to do it yourselves — step by step:**
1. Play Console → create the app → **Testing → Closed testing → Create track** (or use the default "Alpha").
2. **Testers tab → create an email list** of at least **12 people** (real Google accounts — your campus pilot cohort is perfect). Or make a Google Group and add it.
3. **Upload the AAB** to the closed track, add release notes, roll out.
4. Copy the **opt-in URL** and send it to your 12+ testers. Each must **click it, join, and install** from Play.
5. Keep **≥ 12 testers opted in for 14 continuous days** (don't let people leave the list).
6. After 14 days, Play Console shows **"Apply for production access"** — fill the short questionnaire about your testing.
7. Once granted, **promote the closed release to Production.**

**Tip:** run **Internal testing in parallel** (up to 100 testers, no 14-day
wait) so you can iterate fast while the 14-day closed-test clock runs.

**You can 100% do this yourselves** — the only external requirement is 12 real
humans with Google accounts who stay opted in for two weeks.

---

## 2. App access (reviewer login) — REQUIRED because sign-in is mandatory

The reviewer can't get past Google Sign-In without help. In
**App content → App access → All or some functionality is restricted**, add an
instruction:

> ORBII requires Google Sign-In. Please sign in with any Google account — a
> profile is created automatically, no approval needed. All core features
> (SOS button, live location, Voice SOS, emergency contacts) are available
> immediately after sign-in. Premium features can be unlocked with coupon code
> ORBII (Profile → ORBII plans → enter coupon). Responder/KYC features are
> optional and reached via Profile → "Become an ORBII Responder".

(If Google can't use Google Sign-In in review, provide a test email/password
account you create in Supabase and give those credentials here instead.)

---

## 3. Data Safety form — exact answers

**Does your app collect or share user data?** → **Yes.**
**Is all data encrypted in transit?** → **Yes.**
**Do you provide a way to request data deletion?** → **Yes** (in-app: Profile →
Delete account; and email orbiisafety@gmail.com). Deletion URL:
`https://orbii.in/privacy-policy`.

**Data collected (mark each: Collected = Yes, Shared = No, Processed
ephemerally = No unless noted, Required/Optional as shown, Purpose = App
functionality unless noted):**

| Category | Data type | Collected | Optional? | Purpose |
|---|---|---|---|---|
| Location | Approximate location | Yes | Required | App functionality (send your location during an SOS/Safe Journey) |
| Location | Precise location | Yes | Required | App functionality (accurate SOS location) |
| Personal info | Name | Yes | Required | App functionality, Account management |
| Personal info | Email address | Yes | Required | App functionality, Account management |
| Personal info | Phone number | Yes | Optional | App functionality |
| Personal info | Other (emergency contacts you add) | Yes | Optional | App functionality (who to alert) |
| Photos and videos | Photos | Yes | Optional | App functionality (profile photo; responder ID verification) |
| Audio | Voice or sound recordings | Yes | Optional | App functionality (audio recorded during an active SOS to document the incident) |
| Financial info | Other financial info (payout UPI/bank — responders only) | Yes | Optional | App functionality (pay responder earnings) |
| App info & performance | Crash logs | Yes | — | Analytics / stability |
| App info & performance | Diagnostics | Yes | — | Analytics / stability |
| Device or other IDs | Device or other IDs (push token) | Yes | — | App functionality (emergency push notifications) |

**Data shared with third parties?** → **No.** (Data is stored with our
processor Supabase and, during an emergency, your location/alert is sent to the
contacts and responders *you* choose — a user-initiated transfer, not sharing
with third-party companies.)

**Important clarification to note in the form:** the **always-on Voice SOS
listening is processed entirely on-device and is never uploaded or collected.**
Only audio recorded during an *active* SOS is stored. Make sure your listing
copy says this too.

---

## 4. Foreground Service declaration (microphone) — REQUIRED

Play Console → App content → **Foreground service permissions**. Declare type
**microphone**. Paste:

> ORBII provides hands-free "Voice SOS" for personal safety. A foreground
> service uses the microphone to listen **on-device** for the user's chosen
> distress phrase (e.g. "help help") so a woman in danger can trigger an
> emergency alert without unlocking her phone. Audio is processed locally with a
> bundled offline speech model and is **never recorded, uploaded, or stored**
> during listening. The service runs only when the user enables Voice SOS and
> shows a persistent notification while active. This is core, user-facing safety
> functionality that cannot work without continuous microphone access.

Have a **screen-recording** ready that shows: enabling Voice SOS → the persistent
notification → saying the phrase → the SOS countdown firing. Google frequently
requests this for microphone FGS.

---

## 5. Full-screen intent declaration — REQUIRED (Android 14+)

Play Console → App content → **Full-screen intent permission**. Justify:

> ORBII uses full-screen intents to show incoming **emergency SOS alerts** to
> nearby responders and to surface the user's own SOS countdown over the lock
> screen, so a life-safety alert is not missed. This matches the intended
> "emergency" use of the full-screen-intent permission.

---

## 6. Sensitive/restricted permission notes

- **RECORD_AUDIO / FOREGROUND_SERVICE_MICROPHONE** → covered by §4.
- **ACCESS_FINE/COARSE_LOCATION** → foreground only (no background location →
  no separate background-location review needed). Purpose: SOS + Safe Journey.
- **REQUEST_IGNORE_BATTERY_OPTIMIZATIONS** → justify: "Always-on Voice SOS must
  keep listening reliably; aggressive battery optimisation on some OEMs kills
  the safety service. The app asks the user to allow it; it is not required to
  install or use non-voice features." *(If review pushes back, this is the most
  likely permission to have to remove — the app still works without it, just
  less reliably on some phones.)*
- **RECEIVE_BOOT_COMPLETED** → restart the safety service after reboot so
  protection resumes.
- **READ_MEDIA_IMAGES** → let responders pick ID/profile photos from the gallery.
- **USE_FULL_SCREEN_INTENT** → covered by §5.

---

## 7. Store listing copy

**Short description (≤ 80 chars):**
> Voice-activated SOS. Alert your circle & nearby responders when seconds matter.

**Full description (paste, edit freely):**
> ORBII is a personal safety app built for India. Trigger an emergency SOS with
> a button, or hands-free with your voice — even on a locked phone, even
> offline. ORBII instantly shares your live location with your family circle,
> and Premium users also alert verified responders nearby.
>
> • Hands-free Voice SOS — say your phrase, help is triggered. Works offline;
>   the listening happens on your device and audio is never uploaded.
> • Live location to your trusted circle during an emergency.
> • Verified responders (Premium) — real, ID-verified people near you.
> • Safe Journey — share your trip and get help if you go off-route.
> • Emergency contacts, SOS history, and audio recorded during an incident.
>
> ORBII is a safety-alerting tool and is NOT a replacement for the police or
> official emergency services. In a life-threatening emergency, always call 112.

**Content rating:** complete the IARC questionnaire honestly (no violence,
no sexual content, references to emergencies/safety). Expect **Everyone / PEGI 3**
or similar.
**Target audience:** 18+ (adults). Not designed for children.
**Ads:** No ads.
**Category:** Health & Fitness (or Lifestyle). "Safety" is the theme.

---

## Known landmine to clear BEFORE production (not blocking closed testing)
**Premium is sold via Razorpay.** Google requires **Google Play Billing** for
in-app digital purchases. For production you must either (a) integrate Play
Billing for the Premium subscription, or (b) remove/hide the in-app purchase and
unlock Premium via the coupon / institutional deals only. Leaving it as-is risks
rejection/removal at the production stage. It's fine during closed testing.
