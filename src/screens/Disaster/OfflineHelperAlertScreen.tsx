import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenContainer } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import { trackEvent } from '@/services/analytics';
import type { AppStackParamList } from '@/navigation/types';
import {
  subscribeHelperPings,
  rssiToCloseness,
  closenessLabel,
} from '@/services/mesh-helper-alert';

// Smoothing: RSSI is jumpy, so we ease toward each new reading.
const EMA = 0.3;
// If we stop hearing the ping for this long, they may have moved or been helped.
const LOST_MS = 18000;

export function OfflineHelperAlertScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<AppStackParamList, 'OfflineHelperAlert'>>();
  const { alertId } = route.params;

  const [accepted, setAccepted] = useState(false);
  const [closeness, setCloseness] = useState(0);
  const [lost, setLost] = useState(false);
  const closeRef = useRef(0);
  const lastPingRef = useRef(Date.now());

  useEffect(() => {
    const unsub = subscribeHelperPings((p) => {
      if (p.alertId !== alertId) return;
      lastPingRef.current = Date.now();
      setLost(false);
      const c = rssiToCloseness(p.rssi);
      closeRef.current = closeRef.current === 0 ? c : closeRef.current * (1 - EMA) + c * EMA;
      setCloseness(closeRef.current);
    });
    const timer = setInterval(() => {
      if (Date.now() - lastPingRef.current > LOST_MS) setLost(true);
    }, 3000);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, [alertId]);

  const accept = () => {
    setAccepted(true);
    trackEvent('offline_helper_accept', { alertId });
    Vibration.vibrate(60);
  };

  const label = lost ? 'Signal lost' : closenessLabel(closeness);
  const pct = Math.round(closeness * 100);

  return (
    <ScreenContainer padded={false} scroll={false} edges={['top', 'left', 'right']}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {!accepted ? (
          <View style={styles.body}>
            <View style={styles.pulseIcon}>
              <Ionicons name="hand-left" size={44} color={colors.textInverse} />
            </View>
            <Text style={styles.title}>Someone near you needs help</Text>
            <Text style={styles.sub}>
              A person within Bluetooth range has sent an SOS with no internet. No location is shared,
              only that they are close. If you can, help them find you.
            </Text>
            <View style={styles.actions}>
              <Pressable onPress={accept} style={({ pressed }) => [styles.helpBtn, pressed && styles.pressed]}>
                <Ionicons name="walk" size={22} color={colors.textInverse} />
                <Text style={styles.helpText}>I'll help</Text>
              </Pressable>
              <Pressable onPress={() => navigation.goBack()} style={styles.laterBtn}>
                <Text style={styles.laterText}>Not now</Text>
              </Pressable>
            </View>
            <Text style={styles.foot}>Offline emergency · Bluetooth</Text>
          </View>
        ) : (
          <View style={styles.body}>
            <Text style={styles.homingLabel}>{label}</Text>
            <View style={styles.meterWrap}>
              <View style={styles.meterTrack}>
                <View
                  style={[
                    styles.meterFill,
                    { height: `${lost ? 8 : Math.max(8, pct)}%`, backgroundColor: lost ? colors.textMuted : colors.coral },
                  ]}
                />
              </View>
              <Ionicons
                name={lost ? 'help-buoy' : closeness >= 0.85 ? 'checkmark-circle' : 'navigate'}
                size={30}
                color={lost ? colors.textMuted : colors.coral}
                style={{ marginTop: spacing.md }}
              />
            </View>
            <Text style={styles.homingHint}>
              {lost
                ? "You've lost their signal. Move around, or they may already be safe."
                : closeness >= 0.85
                  ? 'You should be right beside them. Look around and call out.'
                  : 'Walk slowly. The bar rises as you get closer, and falls as you move away.'}
            </Text>
            <Pressable onPress={() => navigation.goBack()} style={styles.laterBtn}>
              <Text style={styles.laterText}>Close</Text>
            </Pressable>
            <Text style={styles.foot}>Homing by Bluetooth signal · no GPS</Text>
          </View>
        )}
      </SafeAreaView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  pulseIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    ...shadows.icon,
  },
  title: { fontFamily: fontFamilies.poppinsBold, fontSize: 24, color: colors.textPrimary, textAlign: 'center' },
  sub: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 340,
  },
  actions: { width: '100%', marginTop: spacing.xl, gap: spacing.md },
  helpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.coral,
    borderRadius: radius.pill,
    paddingVertical: spacing.lg,
    ...shadows.card,
  },
  helpText: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: colors.textInverse },
  laterBtn: { alignItems: 'center', paddingVertical: spacing.md },
  laterText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textSecondary },
  foot: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.lg,
  },

  homingLabel: { fontFamily: fontFamilies.poppinsBold, fontSize: 26, color: colors.textPrimary, textAlign: 'center' },
  meterWrap: { alignItems: 'center', marginTop: spacing.xl },
  meterTrack: {
    width: 64,
    height: 220,
    borderRadius: 32,
    backgroundColor: colors.surfaceMuted,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    ...shadows.icon,
  },
  meterFill: { width: '100%', borderRadius: 32 },
  homingHint: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
    maxWidth: 320,
  },
  pressed: { opacity: 0.85 },
});
