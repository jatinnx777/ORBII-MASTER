import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { getDeviceId } from './rewards/FraudDetectionService';

// Single-device enforcement.
//
// Each signed-in device "claims" the account by writing its device id into the
// server's user_sessions row (one row per user). Because a new claim overwrites
// the old device id, the previous device, which is subscribed to its own row
// over Realtime, sees the change and knows it has been signed out elsewhere.
//
// Nothing here sends a push notification; the eviction is handled in-app.

function deviceLabel(): string {
  if (Platform.OS === 'android') return 'an Android device';
  if (Platform.OS === 'ios') return 'an iPhone';
  return 'another device';
}

/** Make this device the account's one active device. Best-effort. */
export async function claimThisDevice(): Promise<void> {
  try {
    const deviceId = await getDeviceId();
    await supabase.rpc('claim_session', { p_device_id: deviceId, p_label: deviceLabel() });
  } catch {
    // A failed claim just means single-device isn't enforced for this session;
    // never block sign-in on it.
  }
}

/**
 * Watch our user_sessions row while authenticated. The device is claimed at
 * sign-in (see auth.claimThisDevice), so this guard does NOT claim on resume , 
 * it only detects eviction: if the account's active device is already something
 * other than us (we were superseded while away), or it changes to another
 * device live (a fresh login elsewhere), we invoke onEvicted().
 */
export function useDeviceEvictionGuard(
  active: boolean,
  userId: string | null,
  onEvicted: () => void,
): void {
  const onEvictedRef = useRef(onEvicted);
  onEvictedRef.current = onEvicted;

  useEffect(() => {
    if (!active || !userId) return;

    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const myDeviceId = await getDeviceId();

      // Were we already superseded while the app was closed?
      const { data } = await supabase
        .from('user_sessions')
        .select('device_id')
        .eq('user_id', userId)
        .maybeSingle();
      if (cancelled) return;
      if (data?.device_id && data.device_id !== myDeviceId) {
        onEvictedRef.current();
        return;
      }

      // Live: another device logging in overwrites the row → we get evicted.
      channel = supabase
        .channel(`session-guard-${userId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'user_sessions', filter: `user_id=eq.${userId}` },
          (payload) => {
            const next = (payload.new as { device_id?: string } | null)?.device_id;
            if (next && next !== myDeviceId) {
              onEvictedRef.current();
            }
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [active, userId]);
}
