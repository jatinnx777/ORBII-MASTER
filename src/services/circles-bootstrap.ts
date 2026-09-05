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
  Circle,
  CircleInvite,
  CircleMember,
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
//   1. Hydrate circles, members and the active-circle id from AsyncStorage, so
//      a returning user sees their real roster on the first frame rather than
//      an empty list that fills in when the network replies.
//   2. Fetch circles + pending invites from Supabase in the background.
//   3. Fetch members for the active circle.
//   4. Write the result back to the cache for next launch.
//
// Step 1 used to hydrate only the active-circle id and pass an empty circles
// array, which meant the cache prevented a header flash and nothing else.

export async function hydrateCirclesFromCache(): Promise<void> {
  // All three reads together. Serially awaiting them would put three
  // AsyncStorage round-trips in front of the first frame for no reason.
  const [cachedActive, cachedCircles, cachedMembers] = await Promise.all([
    getItem<string | null>(storageKeys.activeCircleId),
    getItem<Circle[]>(storageKeys.circlesList),
    getItem<Record<string, CircleMember[]>>(storageKeys.circleMembers),
  ]);

  store.dispatch(
    circlesHydrated({
      circles: cachedCircles ?? [],
      activeCircleId: cachedActive ?? null,
      membersByCircle: cachedMembers ?? {},
    }),
  );
}

// Members are cached for every circle, not just the active one, so switching
// circles renders the new roster instantly instead of emptying the list while
// a fetch runs. The cap exists because this is one AsyncStorage value: a user
// in many large circles would otherwise be writing a growing blob on every
// refresh, on the main thread, for a screen they may never open.
const MAX_CACHED_MEMBERS_PER_CIRCLE = 50;

async function cacheCircles(): Promise<void> {
  const s = store.getState().circles;
  const trimmed: Record<string, CircleMember[]> = {};
  for (const [id, members] of Object.entries(s.membersByCircle)) {
    trimmed[id] = members.slice(0, MAX_CACHED_MEMBERS_PER_CIRCLE);
  }
  await Promise.all([
    setItem(storageKeys.circlesList, s.circles),
    setItem(storageKeys.circleMembers, trimmed),
  ]);
}

export async function refreshCircles(): Promise<void> {
  // After the first run this no longer blanks the UI. circlesLoading() only
  // means 'loading' when there is nothing cached to look at; otherwise it
  // raises the sync line and leaves the screen alone.
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
    // Write the cache from state rather than from `circles`, so whatever
    // circlesLoaded settled on (including its activeCircleId repair) is what
    // gets persisted. Not awaited by the caller: a slow disk write must never
    // hold up a screen that already has its data.
    void cacheCircles();
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
      void cacheCircles();
    } catch {
      // Soft-fail; the UI keeps showing the cached roster, which is the whole
      // reason it is cached.
    }
  }
}

export async function refreshCircleMembers(circleId: string): Promise<void> {
  try {
    const members = await listCircleMembers(circleId);
    store.dispatch(membersLoaded({ circleId, members }));
    void cacheCircles();
  } catch {
    // Soft-fail.
  }
}
