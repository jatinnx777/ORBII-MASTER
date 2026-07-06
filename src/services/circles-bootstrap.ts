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
  CircleInvite,
  CirclesNotInstalledError,
  listCircles,
  listCircleMembers,
  listIncomingInvites,
  resolveInviterNames,
} from './circles';
import { fireLocalNotification } from './notifications';
import { getItem, setItem, storageKeys } from './storage';

// Instagram-style invite alerts. Every time we refresh invites we diff against
// the ids we've already announced; any brand-new pending invite fires a device
// push + drops into the in-app notifications feed. `seen` is pinned to the
// currently-pending ids, so an invite is announced exactly once, and a fresh
// re-invite (new row id) will alert again.
async function announceNewInvites(invites: CircleInvite[]): Promise<void> {
  try {
    const currentIds = invites.map((i) => i.id);
    const seen = (await getItem<string[]>(storageKeys.inviteSeen)) ?? [];
    const seenSet = new Set(seen);
    const fresh = invites.filter((i) => !seenSet.has(i.id));

    // Persist first so a crash mid-notify can't double-announce on next run.
    await setItem(storageKeys.inviteSeen, currentIds);

    if (fresh.length === 0) return;

    const names = await resolveInviterNames(fresh.map((i) => i.inviterId)).catch(
      () => new Map<string, string>(),
    );
    for (const invite of fresh) {
      const who = names.get(invite.inviterId) ?? 'Someone';
      await fireLocalNotification(
        'New circle invite',
        `${who} invited you to their ORBII circle. Tap to accept.`,
        { kind: 'circle_invite', inviteId: invite.id, token: invite.token },
        'system',
      );
    }
  } catch {
    // Notifications are a nicety; never let them break the circles refresh.
  }
}

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
    void announceNewInvites(invites);
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
