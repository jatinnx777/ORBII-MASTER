import { store } from './store';
import { getItem, setItem, storageKeys } from '@/services/storage';
import { historyHydrated } from './slices/historySlice';
import { helperHydrated } from './slices/helperSlice';
import { appHydrated } from './slices/appSlice';
import type { HelperState, SOSRecord } from '@/types';

type PersistedApp = {
  onboarded?: boolean;
  voiceDetection?: boolean;
  pushEnabled?: boolean;
};

export async function hydrateStore() {
  const [history, helper, appSettings] = await Promise.all([
    getItem<SOSRecord[]>(storageKeys.history),
    getItem<HelperState>(storageKeys.helperEarnings),
    getItem<PersistedApp>(storageKeys.settings),
  ]);

  store.dispatch(historyHydrated(history ?? []));
  if (helper) store.dispatch(helperHydrated(helper));
  store.dispatch(appHydrated(appSettings ?? {}));

  subscribePersist();
}

function subscribePersist() {
  let prev = store.getState();
  store.subscribe(() => {
    const next = store.getState();
    if (next.history.records !== prev.history.records) {
      setItem(storageKeys.history, next.history.records);
    }
    if (next.helper !== prev.helper) {
      setItem(storageKeys.helperEarnings, next.helper);
    }
    if (
      next.app.onboarded !== prev.app.onboarded ||
      next.app.voiceDetection !== prev.app.voiceDetection ||
      next.app.pushEnabled !== prev.app.pushEnabled
    ) {
      setItem<PersistedApp>(storageKeys.settings, {
        onboarded: next.app.onboarded,
        voiceDetection: next.app.voiceDetection,
        pushEnabled: next.app.pushEnabled,
      });
    }
    prev = next;
  });
}
