import * as Contacts from 'expo-contacts';
import { RewardService } from './RewardService';
import { getItem, setItem, storageKeys } from '@/services/storage';

// ContactMatchService — OPT-IN, privacy-first fraud protection.
//
// We used to hash the address book on the device with a salt baked into the
// APK. That looked safer than it was: anyone can extract that salt, and Indian
// mobile numbers are only ~4 billion candidates, so a leak of
// `victim_contact_hashes` could be brute-forced back into real phone books on
// a single GPU.
//
// Now the numbers are sent over TLS to `store_contact_hashes`, a SECURITY
// DEFINER function that hashes them with a pepper held in `reward_secrets` —
// a table with RLS and NO read policy, so no client can ever read it. Raw
// digits are hashed on arrival and only the hash is persisted; nothing raw is
// ever written to a table. Reversing the hashes now requires a full database
// dump, not just the app binary.
//
// NOTE: reading contacts uses the READ_CONTACTS permission, which the Play
// Store treats as sensitive. It is OFF by default and only requested on
// explicit user consent.

function normalize(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10);
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

  // Re-upload the address book for hashing. Safe to call periodically.
  async sync(): Promise<number> {
    if (!(await this.isEnabled())) return 0;
    const { data } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.PhoneNumbers],
    });
    // Normalised, de-duplicated. Sent over TLS and hashed server-side with a
    // pepper no client can read; the raw digits are never stored anywhere.
    const numbers = new Set<string>();
    for (const c of data) {
      for (const p of c.phoneNumbers ?? []) {
        if (!p.number) continue;
        const n = normalize(p.number);
        if (n.length === 10) numbers.add(n);
      }
    }
    await RewardService.storeContactHashes(Array.from(numbers));
    await setItem(storageKeys.contactMatchAt, Date.now());
    return numbers.size;
  },
};
