import { describe, expect, it } from 'vitest';
import { looksTruncated, tooBigForKeystore } from './secure-store-rules';

// These two decide whether a Supabase session goes into the Android keystore
// or into AsyncStorage, and whether a value read back out is trusted. Getting
// either wrong signs every Google user out silently, which is what happened on
// 19 September 2026: creating a circle failed with "new row violates row-level
// security policy" because the request went out as `anon`.

describe('tooBigForKeystore', () => {
  it('lets a small value through, an email session fits', () => {
    expect(tooBigForKeystore('{"access_token":"short"}')).toBe(false);
  });

  it('rejects a value past the keystore ceiling, a Google session does not fit', () => {
    // A real Google session lands between 3 and 6KB.
    expect(tooBigForKeystore('x'.repeat(4000))).toBe(true);
  });

  it('measures bytes and not characters', () => {
    // 1000 emoji is 1000 characters but 4000 bytes, and the keystore counts
    // bytes. A display name in a session payload can carry these.
    expect('🙂'.repeat(1000).length).toBeLessThan(4000);
    expect(tooBigForKeystore('🙂'.repeat(1000))).toBe(true);
  });
});

describe('looksTruncated', () => {
  it('accepts whole JSON', () => {
    expect(looksTruncated('{"a":1}')).toBe(false);
  });

  it('catches JSON cut off mid-write', () => {
    expect(looksTruncated('{"access_token":"eyJhbGciOi')).toBe(true);
  });

  it('catches a truncated array', () => {
    expect(looksTruncated('[{"id":1},{"id":')).toBe(true);
  });

  it('leaves a bare string alone, the PKCE code verifier is not JSON', () => {
    expect(looksTruncated('nC8xK2pQ7vRt5wYz')).toBe(false);
  });

  it('tolerates leading whitespace before the brace', () => {
    expect(looksTruncated('  {"a":1}')).toBe(false);
    expect(looksTruncated('  {"a":')).toBe(true);
  });

  it('treats an empty string as not truncated rather than throwing', () => {
    expect(looksTruncated('')).toBe(false);
  });
});
