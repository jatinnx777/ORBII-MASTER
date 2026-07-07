import * as Contacts from 'expo-contacts';
import * as Crypto from 'expo-crypto';
import { RewardService } from './RewardService';
import { getItem, setItem, storageKeys } from '@/services/storage';

// ContactMatchService — OPT-IN, privacy-first fraud protection. When the user
// turns it on, we hash their address book ON THE DEVICE (SHA-256 with a fixed
// domain salt, via expo-crypto) and upload ONLY the hashes. Raw phone numbers
// never leave the phone and are never stored. The server later hashes a
// responding helper's number the same way to check "is this helper already in
// the victim's contacts?" — a strong self-dealing signal — without either side
// ever seeing the other's number.
//
// This scheme MUST byte-match hash_phone_plain() in sql/33:
//   sha256("orbii-contact-match-v1:" + last10digits)
//
// NOTE: reading contacts uses the READ_CONTACTS permission, which the Play
// Store treats as sensitive. It is OFF by default and only requested on
// explicit user consent.

const CONTACT_SALT = 'orbii-contact-match-v1';

function normalize(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
}

async function hashPhone(phone: string): Promise<string | null> {
  const n = normalize(phone);
  if (n.length < 10) return null;
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${CONTACT_SALT}:${n}`,
  );
}

export const ContactMatchService = {
  async isEnabled(): Promise<boolean> {
    return (await getItem<boolean>(storageKeys.contactMatch)) ?? false;
  },

  async lastSyncedAt(): Promise<number | null> {
    return await getItem<number>(storageKeys.contactMatchAt);
  },

  // Turn the feature on (requests permission + syncs) or off (wipes hashes).
  // Returns the number of contacts matched, or -1 if permission was denied.
  async setEnabled(on: boolean): Promise<number> {
    if (!on) {
      await setItem(storageKeys.contactMatch, false);
      await RewardService.storeContactHashesPrehashed([]); // wipe server hashes
      return 0;
    }
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') {
      await setItem(storageKeys.contactMatch, false);
      return -1;
    }
    await setItem(storageKeys.contactMatch, true);
    return this.sync();
  },

  // Re-hash and re-upload the address book. Safe to call periodically.
  async sync(): Promise<number> {
    if (!(await this.isEnabled())) return 0;
    const { data } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.PhoneNumbers],
    });
    const hashes = new Set<string>();
    for (const c of data) {
      for (const p of c.phoneNumbers ?? []) {
        if (!p.number) continue;
        const h = await hashPhone(p.number);
        if (h) hashes.add(h);
      }
    }
    await RewardService.storeContactHashesPrehashed(Array.from(hashes));
    await setItem(storageKeys.contactMatchAt, Date.now());
    return hashes.size;
  },
};
