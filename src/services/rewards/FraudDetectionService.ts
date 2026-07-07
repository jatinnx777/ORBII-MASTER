import { supabase } from '@/services/supabase';
import { getItem, setItem } from '@/services/storage';

// FraudDetectionService — collects client-side signals the server can't see on
// its own (device fingerprint, spoofed GPS, impossible movement) and reports
// them to the server, which folds them into the authoritative fraud score. The
// server never trusts these blindly: it weights them and combines with its own
// checks (mutual contacts, repeated pairs, limits, no-geofence-arrival, …).

// Weights mirror the server's expectations; the server clamps 0..100.
const WEIGHTS: Record<string, number> = {
  impossible_speed: 70,
  teleport: 60,
  gps_spoofing: 80,
  same_wifi_repeated: 25,
  no_movement: 60,
};

const INSTALL_KEY = 'orbii:install-id';

// A stable per-install id → the server's "same device" check catches a victim
// paying themselves from one phone across two accounts.
export async function getDeviceId(): Promise<string> {
  let id = await getItem<string>(INSTALL_KEY);
  if (!id) {
    id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    await setItem(INSTALL_KEY, id);
  }
  return id;
}

export const FraudDetectionService = {
  getDeviceId,

  async reportSignal(
    eventId: string,
    code: string,
    detail: Record<string, unknown> = {},
  ): Promise<void> {
    const weight = WEIGHTS[code] ?? 30;
    try {
      await supabase.rpc('rescue_report_signal', {
        p_event: eventId,
        p_code: code,
        p_weight: weight,
        p_detail: detail,
      });
    } catch {
      // best-effort; the server still has its own signals
    }
  },

  // Convenience: report a batch of movement-verifier flags for this rescue.
  async reportFlags(eventId: string, flags: string[]): Promise<void> {
    for (const f of flags) await this.reportSignal(eventId, f);
  },
};
