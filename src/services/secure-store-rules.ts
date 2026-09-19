/**
 * The two decisions the hybrid secure store makes, kept free of any native
 * import so they can be tested without a device.
 *
 * Both exist because of one incident. On 19 September 2026 nobody could create
 * a circle: "new row violates row-level security policy for table circles".
 * The policy was fine. Google sessions are 3 to 6KB, Android's keystore caps a
 * value at about 2KB, so the write fell back to AsyncStorage, and the read
 * asked only the keystore, got an empty answer and reported no session. The
 * client then retried a refresh it could never complete, which is why it hung
 * for minutes, and finally sent the insert as `anon`, which matches no policy.
 */

/**
 * SecureStore's per-value ceiling, minus headroom.
 *
 * An email login's session fits under this. A Google login's does not: it
 * carries the access token, the refresh token, the identities array and the
 * provider tokens.
 */
export const SECURE_MAX_BYTES = 1800;

/**
 * Decided by size rather than by waiting for a throw, because not every
 * Android build throws. Some truncate, which is worse: the write reports
 * success and the damage only surfaces later, somewhere else.
 */
export function tooBigForKeystore(value: string): boolean {
  // Session payloads are ASCII JWTs in practice, but a display name can carry
  // multi-byte characters, so measure bytes rather than string length.
  return new TextEncoder().encode(value).length > SECURE_MAX_BYTES;
}

/**
 * A value that began life as JSON and no longer parses.
 *
 * Covers the truncating-Android case, where the keystore holds a half-written
 * session that reads back as a perfectly valid string. Without this the read
 * path would hand that to Supabase in preference to the good copy sitting in
 * AsyncStorage.
 *
 * Deliberately narrow. Not every key here is JSON: the PKCE code verifier is a
 * bare string and must not be treated as damaged. Only a value that opens like
 * an object or an array and then fails to parse is one we know is broken.
 */
export function looksTruncated(value: string): boolean {
  const head = value.trimStart()[0];
  if (head !== '{' && head !== '[') return false;
  try {
    JSON.parse(value);
    return false;
  } catch {
    return true;
  }
}
