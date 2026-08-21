# ORBII — Legal Addendum (DRAFT, NOT YET REVIEWED)

**I am not a lawyer and this is not legal advice.** These are drafted clauses
for an Indian advocate to review before they go anywhere near the live site.
Publishing the website deploys it, so nothing here has been applied to
`website/src/pages/*.astro`. That is deliberate.

**Do not skip the review.** ORBII is a safety product. The one category of
document where a plausible-looking draft is actively dangerous is the one that
decides what happens when somebody is hurt and the app did not help.

---

## What already exists, and is fine

An audit of the live pages first, because the brief assumed less was in place
than there is:

| Requirement | Status |
|---|---|
| "Not an emergency service" | **Covered**, ToS §2, and it is well drafted |
| Must call 112 | **Covered**, ToS §2 |
| No guarantee anyone responds or arrives | **Covered**, ToS §2 |
| As-is / as-available | **Covered**, ToS §10 |
| Exclusion of indirect and consequential loss | **Covered**, ToS §10 |
| Carve-out for non-excludable liability | **Covered**, ToS §10 |
| Governing law: India | **Covered**, ToS §12 |
| Responder network terms | **Covered**, ToS §6 |
| DPDP named, Data Fiduciary, grievance officer | **Covered**, Privacy §6 and §9 |
| Under-18 handling | **Covered**, Privacy §7 |
| Midnight location purge | **Covered**, Privacy §4 |

So the gaps below are additions, not a rewrite.

---

## A note on "aggressive" liability shielding

The brief asks for the disclaimer to be maximally aggressive. That is the wrong
optimisation and I want to say so plainly before the clauses.

Under the **Indian Contract Act 1872 §23** and the **Consumer Protection Act
2019**, a term that attempts to exclude all liability in every circumstance is
liable to be read down or struck out as an unfair contract term, and §10 already
concedes this correctly with "nothing in these Terms excludes any liability that
cannot be excluded under applicable law." A blanket exclusion also reads badly to
a regulator and to a judge, and on a safety product it reads badly to a
journalist.

**A narrow, specific, honest disclaimer survives contact with a court. A broad
one invites the argument that the whole clause was drafted in bad faith.** The
clauses below are therefore specific about the failure modes ORBII genuinely
cannot control, which is a stronger position than a general disclaimer of
everything.

---

## 1. NEW ToS clause — Mesh relay (insert as §7, renumber after)

This is the most important gap and it is not in either document today.

When a user has ORBII installed, their phone can **carry another person's
emergency packet** over Bluetooth. That is third-party data transiting a user's
device. Nobody has agreed to it, and it is disclosed nowhere.

> ### 7. Offline Relay
>
> **7.1** ORBII includes an offline relay feature. When a nearby user triggers an
> SOS and has no internet connection, their device may broadcast an encrypted
> emergency packet over Bluetooth. If your device is in range and has ORBII
> installed, your device may receive that packet and, if your device has internet
> access, forward it to ORBII's servers so that the alert reaches the people who
> can help.
>
> **7.2** You cannot read what you carry. The packet is sealed using
> public-key encryption (NaCl sealed boxes) addressed to ORBII's servers. Your
> device holds no key capable of opening it and cannot determine the sender's
> identity, location, or circumstances from it.
>
> **7.3** Relaying is automatic and consumes a small amount of battery and, when
> forwarding, mobile data. You may disable it at any time in Settings. Disabling
> it does not affect your own ability to send an SOS.
>
> **7.4** You are not responsible for the content of a packet your device
> relays, and you accept no obligation to respond to it. Relaying is a
> transmission function only. ORBII does not treat a relayed packet as any
> indication that you were present at, involved in, or aware of an incident.
>
> **7.5** ORBII does not warrant that a relay will occur, succeed, or occur in
> time. Bluetooth range, device state, operating-system power management, and
> the presence of other users are outside our control.

**Why 7.4 matters.** Without it, a plaintiff's lawyer can argue a relaying user
had constructive knowledge of an emergency nearby and a resulting duty. That
clause closes it.

---

## 2. NEW ToS clause — Specific failure modes (insert into §10)

Replace nothing. Add these as a bulleted list inside the existing §10, because
specificity is what makes a disclaimer enforceable:

> Without limiting the general disclaimer above, ORBII specifically does not
> warrant that:
>
> - voice detection will recognise every utterance, in every accent, at every
>   volume, through every fabric or background noise;
> - an alert will be delivered where the mobile network, GPS, Bluetooth, or the
>   device's own power-management software prevents it;
> - any responder, verified or otherwise, will accept a dispatch, arrive, arrive
>   in time, or act competently;
> - a device will remain able to run ORBII where the manufacturer's battery
>   optimisation or task-management software terminates background services;
> - offline features will function in any particular location.
>
> Verified responders are independent individuals, not employees, agents, or
> contractors of ORBII. ORBII verifies identity documents before approval. It
> does not supervise, direct, or control a responder's conduct, and is not
> liable for their acts or omissions.

**That last paragraph is the single most valuable clause in this document** and
it is currently missing. Without it, the argument that ORBII "sent" someone to a
person's location and is therefore vicariously liable for what they did is
wide open.

---

## 3. NEW Privacy clause — Data Principal rights (insert as §6a)

The policy names DPDP but does not use its rights framework or give the response
timelines the Act contemplates.

> ### 6a. Your Rights as a Data Principal
>
> Under the Digital Personal Data Protection Act, 2023, you are a **Data
> Principal** and ORBII is the **Data Fiduciary**. You have the right to:
>
> - **Access** a summary of the personal data we process about you and the
>   processing activities we undertake.
> - **Correction and completion** of inaccurate or incomplete data, and
>   **erasure** of data we no longer need for the purpose it was collected for
>   or that you no longer consent to.
> - **Nominate** another individual to exercise these rights on your behalf in
>   the event of your death or incapacity.
> - **Grievance redressal** as a first step, before approaching the Data
>   Protection Board of India.
> - **Withdraw consent** at any time, as easily as you gave it. Withdrawal does
>   not affect processing already carried out, and we will tell you plainly which
>   features stop working as a result.
>
> **How to exercise them.** Email [privacy@orbii.in], or use Profile → Settings →
> Delete Account for erasure. We will acknowledge within **72 hours** and
> respond substantively within **30 days**.
>
> **Grievance Officer.** [NAME], [privacy@orbii.in]. If you are not satisfied
> with our response, you may escalate to the Data Protection Board of India.
>
> **One limit, stated honestly.** Where data forms part of the record of an
> active or past emergency involving other people, such as a responder's arrival
> record, we may retain the minimum necessary for accountability, and we will
> tell you what and why.

**Fill in [NAME] before publishing.** DPDP requires a named, contactable
grievance officer, not a generic mailbox.

---

## 4. NEW Privacy clause — Mesh and encryption (insert into §3 or §5)

> ### Offline relay and what other devices can see
>
> When your device sends an SOS with no internet connection, ORBII may broadcast
> an encrypted packet over Bluetooth so that a nearby device can forward it for
> you. That packet is sealed with public-key encryption addressed to ORBII's
> servers. **A device that relays your emergency cannot read it.** It cannot see
> your identity, your location, or your message. It carries a sealed envelope
> and hands it on.
>
> Conversely, your device may relay other people's sealed packets under the same
> terms, and you cannot read theirs. You can turn relaying off in Settings.
>
> Voice audio is never part of this or any other transmission. Speech
> recognition runs entirely on your device and audio is never uploaded.

---

## 5. NEW Privacy clause — Automated purge (strengthen §4)

§4 mentions the midnight wipe. Make the mechanism explicit, because "we delete
it" and "a scheduled job deletes it whether or not anyone remembers" are
materially different promises:

> Location history shared within a circle is retained for the current day only.
> A scheduled database job runs at midnight Indian Standard Time and **deletes**
> those records. They are not archived, anonymised, or moved to cold storage.
> This runs automatically and is not conditional on a request from you.
>
> This is our answer to the DPDP requirement to retain personal data only as
> long as the purpose requires. The purpose of circle location history is to
> show where somebody went today, so the retention period is one day.

---

## 6. Helpers app — needs its own documents

`in.orbii.helper` is a separate Play listing with a materially different data
posture: government ID, continuous location while on duty, real name. It cannot
share ORBII's privacy policy, and Google will require a distinct Data Safety
declaration.

Minimum it must cover, none of which exists yet:

- Government ID and selfie collection, why, who reviews it, how long it is kept
- Continuous background location **while on duty only**, and that duty is a
  toggle the helper controls
- The permanent notification while on duty, and that it is not optional
- Retention of arrival records for accountability after an incident
- That helpers are independent individuals, not employees
- Coin balances, payouts, and the tax position of a payout
- Grounds for removal from the network

---

## Checklist before any of this is published

- [ ] Reviewed by an Indian advocate with data-protection experience
- [ ] [NAME] filled in as Grievance Officer
- [ ] `privacy@orbii.in` actually exists and is monitored
- [ ] The Settings toggle promised in ToS §7.3 and Privacy §4 **is actually
      built**. Do not publish a policy describing a control that does not exist;
      that is a worse problem than the missing clause.
- [ ] Separate policy written for `in.orbii.helper`
- [ ] Play Data Safety declarations updated for both apps
- [ ] Effective date updated on both documents

---

## The one that is a code task, not a legal one

ToS §7.3 and the privacy clause both promise the user can **turn relaying off**.
Check whether that setting exists. If it does not, either build it or remove the
sentence, because a policy that describes a control the app does not have is a
misrepresentation, and it is the kind that gets found.
