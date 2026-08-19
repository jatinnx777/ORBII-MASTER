import { describe, expect, it } from 'vitest';
import { ageFromDob } from './consent';

// The age gate is ORBII's DPDP defence. Rule 10 of the DPDP Rules 2025 forbids
// tracking anyone under 18, and this function is what decides who that is. If
// it is wrong by a day we either track a child or lock an adult out of her own
// location sharing, and we have already shipped the second bug once.
describe('ageFromDob', () => {
  const today = new Date();
  const Y = today.getFullYear();
  const M = today.getMonth() + 1;
  const D = today.getDate();

  it('counts a birthday that has already passed this year', () => {
    // Born 20 years ago, on the 1st of January, which is behind us unless
    // today IS 1 January, in which case it is still exactly 20.
    expect(ageFromDob(1, 1, Y - 20)).toBe(20);
  });

  it('does not count a birthday that has not arrived yet', () => {
    // 31 December of the year they turn 20: still 19 for almost all of the
    // year. This is the case a naive `thisYear - birthYear` gets wrong, and
    // getting it wrong here means tracking a 17-year-old.
    const expected = M === 12 && D === 31 ? 20 : 19;
    expect(ageFromDob(31, 12, Y - 20)).toBe(expected);
  });

  it('treats the birthday itself as the new age', () => {
    expect(ageFromDob(D, M, Y - 18)).toBe(18);
  });

  it('is still 17 the day before turning 18', () => {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() + 1); // tomorrow's date, 18 years back
    expect(
      ageFromDob(yesterday.getDate(), yesterday.getMonth() + 1, Y - 18),
    ).toBe(17);
  });

  it('rejects dates that do not exist', () => {
    // A real calendar check, not just a range check. 31 February parses
    // happily in JS Date and silently rolls into March.
    expect(ageFromDob(31, 2, 2000)).toBeNull();
    expect(ageFromDob(30, 2, 2000)).toBeNull();
    expect(ageFromDob(31, 4, 2000)).toBeNull();
  });

  it('accepts 29 February in a leap year and rejects it otherwise', () => {
    expect(ageFromDob(29, 2, 2000)).not.toBeNull(); // leap
    expect(ageFromDob(29, 2, 2001)).toBeNull();     // not
  });

  it('rejects out-of-range and empty input', () => {
    expect(ageFromDob(0, 1, 2000)).toBeNull();
    expect(ageFromDob(1, 0, 2000)).toBeNull();
    expect(ageFromDob(1, 13, 2000)).toBeNull();
    expect(ageFromDob(32, 1, 2000)).toBeNull();
    expect(ageFromDob(0, 0, 0)).toBeNull();
  });

  it('never returns an adult age for a date in the future', () => {
    // A typo'd year must not accidentally clear the 18+ gate.
    const age = ageFromDob(D, M, Y + 1);
    expect(age === null || age < 0).toBe(true);
  });
});
