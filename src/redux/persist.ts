import { store } from './store';
import { getItem, setItem, storageKeys, removeItem } from '@/services/storage';
import { historyHydrated } from './slices/historySlice';
import { appHydrated } from './slices/appSlice';
import { profileHydrated } from './slices/userSlice';
import { safetyModesHydrated } from './slices/safetyModesSlice';
import { syncProfile } from '@/services/profile-sync';
import { cacheContactsLocally } from '@/services/emergency-contacts';
import { cacheProfileLocally } from '@/services/profile-cache';
import type { GhostModeState, DeadmanTimerState } from './slices/safetyModesSlice';
import {
  clearSession,
  isSessionExpired,
  touchSession,
} from '@/services/session';
import type { SOSRecord, UserProfile } from '@/types';

type PersistedApp = {
  onboarded?: boolean;
  alertVibration?: boolean;
  pushEnabled?: boolean;
  helperMode?: boolean;
  policyAcceptedAt?: number | null;
};

export async function hydrateStore() {
  const expired = await isSessionExpired();
  if (expired) {
    // 2-week TTL burned. Drop the stale profile so user is sent back to auth.
    await Promise.all([
      removeItem(storageKeys.profile),
      clearSession(),
    ]);
  }

  const [history, appSettings, profile, safetyModes] = await Promise.all([
    getItem<SOSRecord[]>(storageKeys.history),
    getItem<PersistedApp>(storageKeys.settings),
    expired ? Promise.resolve(null) : getItem<UserProfile>(storageKeys.profile),
    getItem<{ ghost?: GhostModeState; deadman?: DeadmanTimerState }>(
      storageKeys.safetyModes,
    ),
  ]);

  store.dispatch(historyHydrated(history ?? []));
  store.dispatch(appHydrated(appSettings ?? {}));
  if (profile) {
    store.dispatch(profileHydrated(profile));
    await touchSession();
  }
  if (safetyModes) {
    // If a deadman timer was armed and has since expired while the app
    // was killed, drop the local copy, the local notification already
    // fired (or is about to). The user-facing "your timer expired"
    // surface is the notification, not the slice.
    const now = Date.now();
    const dead = safetyModes.deadman;
    if (dead && dead.active && dead.expiresAt && dead.expiresAt < now) {
      // expired during downtime: don't rehydrate as active.
    } else {
      store.dispatch(safetyModesHydrated(safetyModes));
    }
  }

  subscribePersist();
}

function subscribePersist() {
  let prev = store.getState();
  store.subscribe(() => {
    const next = store.getState();
    if (next.history.records !== prev.history.records) {
      setItem(storageKeys.history, next.history.records);
    }
    if (
      next.app.onboarded !== prev.app.onboarded ||
      next.app.alertVibration !== prev.app.alertVibration ||
      next.app.pushEnabled !== prev.app.pushEnabled ||
      next.app.helperMode !== prev.app.helperMode ||
      next.app.policyAcceptedAt !== prev.app.policyAcceptedAt
    ) {
      setItem<PersistedApp>(storageKeys.settings, {
        onboarded: next.app.onboarded,
        alertVibration: next.app.alertVibration,
        pushEnabled: next.app.pushEnabled,
        helperMode: next.app.helperMode,
        policyAcceptedAt: next.app.policyAcceptedAt,
      });
    }
    if (next.user.profile !== prev.user.profile) {
      if (next.user.profile) {
        setItem(storageKeys.profile, next.user.profile);
        touchSession();
        // Best-effort server-side sync. Fails silently if the profiles
        // table isn't in Supabase yet.
        void syncProfile(next.user.profile);
        // Durable, per-user safety cache of emergency contacts. Survives
        // sign-out (unlike the session profile above) so contacts are never
        // lost even if a server write failed, merged back in on next login.
        void cacheContactsLocally(
          next.user.profile.uid,
          next.user.profile.emergencyContacts,
        );
        // Same safety net for the identity fields (name / username / photo /
        // phone), so an edit survives sign-out even if the server sync failed.
        void cacheProfileLocally(next.user.profile);
      } else {
        // Sign-out clears the session profile, but NOT the per-user contacts
        // cache, re-login restores it.
        removeItem(storageKeys.profile);
        clearSession();
      }
    }
    if (next.safetyModes !== prev.safetyModes) {
      setItem(storageKeys.safetyModes, next.safetyModes);
    }
    prev = next;
  });
}
