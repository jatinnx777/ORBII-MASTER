import { describe, it, expect } from 'vitest';
import { parseReferrer, normaliseCode } from './referral';

/**
 * The install referrer arrives as an opaque, usually URL-encoded string that
 * Google hands over verbatim from whatever was on the poster link. Everything
 * that can go wrong with it goes wrong silently: a bad parse binds a user to
 * nobody, and nobody finds out until an ambassador asks why their count is zero.
 */

describe('normaliseCode', () => {
  it('accepts a plain code and uppercases it', () => {
    expect(normaliseCode('srms01')).toBe('SRMS01');
    expect(normaliseCode('  SRMS01  ')).toBe('SRMS01');
  });

  it('accepts O and I, which sql/104 allows again', () => {
    // An earlier constraint banned them to avoid confusing O with 0 on a poster.
    // It also banned ORBII01, DELHI01 and NOIDA02, which is most of what anybody
    // would actually pick, so the rule cost more than the ambiguity did.
    expect(normaliseCode('ORBII01')).toBe('ORBII01');
    expect(normaliseCode('DELHI01')).toBe('DELHI01');
    expect(normaliseCode('SONIPAT01')).toBe('SONIPAT01');
  });

  it('rejects anything outside 4 to 12 characters', () => {
    expect(normaliseCode('AB1')).toBeNull();
    expect(normaliseCode('A'.repeat(13))).toBeNull();
    expect(normaliseCode('ABCD')).toBe('ABCD');
  });

  it('rejects punctuation and spaces inside the code', () => {
    expect(normaliseCode('SRMS-01')).toBeNull();
    expect(normaliseCode('SRMS 01')).toBeNull();
  });

  it('survives empty and junk without throwing', () => {
    expect(normaliseCode('')).toBeNull();
    expect(normaliseCode('   ')).toBeNull();
  });
});

describe('parseReferrer', () => {
  it('reads a bare code', () => {
    expect(parseReferrer('SRMS01')).toBe('SRMS01');
  });

  it('reads the URL-encoded form Play actually sends', () => {
    // Play hands back the raw referrer parameter, and it is normally encoded.
    expect(parseReferrer('ref%3DSRMS01')).toBe('SRMS01');
  });

  it('finds ref= among other campaign keys', () => {
    expect(parseReferrer('utm_source%3Dposter%26ref%3DSRMS01')).toBe('SRMS01');
    expect(parseReferrer('ref=SRMS01&utm_medium=print')).toBe('SRMS01');
  });

  it('is not fooled by a key that merely ends in ref', () => {
    // preref=X must not match. The regex anchors on a boundary for this reason.
    expect(parseReferrer('preref%3DWRONG%26ref%3DSRMS01')).toBe('SRMS01');
  });

  it('returns null for the Play Store default', () => {
    // Organic installs send this. It is the single most common value.
    expect(parseReferrer('utm_source=google-play&utm_medium=organic')).toBeNull();
  });

  it('returns null rather than guessing at an invalid code', () => {
    // Binding a user to a code that does not exist is worse than binding them
    // to nothing, because it looks attributed and never activates.
    expect(parseReferrer('ref%3DNOT_A_CODE!')).toBeNull();
    expect(parseReferrer('ref%3DAB1')).toBeNull(); // too short to be a code
  });

  it('survives malformed percent-encoding', () => {
    // decodeURIComponent throws on a lone %. It must fall through, not crash
    // the first launch of the app.
    expect(() => parseReferrer('%')).not.toThrow();
    expect(() => parseReferrer('ref%3DSRMS01%')).not.toThrow();
  });

  it('survives empty input', () => {
    expect(parseReferrer('')).toBeNull();
  });

  it('is case insensitive on the key', () => {
    expect(parseReferrer('REF%3Dsrms01')).toBe('SRMS01');
  });
});
