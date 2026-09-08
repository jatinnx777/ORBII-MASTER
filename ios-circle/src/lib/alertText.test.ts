import { describe, it, expect } from 'vitest';
import { describeAlert, minutesSince, titleFor, triggerNote, } from './alertText';
import type { CircleAlert } from '../services/alerts';

/**
 * The alert card is the first thing a person sees when somebody they love is
 * in trouble, and both lines on it change what that person does in the next
 * thirty seconds. Neither is checkable by a compiler.
 */

const base: CircleAlert = {
  sos_id: 's1',
  user_id: 'u1',
  name: 'Aditi',
  photo_url: null,
  lat: 28.6,
  lng: 77.2,
  address: null,
  created_at: new Date(Date.now() - 120_000).toISOString(),
  responders: 0,
  claimed: 0,
  trigger: 'manual',
};

describe('titleFor', () => {
  it('says a fall or crash when a sensor raised it', () => {
    // The distinction that matters most on this screen. "Needs help" implies
    // she chose to ask, and the sensible response to that is to phone her.
    // A detected impact means she may be unable to pick up.
    expect(titleFor({ ...base, trigger: 'impact' })).toBe('Aditi may have had a fall or crash');
  });

  it('names a hands-free trigger', () => {
    expect(titleFor({ ...base, trigger: 'voice' })).toBe('Aditi said the word');
  });

  it('falls back to needing help', () => {
    expect(titleFor(base)).toBe('Aditi needs help');
  });
});

describe('triggerNote', () => {
  it('warns that she may not be able to answer a call', () => {
    expect(triggerNote({ ...base, trigger: 'impact' })).toContain('may not be able to answer');
  });

  it('adds nothing to an ordinary alert', () => {
    // A note under every alert is a note nobody reads.
    expect(triggerNote(base)).toBeNull();
  });
});

describe('describeAlert', () => {
  it('leads with nobody having responded', () => {
    // The fact that decides whether the reader gets up. That an alert was sent
    // is something they already know from reading this screen.
    expect(describeAlert(base)).toContain('Nobody has responded yet');
  });

  it('distinguishes claimed from arrived', () => {
    // Somebody having taken this on is not somebody being there, and the two
    // reading the same would stop a second person setting off.
    const m = describeAlert({ ...base, responders: 0, claimed: 1 });
    expect(m).toContain('taken this on');
    expect(m).toContain('nobody has arrived');
  });

  it('counts responders with the right grammar', () => {
    expect(describeAlert({ ...base, responders: 1 })).toContain('1 person is responding');
    expect(describeAlert({ ...base, responders: 3 })).toContain('3 people are responding');
  });
});

describe('minutesSince', () => {
  it('never goes negative on a clock that is slightly ahead', () => {
    // Phone clocks drift. "-1 minutes ago" on an emergency screen reads as a
    // broken app at the worst possible moment.
    const future = new Date(Date.now() + 30_000).toISOString();
    expect(minutesSince(future)).toBe(0);
  });

  it('returns zero rather than NaN for an unparseable date', () => {
    expect(minutesSince('not a date')).toBe(0);
  });

  it('floors rather than rounds', () => {
    // 119 seconds is one minute, not two. Overstating how long somebody has
    // been waiting is the wrong direction to be wrong in.
    const t = new Date(Date.now() - 119_000).toISOString();
    expect(minutesSince(t)).toBe(1);
  });
});
