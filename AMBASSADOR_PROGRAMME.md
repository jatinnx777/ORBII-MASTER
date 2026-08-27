# Campus Ambassador Programme

3 campuses. Written 27 Aug 2026.

---

## The deal

- **Rs. 2 per install**
- **Redeem at 50 installs (Rs. 100), then 100 (Rs. 200), 250 (Rs. 500), 500 (Rs. 1,000)**
- Certificate and LinkedIn recommendation for anyone who finishes the term
- Prizes up to Rs. 10,000 for the top performers

## Expected spend

3 campuses, roughly 3 ambassadors each, so about 9 people.

| If each gets | Total installs | Cost at Rs. 2 |
|---|---|---|
| 50 | 450 | Rs. 900 |
| 150 | 1,350 | Rs. 2,700 |
| 300 | 2,700 | Rs. 5,400 |

Even the good case is under Rs. 6,000. This is cheap. The prize pool is the
larger line, not the bounty.

---

## One thing that decides how you count

**You cannot see raw installs per ambassador.** Play Console shows total installs,
not who caused them. To attribute an install to a person you need either the Play
Install Referrer library (not built yet) or a code the user types in.

So in practice **"per install" means "per signup with your code"**. That is what
is measurable today, and it is also what you want: a signup is a real person with
a verified phone number, and an install that never opens the app is worth nothing
to you anyway.

Tell ambassadors: *"Rs. 2 for every person who installs AND signs up with your
code."* Same number, countable, and it kills install-and-delete without a rule.

---

## How to run it (no code changes)

### 1. Give each ambassador a code

`SRMS01`, `SRMS02`, `DTU01`. Short, typeable, no ambiguity between O and 0.

Keep a Google Sheet:

| Code | Name | Campus | Phone | UPI ID | Paid so far |
|---|---|---|---|---|---|

### 2. Collect the code at signup

Add one optional field to the profile setup screen: **"Referral code (optional)"**.
Store it on the profile. That is the only app change needed, and it is small.

Until that ships, use a Google Form: *"Signed up for ORBII? Drop your number and
your ambassador's code."* Ambassadors send it in their group. Crude, works.

### 3. Count once a week

```sql
select referral_code, count(*) as signups
from users_public
where referral_code is not null
  and created_at > '2026-09-01'
group by referral_code
order by signups desc;
```

Paste the numbers into the sheet. Two minutes a week.

### 4. Pay when they hit a tier

They message you. You check the sheet, send UPI, write the date in the sheet.
At 9 ambassadors this is maybe four payments a month.

---

## Rules to publish up front

Put these in the ambassador pack so nobody argues later.

- Rs. 2 per person who installs **and signs up** with your code
- Payouts at 50, 100, 250 and 500 signups
- Paid within 7 days of you asking
- Same person cannot be counted twice
- Signups from the same phone as yours do not count
- We check before paying. Anything obviously fake voids that batch

That last one only needs saying once, and it stops most of it.

---

## What to watch in week one

- **One ambassador way ahead of the others.** Usually genuine, occasionally not.
  Look at whether their signups have circle members and opened the app twice.
- **Signups with no circle member.** A real user adds someone within a day or two.
  A pile of solo accounts is a signal.
- **All signups in one hour.** Real recruiting is spread across days.

You do not need automated fraud detection for 9 people. You need to look at the
sheet.

---

## Ambassador pack, needed before the first poster

The blog already promises this exists. It does not yet.

1. What to do in week one (one session, one group, one post)
2. Your code, and where to tell people to type it
3. How the money works, the six rules above
4. Who to message when stuck, and how fast you reply
5. What ORBII does and does not do yet, so they do not oversell it

One page. Send it as a PDF the day someone is accepted.

---

## Later, if it works

Only if a term proves students actually recruit:

- Play Install Referrer, so the link attributes automatically and nobody types a
  code
- An in-app screen showing their count and balance, instead of asking you
- Automated payouts

None of this is worth building for 9 people. Build it when there are 50.

---

## Open decisions

- Term length: one semester or three months?
- Which 3 campuses?
- Does an ambassador who quits halfway keep what they earned? (Say yes, publish it)
- Who writes the ambassador pack, and by when?
