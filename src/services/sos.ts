import type { SOSLocation, SOSRecord, UserProfile } from '@/types';
import { supabase } from './supabase';
import { broadcastAlert, type AlertBroadcast } from './community';

// Creates a new SOS record:
//   1. Persists to Supabase `sos_events` (best-effort; survives network
//      flakes and gives a durable id when the DB accepts it).
//   2. Broadcasts the alert on the shared `orbii:alerts` realtime channel
//      so every app currently open receives it in real time.
//
// The broadcast is the *real* delivery mechanism for nearby responders —
// it doesn't depend on the DB insert succeeding, so it works for users
// who are signed in via DEV_AUTH_MODE and have no Supabase auth session.
export async function createSOS(
  user: UserProfile,
  location: SOSLocation,
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
    helpers: [],
    responder: null,
    responseTime: null,
    resolvedAt: null,
    rating: null,
  };

  try {
    const { data, error } = await supabase
      .from('sos_events')
      .insert({
        user_id: user.uid,
        lat: location.latitude,
        lng: location.longitude,
        address: location.address,
        status: 'active',
      })
      .select('id')
      .single();
    if (error) throw error;
    if (data?.id) record.id = data.id;
  } catch (err) {
    console.warn('[sos] supabase insert failed, using local id', err);
  }

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
  };
  broadcastAlert(broadcast).catch((err) =>
    console.warn('[sos] broadcast failed', err),
  );

  return record;
}
