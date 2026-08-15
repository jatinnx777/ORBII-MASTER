import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { ScreenContainer, useBrandSheet } from '@/components/common';
import {
  colors,
  fontFamilies,
  radius,
  spacing,
  typography,
} from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import {
  disarmDeadman,
  extendDeadman,
} from '@/services/deadman';
import { createSOS } from '@/services/sos';
import { sosDispatchSucceeded } from '@/redux/slices/sosSlice';
import { historyRecordAdded } from '@/redux/slices/historySlice';
import { upsertSOSRecord } from '@/services/sos-history';
import { getFastLocation } from '@/services/location';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'DeadmanActive'>;

// Active deadman timer view. Shows a circular countdown ring (text only,
// no SVG dependency) plus three actions: extend, confirm safe, cancel.
//
// On expiry (the screen is foreground when the timer hits 0), we
// automatically fire an SOS broadcast tagged with the timer note. If
// the app is in background / killed when the timer ends, the scheduled
// expiry notification handles user-facing surface; tapping it routes
// here to trigger the same auto-SOS.

export function DeadmanActiveScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const sheet = useBrandSheet();
  const profile = useAppSelector((s) => s.user.profile);
  const timer = useAppSelector((s) => s.safetyModes.deadman);

  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);

  // 1Hz tick keeps the countdown text current.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Soft breathing on the countdown ring.
  const breathe = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1.02,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathe]);

  if (!timer.active || timer.expiresAt == null) {
    // Timer was disarmed elsewhere (notification handler), punt back.
    setTimeout(() => navigation.goBack(), 0);
    return null;
  }

  const remainingMs = Math.max(0, timer.expiresAt - now);
  const totalMs = timer.durationMs ?? 1;
  const progress = 1 - remainingMs / totalMs;

  const minutes = Math.floor(remainingMs / 60_000);
  const seconds = Math.floor((remainingMs % 60_000) / 1000);

  // Foreground auto-fire on expiry. Background path is the scheduled
  // notification (handled by App.tsx response listener, could also
  // route here when tapped).
  useEffect(() => {
    if (remainingMs > 0 || fired.current || !profile) return;
    fired.current = true;
    (async () => {
      try {
        const point = timer.shareLocation
          ? await getFastLocation().catch(() => null)
          : null;
        const record = await createSOS(
          profile,
          {
            latitude: point?.latitude ?? 0,
            longitude: point?.longitude ?? 0,
            address: timer.note ?? 'Deadman timer expired',
          },
          'real',
        );
        dispatch(sosDispatchSucceeded(record));
        const finalRecord = {
          ...record,
          status: 'active' as const,
        };
        dispatch(historyRecordAdded(finalRecord));
        upsertSOSRecord(finalRecord).catch(() => undefined);
        await disarmDeadman();
        sheet.notify({
          title: 'Your circle has been alerted',
          body:
            timer.shareLocation && point
              ? "We've shared your location with the people you trusted with this timer."
              : "We've notified the people you trusted with this timer.",
          tone: 'destructive',
          icon: 'shield-checkmark',
        });
        navigation.replace('ActiveSOS');
      } catch (err) {
        sheet.notify({
          title: 'Could not auto-fire SOS',
          body:
            err instanceof Error
              ? err.message
              : 'Something went wrong escalating the timer.',
          tone: 'warning',
        });
      }
    })();
  }, [remainingMs, profile, timer, dispatch, sheet, navigation]);

  const handleConfirmSafe = async () => {
    sheet.confirm({
      title: 'Confirm you are safe?',
      body:
        'This cancels the timer. Your circle will not be alerted. You can re-arm it any time.',
      confirmLabel: "I'm safe",
      icon: 'shield-checkmark',
      onConfirm: async () => {
        await disarmDeadman();
        navigation.goBack();
      },
    });
  };

  const handleCancel = () => {
    sheet.confirm({
      title: 'Cancel the timer?',
      body:
        "We won't alert your circle. You can arm a new timer whenever you need.",
      destructive: true,
      confirmLabel: 'Cancel timer',
      cancelLabel: 'Keep running',
      icon: 'close-circle',
      onConfirm: async () => {
        await disarmDeadman();
        navigation.goBack();
      },
    });
  };

  const handleExtend = (extraMinutes: number) => {
    extendDeadman(extraMinutes * 60_000).catch(() => undefined);
  };

  return (
    <ScreenContainer padded={false} scroll={false}>
      <View style={styles.root}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-down" size={20} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.statusPill}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>Watching over you</Text>
          </View>
          <View style={{ width: 38 }} />
        </View>

        <View style={styles.spacer} />

        <Animated.View style={{ transform: [{ scale: breathe }] }}>
          <LinearGradient
            colors={[colors.brandSoft, '#FFFFFF']}
            style={styles.ring}
          >
            <View style={styles.ringInner}>
              <Text style={styles.ringTime}>
                {minutes.toString().padStart(2, '0')}:
                {seconds.toString().padStart(2, '0')}
              </Text>
              <Text style={styles.ringLabel}>before alert</Text>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.min(100, Math.max(0, progress * 100))}%` },
                  ]}
                />
              </View>
            </View>
          </LinearGradient>
        </Animated.View>

        {timer.note ? (
          <Text style={styles.noteText} numberOfLines={2}>
            {timer.note}
          </Text>
        ) : null}

        <Text style={styles.recipientsLabel}>
          {timer.recipients.length === 1
            ? `${timer.recipients[0]} will be alerted`
            : `${timer.recipients.length} people will be alerted`}
        </Text>

        <View style={styles.spacer} />

        <View style={styles.extendRow}>
          {[5, 15, 30].map((mins) => (
            <Pressable
              key={mins}
              onPress={() => handleExtend(mins)}
              style={({ pressed }) => [
                styles.extendBtn,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.extendBtnText}>+{mins} min</Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={handleConfirmSafe}
          style={({ pressed }) => [
            styles.safeBtn,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="shield-checkmark" size={16} color={colors.textInverse} />
          <Text style={styles.safeBtnText}>I'm safe, cancel timer</Text>
        </Pressable>

        <Pressable onPress={handleCancel} style={styles.cancelLink}>
          <Text style={styles.cancelLinkText}>End without alerting</Text>
        </Pressable>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingBottom: 100,
    alignItems: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    paddingTop: spacing.sm,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.circle,
    backgroundColor: colors.brandSoft,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.brandDeep,
  },
  statusText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 11,
    color: colors.brandDeep,
    letterSpacing: 0.4,
  },
  spacer: { flex: 1 },
  ring: {
    width: 240,
    height: 240,
    borderRadius: 120,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.brandDeep,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
    elevation: 6,
  },
  ringInner: {
    flex: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.background,
    borderRadius: 116,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  ringTime: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 56,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  ringLabel: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 12,
    color: colors.textSecondary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  progressTrack: {
    height: 4,
    width: '70%',
    borderRadius: 2,
    backgroundColor: colors.surface,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.brandDeep,
  },
  noteText: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  recipientsLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 6,
  },
  extendRow: {
    flexDirection: 'row',
    gap: 8,
    alignSelf: 'stretch',
  },
  extendBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  extendBtnText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  safeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 52,
    alignSelf: 'stretch',
    marginTop: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.brandDeep,
    shadowColor: colors.brandDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.30,
    shadowRadius: 12,
    elevation: 6,
  },
  safeBtnText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 15,
    color: colors.textInverse,
    letterSpacing: 0.3,
  },
  cancelLink: {
    alignSelf: 'center',
    paddingVertical: spacing.md,
  },
  cancelLinkText: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 13,
    color: colors.textMuted,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
});
