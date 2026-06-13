import { getItem, setItem, storageKeys } from './storage';
import { supabase } from './supabase';

// Voice SOS monthly limits.
//   • Free  : 2 voice activations per calendar month.
//   • Premium: unlimited.
//
// The count is tracked locally (AsyncStorage, monthly bucket) so gating
// works instantly and offline, and for phone-OTP users who have no Supabase
// session. When a session exists we also mirror the count to Supabase
// (sql/13_voice_usage.sql) for cross-device + analytics — best-effort.
//
// Safety note: this NEVER blocks an emergency. The manual SOS button is
// always free and unlimited; the limit only gates the hands-free *voice*
// convenience and nudges an upgrade.

export const FREE_VOICE_LIMIT = 2;

type Usage = { period: string; count: number };

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function read(): Promise<Usage> {
  const u = await getItem<Usage>(storageKeys.voiceUsage);
  const period = currentPeriod();
  if (!u || u.period !== period) return { period, count: 0 };
  return u;
}

export type VoiceStatus = {
  allowed: boolean;
  used: number;
  remaining: number;
  limit: number;
  unlimited: boolean;
};

export async function voiceSOSStatus(isPremium: boolean): Promise<VoiceStatus> {
  if (isPremium) {
    return { allowed: true, used: 0, remaining: Infinity, limit: Infinity, unlimited: true };
  }
  const u = await read();
  return {
    allowed: u.count < FREE_VOICE_LIMIT,
    used: u.count,
    remaining: Math.max(0, FREE_VOICE_LIMIT - u.count),
    limit: FREE_VOICE_LIMIT,
    unlimited: false,
  };
}

/** Record one voice activation against this month's quota. */
export async function recordVoiceSOS(): Promise<void> {
  const u = await read();
  await setItem<Usage>(storageKeys.voiceUsage, { period: u.period, count: u.count + 1 });
  // best-effort server mirror (ignored if not signed in / table missing)
  try {
    await supabase.rpc('record_voice_sos', { p_period: u.period });
  } catch {
    // ignore
  }
}
