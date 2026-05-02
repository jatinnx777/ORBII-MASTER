import type { SOSKind, SOSLocation, SOSRecord, UserProfile } from '@/types';
import { supabase } from './supabase';
import { broadcastAlert, type AlertBroadcast } from './community';

// Creates a new SOS record:
//   1. Persists to Supabase `sos_events` (best-effort; survives network
//      flakes and gives a durable id when the DB accepts it).
//   2. Broadcasts the alert on the shared `orbii:alerts` realtime channel
//      so every app currently open receives it in real time.
//
// `kind: 'test'` skips both the DB write and the broadcast — a practice run
// that only writes a local history record, so the user can rehearse the
// flow without notifying real helpers.
export async function createSOS(
  user: UserProfile,
  location: SOSLocation,
  kind: SOSKind = 'real',
): Promise<SOSRecord> {
  const localId = `sos_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const record: SOSRecord = {
    id: localId,
    userId: user.uid,
    userName: user.name,
    userPhoto: user.photoUri,
    location,
    timestamp: Date.now(),
    status: 'active',
    kind,
    helpers: [],
    responder: null,
    responseTime: null,
    resolvedAt: null,
    rating: null,
  };

  if (kind === 'test') {
    // No DB write, no broadcast. Real users hear nothing.
    return record;
  }

  // CRITICAL PATH: fire the broadcast immediately on the local id. This is
  // what notifies every nearby phone, and it's what actually saves time.
  // The Supabase write happens in parallel so we don't pay its latency
  // before alerting helpers.
  const friendUids = (user.friends ?? [])
    .map((f) => f.uid)
    .filter((uid): uid is string => !!uid);

  const broadcast: AlertBroadcast = {
    id: record.id,
    victim: {
      id: user.uid,
      name: user.name ?? 'Someone nearby',
      photoUri: user.photoUri,
      phone: user.phone,
    },
    location,
    createdAt: record.timestamp,
    friendUids,
  };
  broadcastAlert(broadcast).catch((err) =>
    console.warn('[sos] broadcast failed', err),
  );

  // Fire-and-forget DB write. We never await it on the critical path —
  // DB failure must not delay the broadcast.
  void persistSOS(record, user);

  return record;
}

async function persistSOS(
  record: SOSRecord,
  user: UserProfile,
): Promise<void> {
  try {
    const { error } = await supabase.from('sos_events').upsert(
      {
        id: record.id,
        user_id: user.uid,
        lat: record.location.latitude,
        lng: record.location.longitude,
        address: record.location.address,
        status: 'active',
        kind: record.kind ?? 'real',
        user_name: user.name,
        user_photo: user.photoUri,
      },
      { onConflict: 'id' },
    );
    if (error) console.warn('[sos] supabase insert failed', error);
  } catch (err) {
    console.warn('[sos] supabase insert threw', err);
  }
}
