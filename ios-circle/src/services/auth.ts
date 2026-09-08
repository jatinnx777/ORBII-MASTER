import { supabase } from './supabase';

/**
 * Email one-time code, the same path the main app uses.
 *
 * NO PASSWORDS, deliberately. The person opening this app is often a parent
 * who installed it once, months ago, on an evening they would rather forget,
 * and who is now opening it because their phone buzzed. A forgotten password
 * at that moment is a failure of the product, not of the user.
 */

export async function sendCode(email: string): Promise<{ ok: boolean; message?: string }> {
  const clean = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(clean)) {
    return { ok: false, message: 'That does not look like an email address.' };
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: clean,
    options: { shouldCreateUser: true },
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function verifyCode(
  email: string,
  code: string,
): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: code.trim(),
    type: 'email',
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut().catch(() => undefined);
}

export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}
