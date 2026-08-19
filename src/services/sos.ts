import type { SOSKind, SOSLocation, SOSRecord, UserProfile } from '@/types';
import { supabase } from './supabase';
import { broadcastAlert, type AlertBroadcast } from './community';
import { checkRateLimit, rateLimitMessage } from './rate-limit';
import { enqueueSOS } from './sos-queue';
import { addBreadcrumb, reportError } from './error-reporting';
import { armOfflineSos } from './mesh';
import { armHelperPing } from './mesh-helper-alert';
import { sendSosSmsDirect } from './sms';
import { buildSOSMessage } from './whatsapp-sos';
import { store } from '@/redux/store';
import { sosDeliveryUpdated } from '@/redux/slices/sosSlice';

// Thrown when the rate limiter blocks an SOS fire. Callers can detect
// this via `instanceof` and show the readable `.message` to the user.
export class SOSRateLimitedError extends Error {
  readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'SOSRateLimitedError';
    this.retryAfterMs = retryAfterMs;
  }
}

// Creates a new SOS record:
//   1. Persists to Supabase `sos_events` (best-effort; survives network
//      flakes and gives a durable id when the DB accepts it).
//   2. Broadcasts the alert on the shared `orbii:alerts` realtime channel
//      so every app currently open receives it in real time.
//
// `kind: 'test'` skips both the DB write and the broadcast, a practice run
// that only writes a local history record, so the user can rehearse the
// flow without notifying real helpers.
//
// Rate-limited at 15s between fires + 5 fires per hour for `kind='real'`.
// Test fires are NOT rate-limited so users can practice freely.
// How long we wait for proof the SOS actually reached someone before assuming
// it did not. Long enough that a slow-but-working network is not treated as a
// failure, short enough that nobody is standing in the dark waiting.
const DELIVERY_GRACE_MS = 4000;

export async function createSOS(
  user: UserProfile,
  location: SOSLocation,
  kind: SOSKind = 'real',
): Promise<SOSRecord> {
  if (kind === 'real') {
    const gate = checkRateLimit('sos.fire');
    if (!gate.ok) {
      throw new SOSRateLimitedError(rateLimitMessage(gate), gate.retryAfterMs);
    }
  }

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
    responders: [],
    responder: null,
    responseTime: null,
    resolvedAt: null,
    rating: null,
  };

  addBreadcrumb({
    category: 'sos',
    severity: 'info',
    message: `SOS create kind=${kind} id=${record.id}`,
    data: { uid: user.uid, hasLocation: !!location },
  });

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

  // Every SOS now reaches nearby ORBII users in real time, free or paid, a
  // free user can still be helped by whoever is close and willing (they may or
  // may not come). The paid tier's real advantage is the VERIFIED helper
  // dispatch, decided server-side in notify-sos, not whether the alert reaches
  // the community at all.
  const circleOnly = false;

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
    circleOnly,
  };
  broadcastAlert(broadcast).catch((err) =>
    reportError(err, {
      category: 'sos.broadcast',
      message: 'SOS broadcast failed',
      tags: { sosId: record.id },
    }),
  );

  // Fire-and-forget DB write. We never await it on the critical path , 
  // DB failure must not delay the broadcast.
  void persistSOS(record, user);

  // Offline safety net: if there's no connectivity, the broadcast + push can't
  // reach anyone. Queue this SOS so it's replayed (persist + push) the moment
  // the network returns, so the circle still gets alerted. Only on the offline
  // path, so an online SOS is never double-sent.
  if (!store.getState().app.isOnline) {
    armOfflineFallbacks(record, user, location);
  }

  // Server-side push fan-out so the victim's circle + emergency contacts are
  // alerted even with their app closed (the realtime broadcast above only
  // reaches apps that are currently open). Fire-and-forget; depends on the
  // notify-sos edge function + FCM being configured. Slight delay so the DB
  // upsert above has landed before the function reads the row.
  setTimeout(() => {
    supabase.functions
      .invoke('notify-sos', { body: { sosId: record.id } })
      .then(({ data }) => {
        const sent = (data as { sent?: number } | null)?.sent;
        if (typeof sent === 'number') {
          store.dispatch(sosDeliveryUpdated({ pushSent: sent }));
        }
      })
      .catch((err) =>
        reportError(err, {
          category: 'sos.push',
          message: 'notify-sos invoke failed',
          tags: { sosId: record.id },
        }),
      );
  }, 600);

  // ── Delivery watchdog ──────────────────────────────────────────────────
  //
  // `isOnline` lies, and it lies in exactly the situations that matter. NetInfo
  // reports isInternetReachable as null when it cannot tell, and net.ts treats
  // "cannot tell" as online. So on café wifi behind a captive portal, or on a
  // data connection showing full bars with no throughput, ORBII took the online
  // path, the broadcast vanished into the void, and NOT ONE offline fallback
  // was armed. Silent failure, in the one feature the whole app exists for.
  //
  // So stop asking "are we online" and start asking "did it actually land". If
  // nothing has confirmed by the time this fires, arm every offline path
  // regardless of what the connectivity flag claims.
  //
  // A duplicate alert is a non-event: the circle gets told twice and someone is
  // mildly annoyed. Silence is the failure that gets a person hurt.
  setTimeout(() => {
    const delivered = store.getState().sos.delivery?.pushSent;
    if (typeof delivered === 'number' && delivered > 0) return;
    addBreadcrumb({
      category: 'sos',
      severity: 'warn',
      message: 'SOS unconfirmed after grace, arming offline fallbacks',
      data: { id: record.id, delivered: delivered ?? null },
    });
    armOfflineFallbacks(record, user, location);
  }, DELIVERY_GRACE_MS);

  return record;
}

/**
 * Every route out of the phone that does not need our server.
 *
 * Safe to run twice: enqueueSOS de-dupes by id, and the mesh is keyed by the
 * same message id, so a second call is a no-op rather than a second alarm.
 */
function armOfflineFallbacks(
  record: SOSRecord,
  user: UserProfile,
  location: SOSLocation,
): void {
  void enqueueSOS(record, user);
  // Bluetooth mesh: a nearby ORBII phone that DOES have signal catches this and
  // bridges it to the server. Sealed end-to-end, so the relay never reads it.
  if (location) {
    void armOfflineSos(user.uid, location.latitude, location.longitude, record.timestamp);
  }
  // Location-free "someone near me needs help" beacon, so helpers can home in by
  // signal strength with no internet at all. Premium, like helper dispatch.
  if (user.isPremium) {
    void armHelperPing();
  }
  // Rides the cell signal, so it works with mobile data fully off. Only fires if
  // SEND_SMS was granted ahead of time, which on Play it currently is not, so
  // the ActiveSOS screen escalates to the one-tap composer instead.
  void sendSosSmsDirect(user.emergencyContacts, buildSOSMessage({ user, location }));
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
        // Every active SOS is visible to nearby users while it's live (the RPC
        // still bounds this to a radius + the last 15 minutes + active only),
        // so a free user can be reached by whoever is close. The paid perk , 
        // verified-helper dispatch, is gated separately, server-side.
        circle_only: false,
      },
      { onConflict: 'id' },
    );
    if (error) {
      reportError(error, {
        category: 'sos.persist',
        message: 'sos_events upsert returned error',
        tags: { sosId: record.id },
        data: { code: error.code, hint: error.hint },
      });
    }
  } catch (err) {
    reportError(err, {
      category: 'sos.persist',
      message: 'sos_events upsert threw',
      tags: { sosId: record.id },
    });
  }
}

// ── Escalation safety check (sql/78) ────────────────────────────────────────
//
// When helpers have provably arrived and the SOS is still open, the server asks
// her directly whether she is safe. Answering stops the escalation ladder;
// silence deliberately does NOT, because someone who cannot reach her phone is
// exactly who the next wave is for.
//
// Answering "safe" never resolves the SOS by itself. Closing an emergency stays
// a separate, deliberate act so a mis-tap can't call off help.

export type SafetyCheck = { pending: boolean; wave: number; arrived: number };

export async function getSafetyCheck(sosId: string): Promise<SafetyCheck | null> {
  try {
    const { data, error } = await supabase.rpc('my_safety_check', { p_sos: sosId });
    if (error || !data) return null;
    const row = (data as Record<string, unknown>[])[0];
    if (!row) return null;
    return {
      pending: Boolean(row.pending),
      wave: Number(row.wave ?? 1),
      arrived: Number(row.arrived ?? 0),
    };
  } catch {
    return null;
  }
}

export async function answerSafetyCheck(sosId: string, safe: boolean): Promise<void> {
  try {
    await supabase.rpc('sos_answer_safety_check', { p_sos: sosId, p_safe: safe });
  } catch {
    // best effort: if this fails the ladder simply continues, which is the
    // safe direction to fail in
  }
}
