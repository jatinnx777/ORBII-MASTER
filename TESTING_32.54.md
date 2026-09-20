# Device tests for 32.54.0

Everything shipped between 32.45 and 32.54 has been verified against the
database and the type checker. **None of it has run on a phone.** This is the
list that closes that gap, ordered so that the tests which would hurt most if
they failed come first.

Two devices are needed for section 3. One can be an old phone on wifi.

---

## 0. Before you start

- Sideload `ORBII-32.54.0.apk`. Do **not** push the AAB to Play until
  sections 1 and 2 pass.
- Use a **fresh install** for section 1, not an upgrade. Onboarding only runs
  once and an upgraded install skips it.
- Keep a second account signed in on the other phone, already in a circle with
  you.

---

## 1. Cannot ship without these

These are the paths where a failure means somebody does not get help.

### 1.1 Manual SOS still works
Press the SOS button. Countdown appears, cancel works, and letting it run
alerts your circle on the second phone.
**Why first:** every change this week touched circles, locations or
notifications. This is the path none of it was allowed to break.

### 1.2 Voice SOS still works
Say a trigger word with Voice SOS armed. Countdown opens.
**Watch for:** the countdown screen says the right trigger.

### 1.3 A journey still guards you with no network
Put the phone in **aeroplane mode**, start a Safe Journey with a 1-minute ETA,
lock the screen, wait.
**Must happen:** the SOS countdown fires anyway.
**Why:** announcing to the circle is deliberately best-effort and unawaited. If
a failed network write can stop the local guard, that is the worst bug in this
release.

### 1.4 Creating a circle works and is fast
Create one. It should appear in about a second, not a minute.
**Why:** this is the outage. The photo upload was moved off the critical path;
confirm it stayed off.

### 1.5 Ending Safe Mode still asks for the PIN
With a PIN set, tap "I'm safe".
**Must happen:** it asks. That is what stops somebody who grabbed the phone
cancelling her own SOS.

---

## 2. New in this build, single device

### 2.1 Onboarding, fresh install
Walk all of it. Check each screen:

- [ ] **Name** — "What should we call you?"
- [ ] **Your number** — fill it once. Then reinstall and **skip** it. The
      button must read "Skip for now" when the field is empty.
- [ ] **Contact** — name, number, relation chips
- [ ] **Home address** — fill it once, skip it once
- [ ] Illustrations are **not cropped**. No head or feet cut off.
- [ ] **No progress bar and no "3 of 11" counter** anywhere.
- [ ] Back arrow is a plain arrow, no word "Back".
- [ ] The button sits in the same place on every screen.

### 2.2 The map
- [ ] **No "API KEY REQUIRED" watermark.**
- [ ] Satellite imagery, not street.
- [ ] **No Map/Satellite toggle button.**

### 2.3 The age sheet
Open the circle map on an account with no date of birth.
- [ ] Heading reads "Your date of birth".
- [ ] **No calendar icon in a lavender circle.**
- [ ] Ground colour matches the onboarding screens.
- [ ] Typing a date under 18 shows the consequence **before** you continue.

### 2.4 Crash detection
Settings, "More ways to raise an SOS".
- [ ] "A crash starts an SOS" exists and is **on**.
- [ ] Turning it on shows the explanation sheet.
- [ ] The "What this cannot do" row appears underneath.

**Do not road-test this.** The thresholds are unvalidated and it is armed.

### 2.5 Home address deletion
Profile.
- [ ] "Home address" row appears **only** if you saved one.
- [ ] Tapping it asks before deleting.
- [ ] After deleting, the row disappears.

### 2.6 Walk With Me
- [ ] 15 / 30 / 45 / 60 buttons appear and select.
- [ ] Starting still speaks and still checks in every 2 minutes.
- [ ] Not answering a check-in still escalates to the SOS countdown.

---

## 3. Two devices, the part that is actually new

This is the feature this sprint existed for. Phone A starts, phone B watches.

### 3.1 The circle sees a journey
On A: start a Safe Journey, 30 minutes.
On B: open the circle map.
- [ ] A strip appears: "**<name> is on the way**", the label, and "In 30 min".
- [ ] The name is right, not "Someone".
- [ ] A's pin appears on the map.

### 3.2 Arriving closes it
On A: tap "I'm safe".
- [ ] B's strip **disappears**.
- [ ] A's location sharing **stops** (check the persistent notification is gone).
- [ ] B does **not** get a second "location sharing stopped" alert. One event,
      one message.

### 3.3 Overdue
On A: start a journey with the **shortest ETA you can**, then wait
**11+ minutes** without arriving. The sweep runs every minute, grace is 10.
- [ ] B's strip changes to "**N min overdue**".
- [ ] The wording says what happened. It must **not** say "she may be in
      danger" or anything like it.
- [ ] Overdue sorts **above** other journeys.

### 3.4 Walk With Me reaches the circle too
On A: start Walk With Me at 15 minutes.
- [ ] B sees a journey with a walking icon.

### 3.5 The WhatsApp invite
On A: circle invite screen, "Send on WhatsApp". Send to yourself or to B.
- [ ] The message contains a link **and** the six letters.
- [ ] Tapping the link on B opens ORBII.
- [ ] ORBII **asks** "Join this circle?" — it must **not** join on its own.
- [ ] "Not now" joins nothing.
- [ ] "Join" joins and opens the circle.
- [ ] "Share another way" opens the Android share sheet.
- [ ] Uninstall ORBII on B, tap the link: the web page shows the code and a
      Play Store button.

### 3.6 Limits
- [ ] A **family** circle accepts an 8th member.
- [ ] A **friends** circle refuses a 5th, and the message says 4.
- [ ] A free account cannot create a 3rd circle, and the message says 2.
      (Your own account is premium, so use a second account for this.)

---

## 4. Needs time, not clicks

These cannot be settled in an afternoon and matter more than anything above.

### 4.1 Battery baseline
Charge to 100%, use the phone normally for a day with Voice SOS armed and no
journey running. Record the drain. Then repeat with a 2-hour journey.
**There is no number to compare against yet. This test creates it.**

### 4.2 Background survival, per OEM
Start a journey, lock the screen, leave the phone alone for the full ETA on
each of: Xiaomi, Samsung, OnePlus, OPPO, vivo, realme.
- [ ] Does the journey still fire overdue?
- [ ] Is location still updating on the other phone?

Xiaomi and OPPO are the ones most likely to kill it. **Assume it fails until
you have watched it not fail.**

### 4.3 Onboarding drop-off
Not a device test. In a week, read `app_events` and find which of the 11 steps
loses people. 11 is a lot, and if address or phone is where they leave, those
belong in Profile instead of first run.

---

## What I expect to be wrong

Said in advance so it is not a surprise:

- **The journey strip layout** on a small screen. It has never rendered.
- **The WhatsApp handoff** on a phone without WhatsApp. The fallback is coded
  but untried.
- **Background survival on Xiaomi.** This is the likeliest real failure in the
  whole list.
- **Nothing about crash detection.** It is armed, it is speed-gated, and its
  numbers are guesses. Do not describe it as proven to anybody until section
  4.1's shadow data exists.
