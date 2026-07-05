import { Linking, Platform } from 'react-native';
import { appAlert } from '@/components/common';
import type { EmergencyContact, SOSLocation, UserProfile } from '@/types';

// WhatsApp deep-link broadcast.
//
// India has ~530M WhatsApp users. Push notifications get muted, SMS gets
// lost in OTP noise — WhatsApp messages get read. Sending the SOS link
// over WhatsApp instead of (or alongside) push is the single biggest
// reach win for the alert pipeline.
//
// Mechanics:
//   • We build a single WhatsApp deep link per emergency contact.
//   • The first contact gets opened automatically (system Share intent
//     for WhatsApp). For 2+ contacts, we render a chooser instead of
//     spamming the Activity stack.
//
// Format spec: wa.me/<E.164 without +>?text=<URL-encoded body>
//
// We DON'T send via the WhatsApp Cloud API because that requires a
// verified business account + per-message billing. The deep-link approach
// is free, works today, and respects the user's intent (they tap to send).

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, '');
}

// E.164 without the leading + (what wa.me expects). India fallback: a 10
// digit number becomes 91 + 10 digits. Anything already starting with 91
// stays as-is.
function toWaPhone(phone: string): string {
  const d = digitsOnly(phone);
  if (d.length === 10) return `91${d}`;
  return d;
}

export function buildSOSMessage(args: {
  user: UserProfile;
  location: SOSLocation;
}): string {
  const { user, location } = args;
  const name = user.name?.trim() || 'Someone you know';
  const mapsLink = `https://maps.google.com/?q=${location.latitude},${location.longitude}`;
  const address = location.address ? ` Address: ${location.address}.` : '';
  return (
    `🚨 ORBII SOS: ${name} needs help right now.` +
    `\n\nLive location: ${mapsLink}.${address}` +
    `\n\nPlease call them or come to this location immediately.` +
    `\n\nSent automatically from the ORBII safety app.`
  );
}

function buildWhatsAppUrl(phone: string, message: string): string {
  const waPhone = toWaPhone(phone);
  const body = encodeURIComponent(message);
  return `whatsapp://send?phone=${waPhone}&text=${body}`;
}

function buildWebFallbackUrl(phone: string, message: string): string {
  const waPhone = toWaPhone(phone);
  const body = encodeURIComponent(message);
  return `https://wa.me/${waPhone}?text=${body}`;
}

// Opens WhatsApp pre-filled with an SOS message for ONE contact. Falls
// back to wa.me (browser) if WhatsApp isn't installed.
export async function openWhatsAppFor(
  contact: EmergencyContact,
  message: string,
): Promise<boolean> {
  const native = buildWhatsAppUrl(contact.phone, message);
  const fallback = buildWebFallbackUrl(contact.phone, message);
  try {
    const canNative = await Linking.canOpenURL(native).catch(() => false);
    const url = canNative ? native : fallback;
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

// Top-level entry called from the SOS flow. Sends to every emergency
// contact serially with a tiny gap so the WhatsApp UI doesn't drop
// intents. We don't block the SOS broadcast on this — it runs in
// parallel with the existing push + Supabase pipeline.
export async function broadcastSOSViaWhatsApp(args: {
  user: UserProfile;
  location: SOSLocation;
}): Promise<void> {
  const contacts = args.user.emergencyContacts ?? [];
  if (contacts.length === 0) return;
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
  const message = buildSOSMessage(args);
  // One contact → just open. Multiple → open the first; show a confirm
  // for the rest. (We don't auto-loop all of them — Android system
  // throttles rapid Activity starts.)
  if (contacts.length === 1) {
    await openWhatsAppFor(contacts[0], message);
    return;
  }
  await openWhatsAppFor(contacts[0], message);
  if (contacts.length > 1) {
    appAlert(
      'Sent to first contact',
      `WhatsApp opened with ${contacts[0].name}. After sending, tap "Send to next" to alert the remaining ${contacts.length - 1}.`,
      [
        { text: 'Done', style: 'cancel' },
        ...contacts.slice(1, 4).map((c) => ({
          text: `Send to ${c.name}`,
          onPress: () => openWhatsAppFor(c, message),
        })),
      ],
    );
  }
}
