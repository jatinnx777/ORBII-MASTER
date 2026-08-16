import { File } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { getItem, setItem } from './storage';
import { getAgeStatus, logConsentEvent } from './consent';
import { reportError } from './error-reporting';

async function sha256Hex(bytes: Uint8Array): Promise<string | undefined> {
  try {
    const buf = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as unknown as ArrayBuffer);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

// Opt-in voice donation. A user can CHOOSE to share short clips ("help",
// "bachao", ...) to train ORBII's own keyword model. Strictly consented: nothing
// uploads unless the user has explicitly agreed (hasDonationConsent) AND is
// signed in. Clips land in the PRIVATE `voice-training` bucket (see
// sql/71_voice_training.sql); a normal user can never read anyone's samples.

const CONSENT_KEY = 'orbii:voice-donation-consent';
const BUCKET = 'voice-training';

export async function hasDonationConsent(): Promise<boolean> {
  return (await getItem<boolean>(CONSENT_KEY)) ?? false;
}
export async function setDonationConsent(on: boolean): Promise<void> {
  await setItem(CONSENT_KEY, on);
  void logConsentEvent('voice_donation', on, { method: 'checkbox' });
}

/**
 * Upload one donated clip + its label. Returns true on success. Never throws.
 * No-op (returns false) if the user hasn't consented or isn't signed in, so it
 * is impossible to upload a clip without an explicit yes.
 */
export type DonationResult = 'ok' | 'duplicate' | 'no-consent' | 'minor' | 'error';

export async function uploadVoiceSample(opts: {
  uri: string;
  phrase: string;
  lang: string;
  context?: string;
  durationMs?: number;
}): Promise<DonationResult> {
  try {
    if (!(await hasDonationConsent())) return 'no-consent';
    // DPDP: a child's biometric data must not be processed on a self-consent
    // basis. Voice donation is optional, so the safe answer for anyone who did
    // not declare adulthood is simply never to collect it.
    if ((await getAgeStatus()) === 'minor') return 'minor';
    const uid = (await supabase.auth.getSession()).data.session?.user?.id;
    if (!uid) return 'error';

    const path = opts.uri.startsWith('file://') ? opts.uri : `file://${opts.uri}`;
    const file = new File(path);
    if (!file.exists) return 'error';
    const bytes = await file.bytes();
    const sha = await sha256Hex(bytes);

    const id = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const storagePath = `${uid}/${id}.m4a`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, bytes, {
      contentType: 'audio/m4a',
      upsert: true,
    });
    if (upErr) {
      // Surface the REAL reason (e.g. "Bucket not found" = sql/71 not run yet),
      // instead of only telling the user it's their connection.
      reportError(upErr, { category: 'voice.donation', message: `storage upload failed: ${upErr.message}` });
      return 'error';
    }

    const { error: insErr } = await supabase.from('voice_samples').insert({
      user_id: uid,
      phrase: opts.phrase,
      lang: opts.lang,
      device: opts.context ? `${Platform.OS}/${opts.context}` : Platform.OS,
      storage_path: storagePath,
      duration_ms: opts.durationMs ?? null,
      sha256: sha ?? null,
      consented: true,
    });
    if (insErr) {
      // Unique-violation on sha256 => we already have this exact clip.
      if (insErr.code === '23505') return 'duplicate';
      reportError(insErr, { category: 'voice.donation', message: `insert failed: ${insErr.message}` });
      return 'error';
    }
    return 'ok';
  } catch (err) {
    reportError(err, { category: 'voice.donation', message: 'voice sample upload failed' });
    return 'error';
  }
}
