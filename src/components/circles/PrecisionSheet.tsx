import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radius, spacing } from '@/theme';
import { PRECISION_OPTIONS, setLocationPrecision } from '@/services/circle-feed';

/**
 * How precisely your circle sees you.
 *
 * Sharing used to be all or nothing: exact coordinates, or a grey pin and no
 * position at all. That forces a choice nobody should have to make, between
 * being followed to a doorway and being invisible.
 *
 * THE SNAP HAPPENS IN THE DATABASE (sql/123), not here. Your true coordinate
 * never crosses the wire, so this is not a display setting that a determined
 * reader could see past. The grid also carries a per-user stable jitter, which
 * is what stops somebody averaging a hundred readings back into a real point.
 *
 * AN SOS IGNORES THIS ENTIRELY, and the sheet says so, because a neighbourhood
 * is useless to somebody trying to reach her.
 */

export function PrecisionSheet({
  visible,
  current,
  onClose,
  onChanged,
}: {
  visible: boolean;
  current: number | null;
  onClose: () => void;
  onChanged: (metres: number | null) => void;
}) {
  const [busy, setBusy] = useState<number | null | 'none'>('none');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) setError(null);
  }, [visible]);

  const pick = useCallback(
    async (metres: number | null) => {
      if (busy !== 'none') return;
      setBusy(metres);
      setError(null);
      const result = await setLocationPrecision(metres);
      setBusy('none');
      if (result === 'failed') {
        setError('That did not save. Check your connection and try again.');
        return;
      }
      Haptics.selectionAsync().catch(() => undefined);
      onChanged(metres);
      if (result === 'pending') {
        // Stored, but there is no position for it to apply to yet. Saying
        // "saved" and closing would let her believe a radius is protecting a
        // position she has not started sending.
        setError(
          'Saved. It takes effect the moment you start sharing your location, ' +
          'which you are not doing yet.',
        );
        return;
      }
      onClose();
    },
    [busy, onChanged, onClose],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={s.lift}>
        <View style={s.sheet}>
          <View style={s.grabber} />
          <Text style={s.title}>Location precision</Text>
          <Text style={s.lead}>
            Applies to every circle you are in, day to day.
          </Text>

          <View style={s.list}>
            {PRECISION_OPTIONS.map((opt) => {
              const on = opt.metres === current;
              const loading = busy === opt.metres;
              return (
                <Pressable
                  key={String(opt.metres)}
                  onPress={() => pick(opt.metres)}
                  style={[s.row, on && s.rowOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[s.rowTitle, on && s.rowTitleOn]}>{opt.label}</Text>
                    <Text style={s.rowSub}>{opt.detail}</Text>
                  </View>
                  {loading ? (
                    <ActivityIndicator color={colors.lavenderDeep} />
                  ) : on ? (
                    <Ionicons name="checkmark-circle" size={22} color={colors.lavenderDeep} />
                  ) : (
                    <View style={s.radio} />
                  )}
                </Pressable>
              );
            })}
          </View>

          {error ? <Text style={s.error}>{error}</Text> : null}

          <View style={s.note}>
            <Ionicons name="shield-checkmark" size={15} color={colors.sageDeep} />
            <Text style={s.noteText}>
              An SOS always sends your exact position, whatever you choose here.
            </Text>
          </View>
        </View>
      </View>
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
  list: { gap: 8, marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.cream,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  rowOn: { backgroundColor: colors.lavenderSoft, borderColor: colors.lavenderDeep },
  rowTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary },
  rowTitleOn: { color: colors.lavenderDeep },
  rowSub: {
    fontFamily: fontFamilies.poppinsRegular,
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: 2,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
  },
  error: { fontFamily: fontFamilies.poppinsMedium, fontSize: 13, color: colors.coralDeep },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.sageSoft,
    borderRadius: radius.lg,
    padding: 12,
    marginTop: 2,
  },
  noteText: {
    flex: 1,
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.sageDeep,
  },
});
