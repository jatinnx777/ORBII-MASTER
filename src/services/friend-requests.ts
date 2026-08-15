import { supabase } from './supabase';
import { getPublicUsersByUsernames } from './users-public';
import { checkRateLimit, rateLimitMessage } from './rate-limit';
import type { Friend } from '@/types';

// Friend-request system. User A sends a request to @B. Until @B accepts,
// they're not in either user's circle (no chat, no priority dispatch).
// On accept we INSERT mutual rows in `friends` so both sides see each
// other.
//
// Required Supabase schema:
//
//   create table friend_requests (
//     id uuid primary key default gen_random_uuid(),
//     from_user_id uuid references auth.users(id) on delete cascade,
//     from_username text not null,
//     to_username text not null,
//     status text default 'pending' check (status in ('pending','accepted','declined')),
//     created_at timestamptz default now(),
//     responded_at timestamptz,
//     unique (from_user_id, to_username)
//   );
//   alter table friend_requests enable row level security;
//   create policy "send" on friend_requests for insert with check (auth.uid() = from_user_id);
//   create policy "see mine" on friend_requests for select using (
//     auth.uid() = from_user_id or
//     exists (select 1 from profiles p where p.id = auth.uid() and p.username = friend_requests.to_username)
//   );
//   create policy "respond" on friend_requests for update using (
//     exists (select 1 from profiles p where p.id = auth.uid() and p.username = friend_requests.to_username)
//   );

export type FriendRequest = {
  id: string;
  fromUserId: string;
  fromUsername: string;
  toUsername: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: number;
  respondedAt: number | null;
};

type RequestRow = {
  id: string;
  from_user_id: string;
  from_username: string;
  to_username: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  responded_at: string | null;
};

function rowToRequest(row: RequestRow): FriendRequest {
  return {
    id: row.id,
    fromUserId: row.from_user_id,
    fromUsername: row.from_username,
    toUsername: row.to_username,
    status: row.status,
    createdAt: Date.parse(row.created_at),
    respondedAt: row.responded_at ? Date.parse(row.responded_at) : null,
  };
}

// Send a request. Looks up the recipient by username so we know they
// exist before issuing the row. Rate-limited at 1.5s between requests
// + 20 per rolling hour to stop social spam.
export async function sendFriendRequest(args: {
  fromUserId: string;
  fromUsername: string;
  toUsername: string;
}): Promise<FriendRequest> {
  const gate = checkRateLimit('friend.request');
  if (!gate.ok) {
    throw new Error(rateLimitMessage(gate));
  }

  // Quick existence check, without it we'd create requests for ghost
  // usernames, which is bad UX.
  const { data: target } = await supabase
    .from('profiles')
    .select('id, username')
    .eq('username', args.toUsername)
    .maybeSingle();
  if (!target) {
    throw new Error(`No user found with username @${args.toUsername}`);
  }

  const { data, error } = await supabase
    .from('friend_requests')
    .upsert(
      {
        from_user_id: args.fromUserId,
        from_username: args.fromUsername,
        to_username: args.toUsername,
        status: 'pending',
        responded_at: null,
      },
      { onConflict: 'from_user_id,to_username' },
    )
    .select('*')
    .single<RequestRow>();
  if (error || !data) {
    throw new Error(error?.message ?? 'Could not send request.');
  }
  return rowToRequest(data);
}

export async function listIncomingRequests(
  myUsername: string,
): Promise<FriendRequest[]> {
  const { data, error } = await supabase
    .from('friend_requests')
    .select('*')
    .eq('to_username', myUsername)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return (data as RequestRow[]).map(rowToRequest);
}

export async function listOutgoingRequests(
  myUid: string,
): Promise<FriendRequest[]> {
  const { data, error } = await supabase
    .from('friend_requests')
    .select('*')
    .eq('from_user_id', myUid)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return (data as RequestRow[]).map(rowToRequest);
}

// Accepting fans the request out into two `friends` rows so each side
// sees the other. We mutate friend_requests last so a partial failure
// can be retried.
export async function acceptFriendRequest(args: {
  requestId: string;
  myUid: string;
  myUsername: string;
  fromUserId: string;
  fromUsername: string;
}): Promise<void> {
  await supabase
    .from('friends')
    .upsert(
      {
        user_id: args.myUid,
        friend_username: args.fromUsername,
        added_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,friend_username' },
    );
  await supabase
    .from('friends')
    .upsert(
      {
        user_id: args.fromUserId,
        friend_username: args.myUsername,
        added_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,friend_username' },
    );
  await supabase
    .from('friend_requests')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', args.requestId);
}

export async function declineFriendRequest(requestId: string): Promise<void> {
  await supabase
    .from('friend_requests')
    .update({ status: 'declined', responded_at: new Date().toISOString() })
    .eq('id', requestId);
}

// Server-side mirror of the user's friends list. On sign-in we hydrate
// `profile.friends` from this so logging out and back in restores the
// circle. Each row is enriched with name/photo from users_public so the
// friends list renders correctly without a follow-up fetch.
export async function listFriendsForUser(myUid: string): Promise<Friend[]> {
  const { data, error } = await supabase
    .from('friends')
    .select('friend_username, added_at')
    .eq('user_id', myUid)
    .order('added_at', { ascending: false });
  if (error || !data) return [];
  const usernames = data.map((row) => row.friend_username as string);
  const publicMap = await getPublicUsersByUsernames(usernames);
  return data.map((row) => {
    const username = row.friend_username as string;
    const pub = publicMap.get(username) ?? null;
    return {
      username,
      addedAt: Date.parse(row.added_at as string),
      uid: pub?.id ?? null,
      name: pub?.name ?? null,
      photoUri: pub?.photoUri ?? null,
    };
  });
}
