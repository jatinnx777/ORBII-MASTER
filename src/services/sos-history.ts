import { supabase } from './supabase';
import type {
  Responder,
  SOSRecord,
  SOSStatus,
  SOSKind,
  SOSLocation,
} from '@/types';

// Server-side store for the user's SOS history. SQL schema in
// sql/03_sos_events.sql. The local SOSRecord and the server row share
// the client-generated `id` so we can upsert without a round-trip.

type SOSRow = {
  id: string;
  user_id: string;
  lat: number;
  lng: number;
  address: string | null;
  status: SOSStatus;
  kind: SOSKind | null;
  user_name: string | null;
  user_photo: string | null;
  responder_id: string | null;
  responder_name: string | null;
  responder_photo: string | null;
  rating: number | null;
  response_time: number | null;
  resolved_at: string | null;
  created_at: string;
};

function rowToRecord(row: SOSRow): SOSRecord {
  const location: SOSLocation = {
    latitude: row.lat,
    longitude: row.lng,
    address: row.address,
  };
  const responder: Responder | null = row.responder_id
    ? {
        id: row.responder_id,
        name: row.responder_name ?? '',
        photoUri: row.responder_photo,
        rating: 0,
      }
    : null;
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userPhoto: row.user_photo,
    location,
    timestamp: Date.parse(row.created_at),
    status: row.status,
    kind: row.kind ?? 'real',
    responders: [],
    responder,
    responseTime: row.response_time,
    resolvedAt: row.resolved_at ? Date.parse(row.resolved_at) : null,
    rating: row.rating,
  };
}

export async function fetchSOSHistory(userId: string): Promise<SOSRecord[]> {
  const { data, error } = await supabase
    .from('sos_events')
    .select(
      'id, user_id, lat, lng, address, status, kind, user_name, user_photo, responder_id, responder_name, responder_photo, rating, response_time, resolved_at, created_at',
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error || !data) {
    console.warn('[sos-history] fetch failed:', error?.message);
    return [];
  }
  return (data as SOSRow[]).map(rowToRecord);
}

// Upsert a full SOSRecord, used when an SOS resolves or is cancelled, so
// the server row reflects the final state.
export async function upsertSOSRecord(record: SOSRecord): Promise<void> {
  const { error } = await supabase.from('sos_events').upsert(
    {
      id: record.id,
      user_id: record.userId,
      lat: record.location.latitude,
      lng: record.location.longitude,
      address: record.location.address,
      status: record.status,
      kind: record.kind ?? 'real',
      user_name: record.userName,
      user_photo: record.userPhoto,
      responder_id: record.responder?.id ?? null,
      responder_name: record.responder?.name ?? null,
      responder_photo: record.responder?.photoUri ?? null,
      rating: record.rating,
      response_time: record.responseTime,
      resolved_at: record.resolvedAt
        ? new Date(record.resolvedAt).toISOString()
        : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (error) {
    console.warn('[sos-history] upsert failed:', error.message);
  }
}
