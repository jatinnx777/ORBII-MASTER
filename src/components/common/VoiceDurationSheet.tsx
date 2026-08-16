import React, { useMemo, useRef, useState } from 'react';
import {
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import { VOICE_MAX_HOURS } from '@/services/voice-detection';

// Scrollable duration wheel shown by EVERY gate that turns Voice SOS on. Values
// run 30 min → 8 hours (30-min steps), hard-capped, so the mic is always
// time-bounded. Confirming hands back the chosen hours.

const ITEM_H = 52;
const VISIBLE = 5; // odd, so one sits dead-centre
const PAD = Math.floor(VISIBLE / 2) * ITEM_H;

function label(h: number): string {
  if (h === 0) return 'Until I turn it off';
  if (h < 1) return '30 minutes';
  const whole = Math.floor(h);
  const half = h % 1 !== 0;
  const hr = `${whole} hour${whole > 1 ? 's' : ''}`;
  return half ? `${whole}h 30m` : hr;
}

export function VoiceDurationSheet({
  visible,
  initialHours = 2,
  title = 'How long should ORBII listen?',
  subtitle = 'It turns off on its own after this, and warns you before it ends. Max 8 hours.',
  icon = 'mic',
  allowAlways = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  initialHours?: number;
  title?: string;
  subtitle?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** Adds an "Until I turn it off" choice at the end of the wheel, reported as 0
   *  hours. Used for circle location sharing, where always-on is the point. The
   *  microphone deliberately never gets this. */
  allowAlways?: boolean;
  onConfirm: (hours: number) => void;
  onCancel: () => void;
}) {
  const options = useMemo(() => {
    const out: number[] = [];
    for (let h = 0.5; h <= VOICE_MAX_HOURS + 1e-6; h += 0.5) out.push(Math.round(h * 2) / 2);
    if (allowAlways) out.push(0); // 0 = until turned off, sits at the end
    return out;
  }, [allowAlways]);
  const startIdx = Math.max(0, options.findIndex((h) => h === initialHours));
  const [sel, setSel] = useState(startIdx < 0 ? 3 : startIdx);
  const scroller = useRef<ScrollView>(null);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
    if (i !== sel && i >= 0 && i < options.length) {
      setSel(i);
      Haptics.selectionAsync().catch(() => undefined);
    }
  };

  return (
    <Modal transparent visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <View style={styles.headIcon}><Ionicons name={icon} size={20} color={colors.brandDeep} /></View>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.sub}>{subtitle}</Text>
          </View>

          <View style={styles.pickerWrap}>
            <View style={styles.centerBand} pointerEvents="none" />
            <ScrollView
              ref={scroller}
              showsVerticalScrollIndicator={false}
              snapToInterval={ITEM_H}
              decelerationRate="fast"
              onMomentumScrollEnd={onScroll}
              onScrollEndDrag={onScroll}
              contentContainerStyle={{ paddingVertical: PAD }}
              contentOffset={{ x: 0, y: (startIdx < 0 ? 3 : startIdx) * ITEM_H }}
              style={{ height: ITEM_H * VISIBLE }}
            >
              {options.map((h, i) => {
                const dist = Math.abs(i - sel);
                return (
                  <View key={h} style={styles.item}>
                    <Text
                      style={[
                        styles.itemText,
                        i === sel && styles.itemTextOn,
                        { opacity: dist === 0 ? 1 : dist === 1 ? 0.5 : 0.25 },
                      ]}
                    >
                      {label(h)}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          </View>

          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
              onConfirm(options[sel]);
            }}
            style={({ pressed }) => [styles.confirm, pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] }]}
          >
            <Ionicons name="shield-checkmark" size={18} color={colors.textInverse} />
            <Text style={styles.confirmText}>{options[sel] === 0 ? 'Turn on until I stop it' : `Turn on for ${label(options[sel])}`}</Text>
          </Pressable>
          <Pressable onPress={onCancel} style={styles.cancel} hitSlop={8}>
            <Text style={styles.cancelText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17,16,28,0.42)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    ...shadows.sheet,
  },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 99, backgroundColor: colors.creamDeep, marginBottom: spacing.md },
  head: { alignItems: 'center', gap: 4 },
  headIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  title: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: colors.textPrimary, textAlign: 'center' },
  sub: { fontFamily: fontFamilies.interRegular, fontSize: 13, lineHeight: 18, color: colors.textSecondary, textAlign: 'center', maxWidth: 300, marginTop: 2 },

  pickerWrap: { marginVertical: spacing.md, position: 'relative' },
  centerBand: {
    position: 'absolute',
    left: 0, right: 0, top: PAD, height: ITEM_H,
    backgroundColor: colors.brandSoft,
    borderRadius: radius.md,
  },
  item: { height: ITEM_H, alignItems: 'center', justifyContent: 'center' },
  itemText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 20, color: colors.textPrimary },
  itemTextOn: { fontFamily: fontFamilies.poppinsBold, fontSize: 22, color: colors.brandDeep },

  confirm: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.brand, borderRadius: radius.pill, paddingVertical: 16, marginTop: spacing.sm,
    ...shadows.card,
  },
  confirmText: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.textInverse },
  cancel: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.xs },
  cancelText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textSecondary },
});
