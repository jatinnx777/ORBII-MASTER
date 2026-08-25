# ORBII — Technical Brief for the Funding Round

> Read top to bottom once. Each section goes **basic → advanced**. The boxed
> **"SAY THIS"** lines are what you repeat to an investor; the detail under them
> is so you actually understand what you're saying when they push back.
> You don't need to memorise code — you need to explain *decisions* and *why*.

---

## 0. The 30-second pitch (memorise word-for-word)

> **SAY THIS:** "ORBII is a women's safety app. If you're in danger, you trigger
> an SOS — by button, or hands-free by voice even on a locked phone. We instantly
> share your live location with your family circle. For Premium users, we also
> alert verified responders nearby. The whole thing runs on free infrastructure,
> so our cost per user is effectively zero until we scale."

Three things an investor remembers from that: **hands-free voice SOS**, **live
location to circle**, **near-zero cost**. Everything below supports those three.

---

## 1. How to talk about tech when you're not technical

You will get asked "how does it actually work?" Don't dive into code. Use this
ladder:

1. **What the user feels** ("she shouts 'help help', the phone sends an alert").
2. **What the system does** ("the phone hears it offline, sends her location to
   our server, the server pushes it to her circle's phones").
3. **Why it's hard / why it's defensible** (only go here if they push).

If they go deeper than you can answer, say:
> **SAY THIS:** "Happy to connect you with the build for a technical deep-dive,
> but the short version is — it's a standard mobile + cloud architecture, the
> hard part we solved is doing voice detection *offline* so it works without
> internet and without per-message cost."

That sentence buys you credibility *and* an exit from any question you can't answer.

---

## 2. The architecture in plain English

Three pieces. That's it.

```
   [ Phone app ]  ── triggers SOS ──►  [ Our cloud (Supabase) ]  ── alerts ──►  [ Other phones ]
   (React Native)                       (database + realtime +                  (circle / responders)
                                         storage + functions)
```

1. **The app** (on each phone) — buttons, the map, voice listening, the UI.
2. **The cloud** (Supabase) — stores data, and relays alerts between phones in
   real time. We didn't build a server from scratch; we use a managed platform.
3. **Other phones** — the circle/responders who receive the alert.

> **SAY THIS:** "We don't run our own servers. We sit on managed cloud building
> blocks, which is why a 19-year-old with no infra budget can run a real-time
> safety network — and why our costs stay flat as we grow."

---

## 3. The technology stack — choice by choice

For each: **what it is** → **why we chose it** → **the investor one-liner**.

### 3.1 The app: React Native + Expo
- **What:** One codebase (written in TypeScript) that becomes a real Android app.
  React Native is what Instagram, Discord, and Shopify use.
- **Why:** One team writes once, ships to Android now and iPhone later without a
  rewrite. Expo gives us camera, GPS, notifications, etc. without reinventing them.
- **One-liner:** *"Same framework as Instagram — one codebase, Android today,
  iOS tomorrow, no rewrite."*

### 3.2 The backend: Supabase
- **What:** A managed cloud platform: a Postgres **database**, **realtime**
  messaging, file **storage**, **auth**, and small server **functions** — all in one.
- **Why:** It replaces hiring a backend team. It has a generous free tier and is
  open-source, so we're not locked in — we can self-host later if we scale.
- **One-liner:** *"Supabase is our entire backend team in a box, on the free tier,
  open-source so we're never locked in."*

### 3.3 Login: Google Sign-In (OAuth)
- **What:** Users log in with their Google account. No passwords, no OTP SMS.
- **Why:** SMS OTP costs money per message and can be faked; Google login is free,
  instant, and trusted. We removed OTP entirely for this reason.
- **One-liner:** *"Google login — zero auth cost, no SMS bills, no password leaks."*

### 3.4 Maps: MapLibre + OpenFreeMap
- **What:** The live map showing the user and responders, with our own green/cream
  theme. MapLibre is the open-source engine; OpenFreeMap gives free map tiles.
- **Why:** Google Maps charges per map load — that bankrupts a free app at scale.
  Ours is free and unlimited, with a custom look so it feels premium.
- **One-liner:** *"Custom-themed maps with no Google Maps bill — free and unlimited
  at any scale."*

### 3.5 Voice: Vosk (on-device speech recognition)
- **What:** The phone listens for trigger phrases ("help help", "save me",
  Hindi equivalents) using a speech model that runs **entirely on the phone** —
  the English + Hindi models are bundled inside the app.
- **Why:** Cloud speech (Google/Amazon) costs per minute and needs internet. Ours
  is free forever, works with no signal, and is private (audio never leaves the phone).
- **One-liner:** *"Voice detection runs offline on the phone — no internet needed,
  no per-use cost, and the audio never leaves the device, so it's private by design."*
  **This is your strongest technical talking point. Lead with it.**

### 3.6 Notifications: Firebase Cloud Messaging (FCM)
- **What:** Google's free system for waking up a phone with an alert even when the
  app is closed.
- **Why:** It's the only reliable way to reach a closed app, and it's free.
- **One-liner:** *"We use Google's own free push system to reach phones even when
  the app is closed."*

---

## 4. The core flow: what happens when she presses SOS (end-to-end)

This is the heart of the product. Know this cold.

1. **Trigger** — She presses the SOS button, *or* says "help help", *or* the
   lock-screen voice service hears it. A 5-second countdown screen appears (so an
   accidental trigger can be cancelled).
2. **Locate** — The app grabs her GPS location. If GPS is slow, it falls back to
   the last known location so we never send *nothing*.
3. **Broadcast (instant)** — The app sends the alert over a **realtime channel**
   to every relevant phone that's currently open. This is the fast path — it fires
   in well under a second.
4. **Persist (parallel)** — At the same time, the alert is saved to the database
   so there's a durable record and history. We never make her *wait* for the
   database — alerting people comes first.
5. **Push (for closed apps)** — A small server function (`notify-sos`) sends FCM
   push notifications to her circle and emergency contacts whose apps are closed.
6. **Receive** — Circle members get a full-screen alert with her live location and
   a "navigate to her" button. The map shows who's responding.
7. **Resolve** — When she's safe, a "resolved" signal tells every responder's phone
   to stop buzzing.

> **SAY THIS:** "The design rule is *alert people first, save the record second*.
> The instant alert path fires in under a second; the database write happens in
> parallel so a slow network never delays help."

**Why this impresses people:** most "SOS apps" just send an SMS. We built a
real-time presence-and-dispatch network with graceful fallbacks. That's the
difference between a feature and a product.

---

## 5. The business model, enforced in the product (Premium gate)

This is new and important for the round — it shows you've connected **engineering
to revenue**, not just built features.

- **Free users:** their SOS is shared **only with their family/circle** in real time.
- **Premium users:** their SOS *also* reaches **verified responders nearby** —
  strangers who can physically reach them faster than family 20km away.

> **SAY THIS:** "The free tier alerts your family. The paid tier unlocks our
> responder network — verified people nearby. The thing people will pay for is
> *proximity*: someone who can actually reach you in minutes."

**How it's enforced (so it can't be cheated):** every SOS is tagged `circleOnly`
when the user is free. We block the stranger-facing path in **three places** —
the realtime broadcast, the nearby-alerts list, and the database query that serves
locations. A free user's live location is *never* served to anyone outside their
circle. (This also doubles as a privacy guarantee.)

---

## 6. The responder network (how strangers become trusted)

- Anyone can apply to be a **responder** in the app.
- They upload **ID documents** (Aadhaar, PAN, selfie, profile photo) from their
  gallery into a **private** storage bucket.
- **You manually review and approve** them (for the pilot). Approved responders get
  a "Missions" tab and can go online to receive nearby Premium SOS alerts.
- We track a **trust score** and **Guardian levels** (Bronze→Elite) — recognition,
  not cash, drives good behaviour.

> **SAY THIS:** "Responders are verified, not anonymous. We KYC them, we score
> their trust, and we recognise the good ones. We are deliberately *not* paying
> strangers cash to show up to emergencies — that attracts the wrong people."

**The role system:** one app, three roles — `user`, `responder`, `admin` — stored
in the database. The UI changes by role (same pattern as Instagram showing a
"Professional Dashboard" to business accounts). A user **cannot** promote
themselves — the database actively blocks self-escalation; only an admin can.

---

## 7. Security & privacy (this is where you win sceptics)

Investors in a *safety* app will probe security. You have real answers.

1. **Row-Level Security (RLS):** the database enforces, per-row, that you can only
   read your own data. Even if someone stole our app's public key, they can't pull
   other users' data.
2. **We fixed a real location leak:** earlier, any logged-in user could query every
   active victim's live coordinates nationwide. We replaced it with a server
   function that only returns alerts *near the caller*, *excludes the caller*, and
   *only from the last 15 minutes*. The table can no longer be scraped.
3. **KYC documents are private:** stored in a non-public bucket; a responder can
   only ever see their own folder.
4. **Secrets are server-side only:** payment keys and admin keys live in protected
   server environments, never in the app or in our code repository.
5. **Voice is private:** audio is processed on-device and never uploaded.

> **SAY THIS:** "For a safety app, a data leak isn't a bug — it's a danger. So the
> database enforces access per-row, victims' locations are only ever served to
> people near them, and ID documents are private to the person who uploaded them.
> We already found and closed a location-leak before launch."

That last sentence — *"we found and closed a leak before launch"* — signals
maturity. Use it.

---

## 8. Cost & unit economics (the part they actually care about)

> **SAY THIS:** "Our infrastructure cost per user today is effectively zero. Every
> expensive piece — maps, voice, login, push — we deliberately chose a free option.
> We start paying only when usage crosses the free tiers, and by then we have revenue."

| Expensive thing in most apps | What we pay |
|---|---|
| Maps (Google charges per load) | ₹0 — OpenFreeMap |
| Voice recognition (cloud, per minute) | ₹0 — runs on-device |
| Login / OTP SMS | ₹0 — Google login |
| Push notifications | ₹0 — Firebase free |
| Backend / database | ₹0 — Supabase free tier |

**The margin story:** because infra ≈ ₹0, almost all subscription revenue is
gross margin at small scale. When you cross free tiers, the next tier of Supabase
is a fixed ~₹2,000/month — covering tens of thousands of users. *Costs step up in
small flat jumps; revenue grows per user.* That gap is the business.

**Know your one number:** *"At ₹200/year per user and ~₹2,100/month infra at the
next tier, I break even at roughly **130 paying users**."* Full math, scenarios,
and the SRM deal P&L are worked out in **§13 — The numbers**. Memorise the three
numbers at the end of that section.

---

## 9. What's defensible (the "moat" question)

Investors ask "what stops Google from doing this?" Honest answer:

> **SAY THIS:** "The tech isn't the moat — execution and trust are. Three real
> moats: (1) an offline voice trigger tuned for Indian languages and real distress
> phrases, which is genuinely hard to get right; (2) a *verified* responder network
> — that's a trust-and-operations business, not a coding problem, and it compounds
> as it grows; (3) we're built India-first and free-first, which the big players
> won't bother optimising for."

Don't oversell the moat. Saying "execution is the moat" is *more* credible than
claiming nobody can copy you.

---

## 10. The hard questions — and crisp answers

**Q: "If a girl is being attacked, can she really open an app?"**
> Voice trigger. She doesn't unlock anything — she shouts "help help" and the
> locked phone fires the SOS. That's the entire reason voice exists.

**Q: "What if there's no internet?"**
> Voice detection works fully offline. The alert send needs a signal — like any
> app — but we fall back to last-known location and queue the send, and the circle
> push goes out the moment any signal returns.

**Q: "Who actually shows up? Police don't respond."**
> That's exactly why we don't rely on police alone. Free tier = your family knows
> instantly. Premium = verified responders nearby. We're honest that we're a
> *fast-alert and presence* layer, not a replacement for emergency services.

**Q: "Aren't you liable if a responder is dangerous?"**
> That's why responders are KYC-verified, trust-scored, and recognition-driven —
> and why this is a controlled pilot, not an open marketplace paying strangers cash.

**Q: "How do you make money?"**
> Premium subscription unlocks the responder network and advanced safety features.
> Plus institutional deals — e.g. a university buying ORBII for every student at a
> low per-student price.

**Q: "Why will this still exist in 12 months when most safety apps die?"**
> Because we kept costs at zero so we don't need scale to survive, and because the
> responder network gets *more* valuable as it grows — the opposite of a feature
> that gets stale.

---

## 11. Glossary (every term, in one line)

- **React Native / Expo** — the toolkit that turns one codebase into a real phone app.
- **TypeScript** — the programming language; JavaScript with safety rails.
- **Supabase** — our all-in-one managed cloud backend (database + realtime + storage + functions).
- **Postgres** — the database (where users, SOS events, profiles live).
- **RLS (Row-Level Security)** — database rule: you can only read your own rows.
- **Realtime broadcast / channel** — instant phone-to-phone messaging through the cloud.
- **Presence** — the cloud knowing which users are online and where (for "helpers nearby").
- **Edge Function** — a small piece of our code that runs on the server (e.g. sending pushes).
- **FCM (Firebase Cloud Messaging)** — Google's free system to wake a phone with a notification.
- **OAuth / Google Sign-In** — logging in with your Google account, no password.
- **Vosk** — the offline speech engine that runs on the phone.
- **MapLibre / OpenFreeMap** — the free, open map engine and map data.
- **KYC** — "Know Your Customer": verifying a responder's real identity via ID docs.
- **APK** — the installable Android app file.
- **Free tier** — the no-cost usage band of a cloud service before you start paying.
- **circleOnly** — our flag marking a free user's SOS as family-only (not for strangers).
- **Role (user/responder/admin)** — what a person is allowed to do; controls what UI they see.

---

## 12. The five sentences to never forget

1. "Hands-free voice SOS that works on a locked phone, offline."
2. "Free users alert family; Premium users unlock verified nearby responders."
3. "Our infra cost per user is effectively zero — every expensive piece, we chose free."
4. "For a safety app, security is the product — we enforce per-row access and already closed a location leak."
5. "The tech isn't the moat; the verified responder network and execution are."

Lead with #1, close with #5.

---

## 13. The numbers (break-even + the SRM deal)

This is the section that closes a round. Memorise the **bold** numbers, understand
the assumptions, and say them without flinching.

> ⚠️ **Verify two figures the week of the meeting** (they change): Supabase Pro
> price (~$25/mo) and the realtime *concurrent connection* limit (Free ~200, Pro
> ~500). Everything below is built on those — if they've changed, the shape of the
> argument holds, only the exact rupee figure moves.

### 13.1 What actually costs money (be honest — it's not literally ₹0 forever)

Four of our five expensive pieces are *permanently* free at any scale: maps, voice,
login, push. **One cost does grow: realtime connections.** Every open app holds a
live connection to relay alerts. Free tier covers ~200 *simultaneously open* apps;
Pro (~₹2,100/mo) covers ~500; beyond that you pay a small per-connection overage.

> **SAY THIS (don't pretend infra is free forever — it's stronger to be precise):**
> "Four of our five cost centres are free at any scale. The one that grows is
> realtime connections — and that only counts apps *open at the same moment*, not
> total users. Even a 5,000-student campus has maybe a few hundred open at once.
> Our infra bill is a few thousand rupees a month deep into five figures of users."

The other small variable cost: **payment processing.** Razorpay takes ~2% + GST ≈
**2.36%** per transaction. On a ₹99 plan that's ~₹2.3; on ₹200 it's ~₹4.7. Tiny,
but real on small-ticket subscriptions — so know it.

### 13.2 Net revenue per paying user (after Razorpay)

| Plan | Price/yr | Razorpay (−2.36%) | **Net/yr** |
|---|---|---|---|
| A | ₹99 | −₹2.34 | **₹96.66** |
| B | ₹200 | −₹4.72 | **₹195.28** |

### 13.3 Break-even — how many *paying* users cover the whole infra bill

Assume you've crossed the free tier and pay Pro: **~₹25,200/year** (₹2,100 × 12).
That one tier serves up to ~100k total users / ~500 concurrent.

| Plan | Net/yr | Payers to cover ₹25,200 |
|---|---|---|
| ₹99 | ₹96.66 | **≈ 261 paying users** |
| ₹200 | ₹195.28 | **≈ 130 paying users** |

> **SAY THIS:** "At ₹200 a year, **130 paying users** cover our entire cloud bill —
> and that same tier serves up to a hundred thousand people. Past 130 payers,
> nearly every rupee is margin."

And the honest kicker: until you cross the free limits you pay **₹0**, so real
break-even is *earlier* than 130 — that's the conservative ceiling, not the floor.

### 13.4 The funnel reality (so you're not caught out)

Consumer freemium converts at ~**2–3%** to paid. So:
- 130 payers at 2.5% conversion ⇒ ~**5,200 total users** to break even on consumer.
- That's one mid-size campus. Very reachable.

> **SAY THIS:** "On the consumer side we break even around 5,000 users at a modest
> 2.5% conversion. The institutional path gets us there in a single signing."

### 13.5 The SRM institutional deal (your real near-term money)

Institution pays once for *every* student — so conversion is **100%**, and it's a
bank transfer (little/no Razorpay cut). This is the strong slide.

**4,500 students, two price points:**

| Per student/yr | Gross revenue | Infra (Pro + buffer) | **Net profit/yr** | Margin |
|---|---|---|---|---|
| ₹100 | ₹4,50,000 | ~₹50,000 | **~₹4,00,000** | ~89% |
| ₹200 | ₹9,00,000 | ~₹50,000 | **~₹8,50,000** | ~94% |

(I padded infra to ₹50k/yr — well above the ₹25k Pro tier — to absorb realtime
overage from a concentrated campus. Even doubled, the margin barely moves. That
robustness *is* the point.)

> **SAY THIS:** "One campus of 4,500 students at ₹200 a year is ₹9 lakh revenue
> against roughly ₹50,000 of infrastructure — about **90% gross margin** — because
> we engineered the cost base to near-zero. Five campuses is a ₹40-lakh business
> off a laptop."

### 13.6 Which price? The recommendation

- **Consumer self-serve: ₹200/yr.** Break-even at 130 payers vs 261 — you halve
  the users needed for the *same* money, and ₹200/yr (~₹17/mo) is still trivially
  cheap for personal safety. Don't race to ₹99; you're not competing on price,
  you're competing on *whether help actually arrives*.
- **Institutional (SRM): ₹100–200/student.** Anchor at ₹200; the bulk/"every
  student" framing and your founder relationship justify volume pricing. Even ₹100
  is ~89% margin, so you have huge room to negotiate down and still win.

### 13.7 The three numbers to walk in knowing

1. "**130 paying users** cover our entire cloud bill for up to 100k users." (₹200 plan)
2. "We break even around **5,000 consumer users** at 2.5% conversion."
3. "**One 4,500-student campus = ~₹9 lakh at ~90% margin.**"

If you remember nothing else from this section, remember those three. They prove
you understand cost, conversion, and the institutional wedge — the three things an
investor is actually testing.
