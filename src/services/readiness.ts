import { useCallback, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAppSelector } from '@/redux/store';
import { getCurrentPermission } from '@/services/location';
import { getNotificationPermission } from '@/services/notifications';
import { getItem, storageKeys } from '@/services/storage';

// Single source of truth for "Safety Readiness" / Protection Strength. Used by
// both the Safety tab card and the full readiness screen so the percentage is
// always identical.
//
// Important product rule: readiness is CAPPED AT 98%. The last 2% is reserved
// for the things ORBII can never promise — network outages, a phone that's off,
// a responder who can't make it. We never show 100% because no safety system
// is ever truly 100%.
export const READINESS_CAP = 98;

async function micGranted(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    return await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
  } catch {
    return false;
  }
}

export type ReadinessSignals = {
  account: boolean;
  contact: boolean;
  voice: boolean;
  notifications: boolean;
  location: boolean;
  test: boolean;
};

export type Readiness = {
  signals: ReadinessSignals;
  doneCount: number;
  total: number;
  /** 0–98. Never reaches 100 by design (see READINESS_CAP). */
  pct: number;
  reload: () => void;
};

export function useReadiness(): Readiness {
  const profile = useAppSelector((s) => s.user.profile);
  const contacts = profile?.emergencyContacts?.length ?? 0;

  const [perm, setPerm] = useState({
    voice: false,
    notifications: false,
    location: false,
    test: false,
  });

  const reload = useCallback(async () => {
    const [voice, notifications, location, test] = await Promise.all([
      micGranted(),
      getNotificationPermission(),
      getCurrentPermission().then((p) => p === 'granted'),
      getItem<boolean>(storageKeys.safetyTest).then((v) => !!v),
    ]);
    setPerm({ voice, notifications, location, test });
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const signals: ReadinessSignals = {
    account: !!profile,
    contact: contacts > 0,
    voice: perm.voice,
    notifications: perm.notifications,
    location: perm.location,
    test: perm.test,
  };

  const values = Object.values(signals);
  const total = values.length;
  const doneCount = values.filter(Boolean).length;
  const rawPct = Math.round((doneCount / total) * 100);
  const pct = Math.min(rawPct, READINESS_CAP);

  return { signals, doneCount, total, pct, reload: () => void reload() };
}

// The liability line shown wherever we surface protection strength.
export const SAFETY_DISCLAIMER =
  'ORBII is a technology platform designed to facilitate emergency communication and safety assistance. ORBII does not guarantee emergency response, rescue, intervention, prevention of harm, or the availability of any third-party services, including police, emergency responders, or nearby helpers.';
