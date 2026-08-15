import { supabase } from '@/services/supabase';
import { REWARD } from './config';

// RewardService, the app's doorway to the server reward engine. Every method
// that touches money just forwards to a SECURITY DEFINER RPC in sql/33; the
// amount, eligibility and fraud decision are computed there. `previewReward`
// is a display-only mirror of the formula so the UI can show a breakdown, it
// never grants anything.

export type RewardRow = {
  id: string;
  amountPaise: number;
  basePaise: number;
  distanceBonusPaise: number;
  responseBonusPaise: number;
  sceneBonusPaise: number;
  ratingBonusPaise: number;
  trustMultiplier: number;
  fraudScore: number;
  eligible: boolean;
  status: 'pending_review' | 'manual_review' | 'approved' | 'rejected' | 'paid';
  reason: string | null;
  createdAt: string;
};

export const RewardService = {
  /**
   * Helper accepted an SOS → claim one of the 3 responder slots (rescue_claim,
   * sql/69). `status` is 'assigned' (you're one of the 3 going) or 'standby'
   * (enough responders already; you're a backup and shouldn't head out yet).
   * `limitReached` is true when the helper hit their monthly cap (sql/66).
   */
  async accept(input: {
    sosId: string;
    victimId: string;
    sosCreatedIso?: string | null;
    deviceId: string;
    mockLocation: boolean;
  }): Promise<{ id: string | null; status: 'assigned' | 'standby' | null; limitReached: boolean }> {
    const { data, error } = await supabase.rpc('rescue_claim', {
      p_sos: input.sosId,
      p_victim: input.victimId,
      p_sos_created: input.sosCreatedIso ?? null,
      p_device: input.deviceId,
      p_mock: input.mockLocation,
    });
    if (error) {
      const blob = `${error.message} ${error.hint ?? ''} ${error.code ?? ''}`;
      if (/monthly_help_limit_reached/i.test(blob)) {
        return { id: null, status: null, limitReached: true };
      }
      // Graceful fallback: if rescue_claim isn't deployed yet (sql/69 not run),
      // fall back to the old single-accept path so helpers can still respond.
      if (/PGRST202|does not exist|could not find|schema cache/i.test(blob)) {
        const legacy = await supabase.rpc('rescue_accept', {
          p_sos: input.sosId,
          p_victim: input.victimId,
          p_sos_created: input.sosCreatedIso ?? null,
          p_device: input.deviceId,
          p_mock: input.mockLocation,
        });
        if (legacy.error) {
          const lim = /monthly_help_limit_reached/i.test(
            `${legacy.error.message} ${legacy.error.hint ?? ''}`,
          );
          return { id: null, status: null, limitReached: lim };
        }
        return { id: (legacy.data as string) ?? null, status: 'assigned', limitReached: false };
      }
      return { id: null, status: null, limitReached: false };
    }
    const d = data as { id?: string; status?: string; slot?: number } | null;
    const status = d?.status === 'assigned' ? 'assigned' : d?.status === 'standby' ? 'standby' : null;
    return { id: d?.id ?? null, status, limitReached: false };
  },

  async reportMovement(eventId: string, roadMeters: number, mock: boolean): Promise<void> {
    try {
      await supabase.rpc('rescue_report_movement', {
        p_event: eventId,
        p_road_meters: Math.round(roadMeters),
        p_mock: mock,
      });
    } catch {
      // best-effort
    }
  },

  /** Geofence arrival (auto). Returns the helper's arrival rank for this SOS. */
  async geofenceArrival(eventId: string): Promise<number | null> {
    const { data, error } = await supabase.rpc('rescue_geofence_arrival', { p_event: eventId });
    if (error) return null;
    return (data as number) ?? null;
  },

  /** Left the scene → finalise + queue the reward. Returns the reward row. */
  async depart(eventId: string): Promise<RewardRow | null> {
    const { data, error } = await supabase.rpc('rescue_depart', { p_event: eventId });
    if (error || !data) return null;
    return mapReward(Array.isArray(data) ? data[0] : data);
  },

  async rate(eventId: string, stars: number, confirmed: boolean): Promise<void> {
    try {
      await supabase.rpc('rescue_rate', { p_event: eventId, p_stars: stars, p_confirmed: confirmed });
    } catch {
      // best-effort
    }
  },

  // Victim-facing rating, keyed by SOS + helper (the victim doesn't know the
  // rescue-event id). Pass stars=null to only record a decline.
  async rateBySos(
    sosId: string,
    helperId: string,
    stars: number | null,
    confirmed: boolean,
  ): Promise<void> {
    try {
      await supabase.rpc('rescue_rate_by_sos', {
        p_sos: sosId,
        p_helper: helperId,
        p_stars: stars,
        p_confirmed: confirmed,
      });
    } catch {
      // best-effort
    }
  },

  // Upload the victim's address book as on-device hashes (raw digits never sent).
  async storeContactHashesPrehashed(hashes: string[]): Promise<void> {
    try {
      await supabase.rpc('store_contact_hashes_prehashed', { hashes });
    } catch {
      // best-effort
    }
  },

  /** Upload the victim's contacts as salted hashes (raw digits never stored). */
  async storeContactHashes(phones: string[]): Promise<void> {
    if (phones.length === 0) return;
    try {
      await supabase.rpc('store_contact_hashes', { phones });
    } catch {
      // best-effort
    }
  },

  async myRewards(): Promise<RewardRow[]> {
    const uid = (await supabase.auth.getUser()).data.user?.id;
    if (!uid) return [];
    const { data } = await supabase
      .from('rescue_rewards')
      .select('*')
      .eq('helper_id', uid)
      .order('created_at', { ascending: false });
    return (data ?? []).map(mapReward);
  },

  // Display-only breakdown mirroring the server formula.
  previewReward(input: {
    roadMeters: number;
    acceptLatencySec: number;
    onSceneSec: number;
    rating: number;
    multiplier: number;
  }): { base: number; distance: number; response: number; scene: number; rating: number; total: number } {
    const base = REWARD.basePaise;
    const distance = Math.min(
      REWARD.distanceMaxPaise,
      Math.round((REWARD.distanceMaxPaise * Math.min(input.roadMeters / 1000, REWARD.distanceCapKm)) / REWARD.distanceCapKm),
    );
    const response = REWARD.responseTiers.find((t) => input.acceptLatencySec <= t.maxSec)?.paise ?? 0;
    const scene =
      input.onSceneSec < REWARD.sceneMinSeconds
        ? 0
        : REWARD.sceneTiers.find((t) => input.onSceneSec < t.maxSec)?.paise ?? 500;
    const rating = REWARD.ratingPaise[input.rating] ?? 0;
    const total =
      input.onSceneSec < REWARD.sceneMinSeconds
        ? 0
        : Math.min(REWARD.rewardCapPaise, Math.round((base + distance + response + scene + rating) * input.multiplier));
    return { base, distance, response, scene, rating, total };
  },
};

function mapReward(r: Record<string, unknown>): RewardRow {
  return {
    id: r.id as string,
    amountPaise: (r.amount_paise as number) ?? 0,
    basePaise: (r.base_paise as number) ?? 0,
    distanceBonusPaise: (r.distance_bonus_paise as number) ?? 0,
    responseBonusPaise: (r.response_bonus_paise as number) ?? 0,
    sceneBonusPaise: (r.scene_bonus_paise as number) ?? 0,
    ratingBonusPaise: (r.rating_bonus_paise as number) ?? 0,
    trustMultiplier: Number(r.trust_multiplier ?? 1),
    fraudScore: (r.fraud_score as number) ?? 0,
    eligible: !!r.eligible,
    status: (r.status as RewardRow['status']) ?? 'pending_review',
    reason: (r.reason as string) ?? null,
    createdAt: (r.created_at as string) ?? '',
  };
}
