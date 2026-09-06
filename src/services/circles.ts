import { supabase } from './supabase';
import type { GeoPoint } from '@/types';

// Circle = a private group of trusted people. A user belongs to many circles
// (Family / College / Trip / Women-only / Emergency …). This file is the
// thin RPC layer that the rest of the app uses; persistence is handled by
// the circlesSlice + AsyncStorage so the UI works offline.

// Detects the Postgres "relation does not exist" error that happens when
// the user hasn't yet pasted sql/09_circles.sql into their Supabase SQL
// editor. The UI shows a clear setup banner instead of a cryptic backend
// message so the user knows exactly what to do.
export class CirclesNotInstalledError extends Error {
  constructor() {
    super(
      'Circles tables are not set up on your Supabase project yet. Open Supabase → SQL Editor → paste the contents of sql/09_circles.sql and run it.',
    );
    this.name = 'CirclesNotInstalledError';
  }
}

function isMissingTableError(message: string, code?: string): boolean {
  // Postgres error 42P01 = undefined_table. Supabase surfaces this as
  // `{ code: '42P01', message: 'relation … does not exist' }` or, when
  // the schema cache is stale, as a "Could not find the table 'public.X'
  // in the schema cache" string. We catch both flavours.
  if (code === '42P01') return true;
  const m = message.toLowerCase();
  return (
    (m.includes('relation') && m.includes('does not exist'))
    || m.includes("could not find the table 'public.circles'")
    || m.includes("could not find the 'public.circles' table")
    || m.includes("schema cache")
  );
}

// Supabase service errors are plain objects ({ code, message, details, hint })
// not `Error` instances, so `new Error(err)` would stringify them to
// "[object Object]". This normaliser extracts whatever readable text
// exists, and also detects the missing-table case so we can show a clear
// setup banner instead of a cryptic backend message.
function wrap(err: unknown): Error {
  if (err instanceof Error) {
    if (isMissingTableError(err.message)) return new CirclesNotInstalledError();
    return err;
  }
  if (err && typeof err === 'object') {
    const obj = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [obj.message, obj.details, obj.hint]
      .filter((p): p is string => typeof p === 'string' && p.length > 0);
    const message = parts.length > 0 ? parts.join(' · ') : 'Backend request failed.';
    const code = typeof obj.code === 'string' ? obj.code : undefined;
    if (isMissingTableError(message, code)) return new CirclesNotInstalledError();
    return new Error(message);
  }
  return new Error(String(err) || 'Backend request failed.');
}

export type CircleKind =
  | 'family'
  | 'friends'
  | 'trip'
  | 'college'
  | 'women'
  | 'emergency'
  | 'general';

export type CircleRole = 'owner' | 'admin' | 'member';

export type Circle = {
  id: string;
  ownerId: string;
  name: string;
  kind: CircleKind;
  color: string;
  emoji: string | null;
  isDefault: boolean;
  /**
   * The six letter code somebody types to join (sql/125). Read it out, they
   * type it, they are in.
   *
   * It replaced a searchable directory. Adding people by looking them up meant
   * the directory had to be searchable, and a searchable index of women who
   * installed a personal safety app is the worst thing this product could own.
   * A code inverts that: nothing is enumerable, and the person joining has to
   * have been told it.
   */
  joinCode: string | null;
  createdAt: number;
  updatedAt: number;
};

/**
 * Relationship options, in the order they are offered.
 *
 * Parents first because a parent watching a daughter is the commonest circle
 * ORBII has, then the reverse, then siblings, then everything else. 'Other'
 * exists so nobody has to pick a wrong answer, and there is deliberately no
 * free-text option: a label everyone else in the circle reads should not be a
 * place to write a sentence.
 */
export type CircleRelation =
  | 'mother' | 'father' | 'daughter' | 'son'
  | 'sister' | 'brother' | 'partner' | 'grandparent'
  | 'friend' | 'roommate' | 'colleague' | 'other';

export const RELATION_LABELS: Record<CircleRelation, string> = {
  mother: 'Mum',
  father: 'Dad',
  daughter: 'Daughter',
  son: 'Son',
  sister: 'Sister',
  brother: 'Brother',
  partner: 'Partner',
  grandparent: 'Grandparent',
  friend: 'Friend',
  roommate: 'Roommate',
  colleague: 'Colleague',
  other: 'Other',
};

/** Set your own relationship in a circle. Nobody can set anyone else's. */
export async function setMyRelation(
  circleId: string,
  relation: CircleRelation | null,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_my_circle_relation', {
    p_circle: circleId,
    p_relation: relation,
  });
  return !error && data === true;
}

/**
 * Join a circle with its six letter code.
 *
 * Returns the circle id, or null when the code matches nothing. Null rather
 * than an exception, so a typo is a message and not a crash. Anything the
 * server refuses outright (a full circle, a revoked member, too many attempts)
 * throws with a sentence worth showing.
 */
export async function joinCircleByCode(code: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('join_circle_by_code', {
    p_code: code.trim().toUpperCase(),
  });
  if (error) throw new Error(error.message);
  return typeof data === 'string' ? data : null;
}

/** Roll the code. Owner and admins only; the server enforces that, not this. */
export async function rotateJoinCode(circleId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('rotate_circle_code', { p_circle: circleId });
  if (error) throw new Error(error.message);
  return typeof data === 'string' ? data : null;
}

export type CircleMember = {
  id: string;
  circleId: string;
  userId: string;
  role: CircleRole;
  /**
   * Who they are to the circle, as opposed to what they may do (that is
   * `role`). Optional: a woman adding a colleague to a walk-home circle has no
   * answer to "what are they to you", and the app should not insist.
   *
   * Set by the person it describes and nobody else, so a flatmate cannot find
   * herself listed as somebody's daughter.
   */
  relation?: CircleRelation | null;
  joinedAt: number;
  // Hydrated from users_public when available.
  username?: string | null;
  name?: string | null;
  photoUrl?: string | null;
};

export type CircleInvite = {
  id: string;
  circleId: string;
  inviterId: string;
  inviteeUsername: string | null;
  inviteePhone: string | null;
  token: string;
  status: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';
  expiresAt: number;
  createdAt: number;
  respondedAt: number | null;
};

export type SharedTrip = {
  id: string;
  circleId: string;
  ownerId: string;
  label: string;
  destination: GeoPoint | null;
  startAt: number;
  endAt: number | null;
  status: 'active' | 'arrived' | 'expired' | 'cancelled';
};

type CircleRow = {
  id: string;
  owner_id: string;
  name: string;
  kind: CircleKind;
  color: string;
  emoji: string | null;
  is_default: boolean;
  join_code?: string | null;
  created_at: string;
  updated_at: string;
};

type MemberRow = {
  id: string;
  circle_id: string;
  user_id: string;
  role: CircleRole;
  relation?: CircleRelation | null;
  joined_at: string;
};

type InviteRow = {
  id: string;
  circle_id: string;
  inviter_id: string;
  invitee_username: string | null;
  invitee_phone: string | null;
  token: string;
  status: CircleInvite['status'];
  expires_at: string;
  created_at: string;
  responded_at: string | null;
};

type TripRow = {
  id: string;
  circle_id: string;
  owner_id: string;
  label: string;
  destination: GeoPoint | null;
  start_at: string;
  end_at: string | null;
  status: SharedTrip['status'];
};

function rowToCircle(row: CircleRow): Circle {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    kind: row.kind,
    color: row.color,
    emoji: row.emoji,
    isDefault: row.is_default,
    joinCode: row.join_code ?? null,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
  };
}

function rowToMember(row: MemberRow): CircleMember {
  return {
    id: row.id,
    circleId: row.circle_id,
    userId: row.user_id,
    role: row.role,
    relation: row.relation ?? null,
    joinedAt: Date.parse(row.joined_at),
  };
}

function rowToInvite(row: InviteRow): CircleInvite {
  return {
    id: row.id,
    circleId: row.circle_id,
    inviterId: row.inviter_id,
    inviteeUsername: row.invitee_username,
    inviteePhone: row.invitee_phone,
    token: row.token,
    status: row.status,
    expiresAt: Date.parse(row.expires_at),
    createdAt: Date.parse(row.created_at),
    respondedAt: row.responded_at ? Date.parse(row.responded_at) : null,
  };
}

function rowToTrip(row: TripRow): SharedTrip {
  return {
    id: row.id,
    circleId: row.circle_id,
    ownerId: row.owner_id,
    label: row.label,
    destination: row.destination,
    startAt: Date.parse(row.start_at),
    endAt: row.end_at ? Date.parse(row.end_at) : null,
    status: row.status,
  };
}

// Returns every circle the signed-in user belongs to, sorted by recency.
export async function listCircles(): Promise<Circle[]> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return [];
  // Pull circle ids via membership, then fetch the circle rows. We do this
  // in two hops because Supabase RLS makes the obvious join awkward.
  const { data: memberRows, error: memberErr } = await supabase
    .from('circle_members')
    .select('circle_id')
    .eq('user_id', user.id);
  if (memberErr) throw wrap(memberErr);
  const ids = (memberRows ?? []).map((r) => r.circle_id);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('circles')
    .select('*')
    .in('id', ids)
    .order('updated_at', { ascending: false });
  if (error) throw wrap(error);
  return (data ?? []).map((r) => rowToCircle(r as CircleRow));
}

// Creates a new circle. Owner is auto-added as a member via DB trigger.
export async function createCircle(input: {
  name: string;
  kind?: CircleKind;
  color?: string;
  emoji?: string | null;
  isDefault?: boolean;
}): Promise<Circle> {
  // Phone-bypass users have no real session, so the create request would
  // hit Postgres as `anon` and fail RLS with a confusing message. Pull
  // the session explicitly so we can short-circuit with a clearer error.
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData.session?.user ?? null;
  if (!user) {
    throw new Error(
      'You need a real ORBII account to create circles. Sign in with Google from the Welcome screen. Phone OTP demo profiles can\'t create circles yet.',
    );
  }
  const trimmed = input.name.trim();
  if (!trimmed) throw new Error('Circle needs a name.');
  if (input.isDefault) {
    // Demote any other default first so there's exactly one.
    await supabase
      .from('circles')
      .update({ is_default: false })
      .eq('owner_id', user.id)
      .eq('is_default', true);
  }
  const { data, error } = await supabase
    .from('circles')
    .insert({
      owner_id: user.id,
      name: trimmed,
      kind: input.kind ?? 'general',
      color: input.color ?? '#7FA86B',
      emoji: input.emoji ?? null,
      is_default: input.isDefault ?? false,
    })
    .select('*')
    .single();
  if (error) throw wrap(error);

  // Ensure the owner is a member. A DB trigger (sql/14) is supposed to do
  // this, but if it isn't installed the circle would be created yet never
  // show up (listCircles reads via circle_members), the "create does
  // nothing" bug. This self-insert is idempotent: it's a no-op (duplicate
  // key) when the trigger already added the row, and passes RLS because the
  // user is adding themselves.
  // NO SECOND INSERT. The circles_add_owner trigger (sql/44) fires after every
  // circle insert and adds the owner as a member in the same transaction.
  //
  // This used to insert the owner again from the app and then swallow the
  // duplicate error, which is the tell: it was a second network round trip
  // doing what the database had already done before the first one returned.
  // On Indian mobile that was ~300ms added to every circle creation, and the
  // person waiting on it had already pressed the button.
  return rowToCircle(data as CircleRow);
}

export async function renameCircle(circleId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Circle needs a name.');
  const { error } = await supabase
    .from('circles')
    .update({ name: trimmed })
    .eq('id', circleId);
  if (error) throw wrap(error);
}

export async function deleteCircle(circleId: string): Promise<void> {
  const { error } = await supabase.from('circles').delete().eq('id', circleId);
  if (error) throw wrap(error);
}

// Drops the current user from a circle. Owners cannot leave; they must
// delete the circle instead.
export async function leaveCircle(circleId: string): Promise<void> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error('Sign in to leave a circle.');
  const { error } = await supabase
    .from('circle_members')
    .delete()
    .eq('circle_id', circleId)
    .eq('user_id', user.id);
  if (error) throw wrap(error);
}

// Members for a single circle. Joined with users_public so the UI has
// names + photos without a second round-trip.
export async function listCircleMembers(circleId: string): Promise<CircleMember[]> {
  const { data, error } = await supabase
    .from('circle_members')
    .select('*')
    .eq('circle_id', circleId)
    .order('joined_at', { ascending: true });
  if (error) throw wrap(error);
  const members = (data ?? []).map((r) => rowToMember(r as MemberRow));
  if (members.length === 0) return members;
  const ids = members.map((m) => m.userId);
  const { data: profiles } = await supabase
    .from('users_public')
    .select('id, username, name, photo_url')
    .in('id', ids);
  const byId = new Map<string, { username: string; name: string | null; photo_url: string | null }>();
  (profiles ?? []).forEach((p: { id: string; username: string; name: string | null; photo_url: string | null }) => byId.set(p.id, p));
  return members.map((m) => {
    const p = byId.get(m.userId);
    return {
      ...m,
      username: p?.username ?? null,
      name: p?.name ?? null,
      photoUrl: p?.photo_url ?? null,
    };
  });
}

export async function inviteByUsername(
  circleId: string,
  username: string,
): Promise<CircleInvite> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error('Sign in to invite.');
  const trimmed = username.replace(/^@/, '').trim();
  if (!trimmed) throw new Error('Enter a username.');
  const { data, error } = await supabase
    .from('circle_invites')
    .insert({
      circle_id: circleId,
      inviter_id: user.id,
      invitee_username: trimmed,
    })
    .select('*')
    .single();
  if (error) throw wrap(error);
  return rowToInvite(data as InviteRow);
}

export async function inviteByPhone(
  circleId: string,
  phoneE164: string,
): Promise<CircleInvite> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error('Sign in to invite.');
  const { data, error } = await supabase
    .from('circle_invites')
    .insert({
      circle_id: circleId,
      inviter_id: user.id,
      invitee_phone: phoneE164,
    })
    .select('*')
    .single();
  if (error) throw wrap(error);
  return rowToInvite(data as InviteRow);
}

// Pending invites the current user has been sent (by username match).
export async function listIncomingInvites(): Promise<CircleInvite[]> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return [];
  const { data: profile } = await supabase
    .from('users_public')
    .select('username')
    .eq('id', user.id)
    .maybeSingle();
  const username = profile?.username ?? null;
  if (!username) return [];
  const { data, error } = await supabase
    .from('circle_invites')
    .select('*')
    .ilike('invitee_username', username)
    .eq('status', 'pending');
  if (error) throw wrap(error);
  return (data ?? []).map((r) => rowToInvite(r as InviteRow));
}

// Best-effort display names for a set of inviter ids, for invite
// notifications. Non-members can't read the circle row (RLS), but
// users_public is world-readable, so we can at least name the inviter.
export async function resolveInviterNames(
  inviterIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = Array.from(new Set(inviterIds)).filter(Boolean);
  if (ids.length === 0) return map;
  const { data } = await supabase
    .from('users_public')
    .select('id, username, name')
    .in('id', ids);
  (data ?? []).forEach((p: { id: string; username: string | null; name: string | null }) => {
    const label =
      (p.name && p.name.trim()) || (p.username ? `@${p.username}` : 'Someone');
    map.set(p.id, label);
  });
  return map;
}

export async function acceptInvite(invite: CircleInvite): Promise<void> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error('Sign in first.');
  // Two writes; the second only runs if the first succeeded. RLS makes
  // sure the invitee is actually the one accepting.
  const { error: insertErr } = await supabase
    .from('circle_members')
    .insert({ circle_id: invite.circleId, user_id: user.id, role: 'member' });
  if (insertErr && !insertErr.message.includes('duplicate')) {
    throw wrap(insertErr);
  }
  const { error: updErr } = await supabase
    .from('circle_invites')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', invite.id);
  if (updErr) throw wrap(updErr);
}

// Accept an invite by its share token (the `<token>` in
// orbii://join/<token> or https://www.orbii.in/join/<token>). Bypasses
// the username check used by the in-app invite list since the user is
// "claiming" the invite directly from the link.
export async function acceptInviteByToken(
  token: string,
): Promise<{ circleId: string }> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error('Sign in to accept this invite.');
  // Find the invite. We don't filter on invitee_username here, the
  // token is the proof of legitimacy.
  const { data: inviteRow, error: lookupErr } = await supabase
    .from('circle_invites')
    .select('id, circle_id, status, expires_at')
    .eq('token', token)
    .maybeSingle();
  if (lookupErr) throw wrap(lookupErr);
  if (!inviteRow) throw new Error('This invite link is no longer valid.');
  const expiresAt = Date.parse(inviteRow.expires_at as string);
  if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
    throw new Error('This invite link has expired.');
  }
  if (inviteRow.status !== 'pending') {
    if (inviteRow.status === 'accepted') {
      return { circleId: inviteRow.circle_id as string };
    }
    throw new Error('This invite is no longer active.');
  }
  // Add membership (idempotent if RLS-ok) and mark the invite accepted.
  const { error: insertErr } = await supabase
    .from('circle_members')
    .insert({
      circle_id: inviteRow.circle_id,
      user_id: user.id,
      role: 'member',
    });
  if (insertErr && !insertErr.message.includes('duplicate')) {
    throw wrap(insertErr);
  }
  await supabase
    .from('circle_invites')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', inviteRow.id);
  return { circleId: inviteRow.circle_id as string };
}

export async function declineInvite(inviteId: string): Promise<void> {
  const { error } = await supabase
    .from('circle_invites')
    .update({ status: 'declined', responded_at: new Date().toISOString() })
    .eq('id', inviteId);
  if (error) throw wrap(error);
}

// Recent shared trips for a circle. Used by the Circle detail screen so a
// user can see who's on the road right now.
export async function listSharedTrips(circleId: string): Promise<SharedTrip[]> {
  const { data, error } = await supabase
    .from('shared_trips')
    .select('*')
    .eq('circle_id', circleId)
    .order('start_at', { ascending: false })
    .limit(20);
  if (error) throw wrap(error);
  return (data ?? []).map((r) => rowToTrip(r as TripRow));
}

// Logs an event on a circle. Soft-fails so callers don't have to wrap.
export async function recordCircleEvent(
  circleId: string,
  kind: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return;
  await supabase.from('circle_events').insert({
    circle_id: circleId,
    actor_id: user.id,
    kind,
    payload,
  });
}
