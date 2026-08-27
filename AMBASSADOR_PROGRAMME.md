# Campus Ambassador Programme: how it actually works

Plan, not a pitch. Written 27 Aug 2026.

---

## 1. Why we do not pay per install

Google Play's Developer Program Policy forbids incentivising installs to
manipulate ranking. Paying a fixed amount per install is the example the policy
was written for, and the penalty is removal from Play, not a warning.

The second reason is practical and would hurt sooner. At Rs. 2 an install with a
50-install floor, an ambassador earns Rs. 100. Nobody runs hostel sessions for
Rs. 100. They install on several phones, ask friends to install and delete, and
collect. We would buy 25,000 installs, keep perhaps 1,200 real users, and poison
our own retention numbers so thoroughly that we could not tell the programme
worked even if it did.

**We pay for an ACTIVATED user instead.** Same idea, higher rate, defensible on
Play, and fraud mostly kills itself.

---

## 2. What counts as activated

All four, or it does not count:

1. Installed and signed in with a verified phone number
2. Added at least one circle member who also signed in
3. Completed Voice SOS setup (permission granted, phrase set)
4. Still has the app installed on day 7

Step 2 is the one that matters. A fake install cannot fake a second real person
with a second real phone number, and a user with one circle member is a user who
has already got value out of ORBII.

Step 4 is checked by a scheduled job, not at signup, so the reward lands a week
after the work rather than instantly. That single delay removes most churn-and-
burn fraud on its own.

---

## 3. The money

Budget: Rs. 40,000 of the Rs. 50,000 raise.

| Line | Rate | Cap | Total |
|---|---|---|---|
| Activation bounty | Rs. 20 per activated user | 1,500 activations | Rs. 30,000 |
| Prize pool | top 3 ambassadors per term | Rs. 5,000 / 3,000 / 2,000 | Rs. 10,000 |

Rs. 20 per activated user is a customer acquisition cost most consumer apps in
India would take happily, and it is ten times more motivating than Rs. 2. An
ambassador who genuinely activates 50 people earns Rs. 1,000 plus a shot at the
prize, which is worth a term of real effort.

**Redemption floors stay**, as originally planned: Rs. 500 minimum, then any
multiple of Rs. 500. Floors reduce payout transaction count and give us a window
to reverse fraudulent credits before money leaves.

**Hard caps.** Rs. 3,000 per ambassador per term, and the programme stops at
1,500 activations across everyone. Uncapped bounties are how a referral budget
becomes a five-figure surprise.

---

## 4. Attribution: how we know who referred whom

Nothing in the codebase does this today. Two mechanisms, both needed.

### Primary: Play Install Referrer

Each ambassador gets a link:

```
https://play.google.com/store/apps/details?id=in.orbii.app&referrer=amb_SRMS_0142
```

The `com.android.installreferrer` library reads that string on first launch, even
if the install happened days earlier. It is free, first-party, and survives the
Play Store round trip.

Add `com.android.installreferrer:installreferrer:2.2` to
`android/app/build.gradle`, read it once on first launch, and post it with the
signup.

### Fallback: a code at signup

Not everyone comes through the link. Sideloads, shared APKs, someone who searched
the store after seeing a poster. So `ProfileSetupScreen` gains one optional
field: **"Ambassador code (optional)"**.

Same code, printed on the poster and pinned in the WhatsApp group.

### Never: self-reported later

No "who referred you?" prompt weeks after signup. It is unverifiable, it is
trivially gamed, and it invites ambassadors to claim users they never met.

---

## 5. Fraud controls

Assume the programme will be attacked, because it will be.

**Automatic rejection**

- Same device id credited twice, ever
- Emulator detected
- Phone number already seen on any prior account
- Circle member is another account created from the same device
- More than 8 activations from one ambassador in 24 hours, held for review
- Activation where the referred user never opened the app after day 1

**Held for manual review**

- An ambassador crossing 25 activations for the first time
- Any ambassador whose day-7 retention is below 40 percent while the cohort
  average is above 70

**Reversible for 14 days.** Credits are `pending` until the day-14 sweep. A
payout request before then draws only from `cleared`. This is the single most
important control, because it means fraud costs us a database update rather than
money already sent by UPI.

---

## 6. Schema

Five tables, one new migration.

```sql
-- Who the ambassadors are
create table ambassadors (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  code         text not null unique,          -- amb_SRMS_0142
  college      text not null,
  term         text not null,                 -- '2026-autumn'
  status       text not null default 'active' -- active | paused | removed
                 check (status in ('active','paused','removed')),
  created_at   timestamptz not null default now(),
  unique (user_id, term)
);

-- One row per referred user, ever. The unique constraint IS the fraud control.
create table ambassador_referrals (
  id             uuid primary key default gen_random_uuid(),
  ambassador_id  uuid not null references ambassadors(id) on delete cascade,
  referred_user  uuid not null references auth.users(id) on delete cascade,
  source         text not null check (source in ('install_referrer','signup_code')),
  device_hash    text,
  activated_at   timestamptz,                 -- null until all four steps pass
  rejected_at    timestamptz,
  reject_reason  text,
  created_at     timestamptz not null default now(),
  unique (referred_user)                      -- a user can be referred ONCE
);

-- Money owed. Never updated in place; corrections are new rows.
create table ambassador_credits (
  id             bigint generated always as identity primary key,
  ambassador_id  uuid not null references ambassadors(id) on delete cascade,
  referral_id    uuid references ambassador_referrals(id) on delete set null,
  paise          int not null,                -- 2000 = Rs. 20
  state          text not null default 'pending'
                   check (state in ('pending','cleared','reversed','paid')),
  reason         text not null,
  created_at     timestamptz not null default now(),
  cleared_at     timestamptz
);

create index ambassador_credits_wallet_idx
  on ambassador_credits (ambassador_id, state);
```

### Keep this completely separate from the helper coin economy

An earlier draft of this document said to reuse the helper payout rail. That was
wrong, and it is worth writing down why so nobody tries it again.

`helper-economy.ts` is not a generic money rail. `request_payout` in sql/28 reads
its balance directly from `helper_earnings`:

```sql
select coalesce(sum(amount_paise),0) into bal from helper_earnings where user_id = uid;
if p_amount_paise > bal then raise exception 'Amount exceeds your balance'; end if;
```

An ambassador has no `helper_earnings` rows, so their balance is zero and every
payout request fails. Making it work would mean writing ambassador rows into the
helper ledger, and at that point a marketing bounty and a rescue reward are the
same number in the same table.

They must never be, for three reasons:

1. **Coins are earned by turning up to an emergency.** That is the entire meaning
   of the number. Diluting it with referral bounties devalues the one metric the
   responder network runs on.
2. **Different audiences.** A verified helper passed KYC. An ambassador is a
   student with a poster. Nothing about their identity checks, tax position or
   fraud profile is the same.
3. **Different reversal rules.** An ambassador credit is reversible for 14 days
   while we check for fraud. A rescue reward is never reversed, because somebody
   walked to a stranger's emergency at 2am.

So: `ambassador_credits` is its own ledger, in paise, with its own RPC. The only
thing worth sharing is `formatRupees()`, which is four lines of pure formatting.

The **human** payout process is shared, because it is a person sending UPI from
the same bank account. That is an operations detail, not a schema decision.

**RLS.** An ambassador reads only their own rows. Nobody reads
`ambassador_referrals.referred_user`, because that would tell an ambassador
exactly which of their friends signed up, and that is somebody's private decision
to use a safety app.

---

## 7. What an ambassador sees

One screen. Do not build a dashboard.

- Activated this term, and the cap
- Pending, cleared and paid, in rupees
- Their code and a share button
- A "request payout" button, disabled below Rs. 500 with the reason shown

Names of referred users are never shown. Counts only.

---

## 8. Phasing

**Phase 0, before any poster goes out.** The ambassador pack. Week one checklist,
how prizes are decided, who to message when stuck. The blog already promises this
exists.

**Phase 1, manual.** First 10 to 20 ambassadors, codes issued by hand from a
spreadsheet, activation counted with a SQL query once a week, payouts sent
manually over UPI. No app changes at all.

Do this for one full term. It costs nothing, it tells you whether students
actually recruit, and every automation decision after it is informed rather than
guessed.

**Phase 2, attribution.** Install Referrer plus the signup code field, the five
tables, the day-7 activation job. Roughly a week of work.

**Phase 3, self-serve.** The ambassador screen, automated payouts, the day-14
clearing sweep.

**Do not start at Phase 3.** Building automated payouts for a programme nobody
has run once is how you spend three weeks on a system for eleven people.

---

## 9. What we have already published, and the mismatch

The blog and the poster say **"cash prizes up to Rs. 10,000"** and describe a
prize-based programme. This plan adds a per-activation bounty on top.

Those are compatible, but the published copy does not mention the bounty. Either:

- Leave it. The bounty becomes a better-than-expected surprise in the ambassador
  pack, and the public copy stays simple.
- Or update the blog to say "Rs. 20 for every friend who actually starts using
  ORBII, plus prizes up to Rs. 10,000".

The second converts better and is more honest about the earning ceiling. It
should only go up once Phase 1 has proven we can actually track and pay it.

**Do not advertise the bounty before attribution exists.** Paying by hand from a
spreadsheet is fine. Promising a per-user rate we cannot yet measure is not.

---

## 10. Open decisions

- Term length. One semester, or three months?
- Does an ambassador who stops halfway keep cleared credits? (Recommend yes.
  Clawing back earned money over a resignation is not worth the reputation.)
- Prize criteria: raw activations, or activations weighted by day-30 retention?
  Weighted is better and harder to explain.
- Who reviews held credits, and how fast? An ambassador waiting two weeks on a
  review tells the whole group.
