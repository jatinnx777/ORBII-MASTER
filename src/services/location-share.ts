import { Linking, Platform } from 'react-native';
import { supabase } from './supabase';
import { getFastLocation } from './location';
import { addNotification } from './notification-inbox';
import { store } from '@/redux/store';
import { trackEvent } from './analytics';
import type { EmergencyContact } from '@/types';

// "Share my location" — a calm, non-emergency alternative to an SOS.
//
// Two things happen:
//   1. A maps link is texted to your TOP emergency contact (the first one on
//      your list), via the phone's own SMS app. Free, no gateway, works offline
//      the moment signal returns.
//   2. Everyone in your circle is pinged in-app (a push, server-side), so the
//      people who watch out for you know where you are without you SOS-ing.

type ShareResult =
  | { ok: true; contact: string | null; circleNotified: number }
  | { ok: false; error: string };

function mapsLink(lat: number, lng: number): string {
  return `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

export async function shareMyLocation(): Promise<ShareResult> {
  const profile = store.getState().user.profile;
  if (!profile) return { ok: false, error: 'Not signed in.' };

  let point;
  try {
    point = await getFastLocation();
  } catch {
    return { ok: false, error: 'Could not get your location. Turn location on and try again.' };
  }

  const link = mapsLink(point.latitude, point.longitude);
  trackEvent('location_shared', {});

  // 1. Text the top emergency contact.
  const top: EmergencyContact | undefined = profile.emergencyContacts?.[0];
  if (top?.phone) {
    const body = encodeURIComponent(
      `${profile.name || 'I'} shared a live location with you via ORBII: ${link}`,
    );
    // Android uses ? , iOS uses & — Linking handles both with this form.
    const sep = Platform.OS === 'ios' ? '&' : '?';
    Linking.openURL(`sms:${top.phone}${sep}body=${body}`).catch(() => undefined);
  }

  // 2. Ping the circle (server-side push). Best-effort; never blocks the SMS.
  let circleNotified = 0;
  try {
    const { data } = await supabase.functions.invoke('notify-location-share', {
      body: { lat: point.latitude, lng: point.longitude, link },
    });
    circleNotified = (data as { sent?: number })?.sent ?? 0;
  } catch {
    // function not deployed yet, or offline — the SMS still went out.
  }

  // 3. A local record so she can see she shared, and when.
  await addNotification({
    title: 'Location shared',
    body: top?.name
      ? `Sent to ${top.name} and pinged your circle.`
      : 'Pinged your circle with your location.',
    kind: 'location_share',
  }).catch(() => undefined);

  return { ok: true, contact: top?.name ?? null, circleNotified };
}
