import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radius, spacing } from '@/theme';
import { checkIn, NOTE_MAX } from '@/services/circle-feed';
import { getFastLocation, reverseGeocode } from '@/services/location';

/**
 * "I got home."
 *
 * The only way to tell a circle you were fine used to be leaving live location
 * on and hoping somebody looked at the map. That is a bad trade: a permanent
 * stream of her position in exchange for one sentence she wanted to send once.
 *
 * LOCATION IS OFF BY DEFAULT and that is deliberate. "I am safe" and "I am
 * safe, and here is exactly where" are different messages, and only one of
 * them is always wanted. Defaulting it on would quietly turn a reassurance
 * into a disclosure.
 *
 * The note is the only free-text surface in the feed. This is not chat: ORBII
 * removed messaging in August 2026 on purpose, and 140 characters attached to
 * an event is not a reopening of that decision.
 */

const QUICK = ['Got home', 'Reached safely', 'On my way', 'All good'];

export function CheckInSheet({
  visible,
  circleId,
  onClose,
  onDone,
}: {
  visible: boolean;
  circleId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [withLocation, setWithLocation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setNote('');
    setWithLocation(false);
    setError(null);
    setBusy(false);
  }, [visible]);

  const submit = useCallback(async () => {
    if (!circleId || busy) return;
    setBusy(true);
    setError(null);
    try {
      let lat: number | null = null;
      let lng: number | null = null;
      let place: string | null = null;

      if (withLocation) {
        // getFastLocation, not getCurrentLocation: a check-in is a voluntary
        // message and nobody should watch a spinner for a GPS lock to send
        // one. If it fails the check-in still goes, without a position.
        try {
          const point = await getFastLocation();
          lat = point.latitude;
          lng = point.longitude;
          // Resolved here because reverse geocoding inside the database would
          // be an HTTP call inside a transaction.
          place = await reverseGeocode(point).catch(() => null);
        } catch {
          lat = null;
          lng = null;
        }
      }

      const id = await checkIn({ circleId, lat, lng, place, note: note || null });
      if (!id) {
        // The server enforces membership and six an hour. Neither deserves a
        // crash, and both are worth wording honestly.
        setError('That did not send. You may have checked in a few times already this hour.');
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      onDone();
    } catch {
      setError('That did not send. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }, [busy, circleId, note, onDone, withLocation]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.lift}
      >
        <View style={s.sheet}>
          <View style={s.grabber} />
          <Text style={s.title}>Check in</Text>
          <Text style={s.lead}>
            Tells your circle you are fine, once. Nothing keeps sharing afterwards.
          </Text>

          <View style={s.quickRow}>
            {QUICK.map((q) => {
              const on = note === q;
              return (
                <Pressable
                  key={q}
                  onPress={() => setNote(on ? '' : q)}
                  style={[s.quick, on && s.quickOn]}
                  accessibilityRole="button"
                >
                  <Text style={[s.quickText, on && s.quickTextOn]}>{q}</Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            value={note}
            onChangeText={(t) => setNote(t.slice(0, NOTE_MAX))}
            placeholder="Add a note (optional)"
            placeholderTextColor={colors.textMuted}
            style={s.input}
            multiline
            maxLength={NOTE_MAX}
          />
          <Text style={s.count}>
            {note.length}/{NOTE_MAX}
          </Text>

          <View style={s.locRow}>
            <View style={s.locIcon}>
              <Ionicons name="navigate" size={16} color={colors.sageDeep} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.locTitle}>Include where I am</Text>
              <Text style={s.locSub}>
                {withLocation
                  ? 'Your position is attached to this one check-in.'
                  : 'Off. Your circle sees the message, not the place.'}
              </Text>
            </View>
            <Switch
              value={withLocation}
              onValueChange={setWithLocation}
              trackColor={{ true: colors.sage, false: colors.border }}
              thumbColor={colors.surface}
            />
          </View>

          {error ? <Text style={s.error}>{error}</Text> : null}

          <Pressable
            onPress={submit}
            disabled={busy || !circleId}
            style={[s.cta, (busy || !circleId) && s.ctaOff]}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={s.ctaText}>Send check-in</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(23,22,28,0.4)' },
  lift: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: spacing.lg,
    paddingBottom: spacing.xl + 8,
    gap: 10,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 6,
  },
  title: { fontFamily: fontFamilies.poppinsBold, fontSize: 21, color: colors.textPrimary },
  lead: {
    fontFamily: fontFamilies.poppinsRegular,
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  quick: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickOn: { backgroundColor: colors.lavenderSoft, borderColor: colors.lavenderDeep },
  quickText: { fontFamily: fontFamilies.poppinsMedium, fontSize: 13, color: colors.textSecondary },
  quickTextOn: { color: colors.lavenderDeep },
  input: {
    minHeight: 62,
    borderRadius: radius.lg,
    backgroundColor: colors.cream,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    fontFamily: fontFamilies.poppinsRegular,
    fontSize: 15,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  count: {
    alignSelf: 'flex-end',
    fontFamily: fontFamilies.poppinsRegular,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: -4,
  },
  locRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    padding: 12,
  },
  locIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.sageSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textPrimary },
  locSub: {
    fontFamily: fontFamilies.poppinsRegular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  error: { fontFamily: fontFamilies.poppinsMedium, fontSize: 13, color: colors.coralDeep },
  cta: {
    marginTop: 4,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.lavenderDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaOff: { opacity: 0.5 },
  ctaText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 16, color: colors.textInverse },
});
