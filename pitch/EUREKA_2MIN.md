# ORBII — Eureka! Road to Enterprise 2026

**20 Aug 2026, 10:00 AM, SRM University Sonipat. NEC ID NEC2634332.**
Format: **2 minutes pitch + 3 minutes Q&A per team.** 5 to 6 judges from the
startup ecosystem, minimum 4. Top 3 fast-track to the Eureka! 2026 zonal rounds
(Delhi, Bengaluru, Mumbai).

Deck: `orbii-eureka.html` (arrow keys, **N** notes, **T** clock, **F** fullscreen).

**The Q&A is longer than the pitch.** Three minutes of judges probing versus two
minutes of you talking. Most teams over-rehearse the pitch and get taken apart in
Q&A. Spend tonight on section 3 of this file, not on the script.

---

## 1. What has to happen in 120 seconds

You cannot explain ORBII in two minutes. Do not try. Two minutes buys you exactly
three things:

1. They remember **one sentence**: we got rid of the button.
2. They believe **you actually built it**, not designed it.
3. They ask you a question, which is where you actually win.

Everything cut from the pitch is ammunition for Q&A. That is the trade, and it is
a good one.

---

## 2. The script, timed

Roughly 265 words. Read it aloud with a stopwatch. If you land at 1:50 you have
room to breathe; if you land at 2:10, cut the line marked **[CUT FIRST]**.

### Slide 1 — the word · 0:00 to 0:20

> "Say the word **help** out loud. Right now. Quietly is fine."

**Wait three full seconds. Actually wait.** This is the hardest thing in the pitch
and the reason it works. Some of the room will mutter it.

> "Nothing happened. Your phone heard you. It's the closest object to you in this
> room, closer than the person sitting next to you. And when you said the one word
> a human says in danger, it did nothing."

### Slide 2 — the flaw · 0:20 to 0:42

> "There are hundreds of safety apps. She probably has one right now. Every single
> one has the same flaw: it needs her to reach the phone, unlock it, find a button,
> hold it.
>
> Think about the actual moment. Hands not free. Phone in her bag. Running.
> **[CUT FIRST]** Fingers shaking. The one moment the app was built for is the exact
> moment she cannot use it.
>
> We didn't build a better button. We got rid of the button."

Slow down for that last line. Pause after it.

### Slide 3 — what happens · 0:42 to 1:07

> "She says help. Her phone hears it on the device itself. The audio never leaves
> the phone, never touches a server, never gets sold, because we never have it.
>
> Ten second countdown, so a false alarm is one tap to cancel. If she doesn't
> cancel: her circle gets her live location, verified helpers near her are
> dispatched in waves, and the phone starts recording.
>
> She never touched the screen."

### Slide 4 — the moats · 1:07 to 1:30

> "Three things make this hard to copy.
>
> One, the model runs fully on-device, so our cost per protected woman is near
> zero and it still works with no signal.
>
> Two, helpers get paid only when the person they reached confirms they arrived,
> with a code she reads out loud. You can't farm it by tapping accept.
>
> Three, we can't sell her audio because we don't have it. Every competitor built
> on cloud transcription can change that policy on a Tuesday. We'd have to rebuild
> the product."

### Slide 5 — it's real · 1:30 to 1:48

> "This isn't a mockup. It's built, in early access on Android. Eighty database
> migrations, ten backend services, the speech model bundled inside the app.
>
> Voted number one Product of the Week on Smol, a global builder platform, against
> forty seven other launches. And there's a second app, live, for the responders."

Say this flat and fast. No adjectives. The absence of hype is the point.

### Slide 6 — money and ask · 1:48 to 2:00

> "Ninety nine rupees a month direct. But the real business is campus: two hundred
> rupees per student per year, bundled into the fee like insurance, so it costs the
> college nothing out of pocket. One ten thousand student university is twenty lakh
> a year.
>
> We want the zonal round, and introductions to universities."

**Then stop talking.** Do not fill the silence. Let them ask.

---

## 3. Q&A — what the jury will ask you

Three minutes, four to six judges. Expect five to eight questions, fast. Answer
in **two sentences then stop.** Rambling is what loses this round.

### The honesty rule

If you do not know, say "I don't know, I'd have to check." A judge who catches you
bluffing stops believing everything else you said, including the true parts. On a
safety product that is fatal. Under-claim, always.

---

### Product

**"Doesn't it drain the battery, listening all the time?"**
> It's a two-stage pipeline. A cheap voice-activity gate runs constantly and drops
> CPU to near zero in silence; the actual model only wakes when someone is speaking.
> It's a foreground service so Android can't kill it silently.

**"What about false alarms? Someone watching a movie says help."**
> Ten second cancelable countdown before anything is sent, and it needs a confident
> single-word detection, not a fuzzy match. She taps once and it's gone.

**"Does it work in noisy Indian streets? Accents?"**
> It runs Vosk on-device in English and Hindi. Honest answer: accent and street
> noise are the hardest part and it's exactly what we're collecting data on now,
> through an in-app voice donation game where users contribute samples with consent.

**"What if her phone is off or has no internet?"**
> Two answers, and I'll separate what's proven from what isn't. Proven: it works
> with no internet for the on-device detection, and there's an SMS path over cell
> signal with data off. Built but not yet validated on real hardware: a Bluetooth
> relay that hops the alert phone to phone. **I won't claim that one works until
> I've tested it on two devices.**

**"Who are these verified helpers? How do you stop a predator signing up?"**
> Government ID plus a selfie plus human review before anyone is dispatchable, in a
> separate app with its own onboarding. And they're paid only on a code she reads
> out in person, so a bad actor gains nothing by accepting. Right now the honest
> position is the system is built end to end and we're recruiting the first cohort.

---

### Business

**"How do you make money if the safety features are free?"**
> Free plan gets two verified dispatches a month; ₹99/month is unlimited plus the
> offline extras. But the real revenue is campus: ₹200 per student per year bundled
> into fees.

**"Why would a college pay for this?"**
> They don't, out of pocket. It goes into the fee like insurance, so it's cost
> neutral to them and it's a line they can put in front of parents. Their
> alternative is a helpline nobody calls.

**"What's your CAC?"**
> Direct-to-consumer we haven't spent on acquisition yet, so I'd be making a number
> up. The campus channel is one signature for thousands of students, which is
> precisely why we're pushing it instead of ads.

**"Isn't this a feature, not a company?"**
> The voice trigger alone would be a feature. The company is the response network
> underneath it: verified helpers, arrival codes, escalation waves, an economy that
> pays only on proven arrival. Anyone can add a wake word; nobody has the people.

**"Who are your competitors?"**
> Life360 for family location, and a long tail of Indian panic-button apps. Life360
> is the honest comparison and the honest difference is not features, it's that we
> can't monetise her data because we don't hold it.

---

### The founder

**"You're nineteen and non-technical. Who wrote this?"**
> I did, and I couldn't code eighteen months ago. Eighty database migrations, ten
> backend services, native Android modules for the voice engine. I'll walk you
> through any file in the repo right now.

Say this without apology. It is the strongest thing about you in this room.

**"Do you have a team?"**
> Solo right now. That's a real risk and I'd rather name it than dress it up. The
> first hire is someone senior on Android, funded from the campus contracts.

**"What do you need?"**
> The zonal round, and introductions to universities. Distribution is the bottleneck,
> not the product.

---

### The one to be ready for

**"Has anyone actually been rescued using this?"**
> No. It's in early access and the helper network is being recruited now. I'm not
> going to tell you a safety product is proven when it hasn't saved anyone yet.

**Do not flinch on this and do not dress it up.** Judges who have seen a hundred
pitches will respect the straight answer more than the dodge, and the dodge is
transparent.

---

## 4. Status corrections — read this before you go on stage

You asked whether the mesh and E2EE work were done. They are not the same thing
and you should not describe them the same way.

| Thing | Truth | On stage |
|---|---|---|
| Voice SOS, on-device, EN + HI | **Working.** Ships in the APK | Claim it |
| Circles, 112, community, geofences, arrival codes, coins, escalation | **Working** | Claim it |
| Helper app, onboarding, admin review, dispatch | **Working**, in early access | Claim it |
| SMS lifeline | Code complete, **never tested on real hardware** | "built, testing on devices" |
| **BLE offline mesh relay** | ~800 lines of Kotlin plus three services. Code complete, including long-range Coded PHY. **Never tested on two real phones** | "built, in hardware testing." **Never call it proven** |
| Offline helper alert | Same, code complete, untested | Same |
| Disaster mode | Same | Same |
| **E2EE circle location** | **Never built.** A design document and nothing else. Zero implementation | Do not mention it |
| Play Store public listing | Early access, not a public launch | "early access", not "on the Play Store" |
| Payments | Functions deployed, **never processed a rupee** | Do not claim revenue |
| Rescues performed | **Zero** | Say zero |

The two you asked about: **the mesh is written but unproven**, and **E2EE is a spec
you have never built**. Its own file says so in the header. If a judge asks about
encrypted location and you say yes, one follow-up question exposes it.

---

## 5. Night before

- Run the deck at **T** with the clock on. Three times. Nothing else.
- Have the app **open on your phone**, signed in, home screen showing. If a judge
  says "show me", you have four seconds, not forty.
- Charge the phone. Download nothing new. Do not install a fresh build tonight.
- Know your NEC ID: **NEC2634332**.
- Two minutes is short enough that you can memorise it. Do. Reading notes on stage
  costs you the "he built this" credibility that is your whole edge.
