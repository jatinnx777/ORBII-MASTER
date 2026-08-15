import { RewardService } from './RewardService';
import { getItem, setItem, storageKeys } from '@/services/storage';

// ContactMatchService, DISABLED for the Play Store build.
//
// This opt-in anti-fraud feature hashed the address book to detect reward
// abuse, but it needs READ_CONTACTS, a Play "sensitive permission" that
// triggers manual review and is a common rejection cause. READ_CONTACTS is
// force-removed from the manifest, so this service is now a stub: it never
// requests contacts. The "off/wipe" path stays so any previously-stored hashes
// can still be cleared. Re-enable by restoring the git history + the manifest
// permission (and filing the Play Permissions Declaration Form) if wanted.

export const ContactMatchService = {
  async isEnabled(): Promise<boolean> {
    return false;
  },

  async lastSyncedAt(): Promise<number | null> {
    return await getItem<number>(storageKeys.contactMatchAt);
  },

  // Turning it "on" reports unavailable (-1) without touching contacts; turning
  // it off still wipes any hashes stored server-side.
  async setEnabled(on: boolean): Promise<number> {
    await setItem(storageKeys.contactMatch, false);
    if (!on) {
      await RewardService.storeContactHashesPrehashed([]);
      return 0;
    }
    return -1;
  },

  async sync(): Promise<number> {
    return 0;
  },
};
