import { store } from '@/redux/store';
import {
  activeCircleChanged,
  circlesErrored,
  circlesHydrated,
  circlesLoaded,
  circlesLoading,
  circlesSetupNeeded,
  incomingInvitesLoaded,
  membersLoaded,
} from '@/redux/slices/circlesSlice';
import {
  CirclesNotInstalledError,
  listCircles,
  listCircleMembers,
  listIncomingInvites,
} from './circles';
import { getItem, setItem, storageKeys } from './storage';

// Circles bootstrap. Runs after auth so we never hit Supabase with no
// session. Order of operations:
//   1. Hydrate the cached active-circle id from AsyncStorage so the Home
//      header doesn't flash to "All circles" before the server replies.
//   2. Fetch circles + pending invites from Supabase.
//   3. Fetch members for the active circle so the Home map can render its
//      circle peers immediately.

export async function hydrateCirclesFromCache(): Promise<void> {
  const cachedActive = await getItem<string | null>(storageKeys.activeCircleId);
  store.dispatch(
    circlesHydrated({ circles: [], activeCircleId: cachedActive ?? null }),
  );
}

export async function refreshCircles(): Promise<void> {
  store.dispatch(circlesLoading());
  try {
    const [circles, invites] = await Promise.all([
      listCircles(),
      listIncomingInvites().catch(() => []),
    ]);
    store.dispatch(circlesLoaded(circles));
    store.dispatch(incomingInvitesLoaded(invites));
    const active = store.getState().circles.activeCircleId;
    if (active) {
      const members = await listCircleMembers(active).catch(() => []);
      store.dispatch(membersLoaded({ circleId: active, members }));
    }
  } catch (err) {
    if (err instanceof CirclesNotInstalledError) {
      store.dispatch(circlesSetupNeeded());
      return;
    }
    const message = err instanceof Error ? err.message : 'Could not load circles.';
    store.dispatch(circlesErrored(message));
  }
}

export async function setActiveCircle(circleId: string | null): Promise<void> {
  store.dispatch(activeCircleChanged(circleId));
  await setItem(storageKeys.activeCircleId, circleId);
  if (circleId) {
    try {
      const members = await listCircleMembers(circleId);
      store.dispatch(membersLoaded({ circleId, members }));
    } catch {
      // Soft-fail; UI shows last cached members.
    }
  }
}

export async function refreshCircleMembers(circleId: string): Promise<void> {
  try {
    const members = await listCircleMembers(circleId);
    store.dispatch(membersLoaded({ circleId, members }));
  } catch {
    // Soft-fail.
  }
}
