import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { IconBadge, Mascot, MLMapView, type MLMarker } from '@/components/common';
import { colors, radius, shadows, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { respondToAlert } from '@/services/community';
import { trackEvent } from '@/services/analytics';
import { formatDistance } from '@/utils/geo';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;
type R = RouteProp<AppStackParamList, 'HelperAlert'>;

const RESPONSE_SECONDS = 15;
// Buzz-buzz, pause, buzz-buzz-buzz — the ORBII emergency signature. Distinct
// from a single social-notification buzz so helpers learn to recognise it.
const EMERGENCY_VIBRATION = [0, 300, 160, 300, 450, 300, 160, 300, 160, 300];

export function HelperAlertScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const { alertId } = route.params;

  const alert = useAppSelector((s) => s.community.alerts.find((a) => a.id === alertId) ?? null);
  const profile = useAppSelector((s) => s.user.profile);
  const myLocation = useAppSelector((s) => s.sos.currentLocation);

  const [secondsLeft, setSecondsLeft] = useState(RESPONSE_SECONDS);
  const [responding, setResponding] = useState(false);
  const bar = useRef(new Animated.Value(1)).current;

  // Custom emergency vibration on arrival.
  useEffect(() => {
    Vibration.vibrate(EMERGENCY_VIBRATION);
    return () => Vibration.cancel();
  }, []);

  // 15s response countdown. On timeout we record "ignored" and dismiss.
  useEffect(() => {
    Animated.timing(bar, {
      toValue: 0,
      duration: RESPONSE_SECONDS * 1000,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(id);
          if (alert) trackEvent('helper_alert_ignored', { alertId });
          Vibration.cancel();
          navigation.goBack();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const markers: MLMarker[] = useMemo(() => {
    const out: MLMarker[] = [];
    if (myLocation) out.push({ id: 'me', coordinate: myLocation, kind: 'user' });
    if (alert) out.push({ id: 'victim', coordinate: alert.location, kind: 'destination' });
    return out;
  }, [myLocation, alert]);

  if (!alert) {
    // alert resolved / expired while the screen was open
    return (
      <SafeAreaView style={styles.gone}>
        <Mascot pose="neutral" size={120} />
        <Text style={styles.goneText}>This request has been handled.</Text>
        <Pressable style={styles.goneBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.goneBtnText}>Close</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const timeAgo = (() => {
    const mins = Math.floor((Date.now() - alert.createdAt) / 60000);
    return mins <= 0 ? 'Just now' : `${mins} min ago`;
  })();

  const handleHelp = async () => {
    if (!profile) return;
    setResponding(true);
    Vibration.cancel();
    trackEvent('helper_alert_accepted', { alertId, distanceMeters: Math.round(alert.distanceMeters) });
    await respondToAlert(alert.id, {
      userId: profile.uid,
      name: profile.name ?? 'A helper',
      photoUri: profile.photoUri ?? null,
    });
    // In-app live navigation to the person in need — no bouncing out to
    // Google Maps. `replace` so the alert screen is removed from the stack.
    navigation.replace('HelperNavigation', {
      name: alert.victim.name,
      phone: alert.victim.phone ?? '',
      lat: alert.location.latitude,
      lng: alert.location.longitude,
      photoUri: alert.victim.photoUri,
    });
  };

  const handleDecline = () => {
    trackEvent('helper_alert_declined', { alertId });
    Vibration.cancel();
    navigation.goBack();
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* mascot peeking over the card with a worried prompt */}
        <View style={styles.mascotRow} pointerEvents="none">
          <View style={styles.bubble}>
            <Text style={styles.bubbleText}>Can you{'\n'}check on them?</Text>
          </View>
          <Mascot pose="shield" size={120} />
        </View>

        <View style={styles.card}>
          {/* response timer */}
          <View style={styles.timerRow}>
            <Text style={styles.timerText}>Respond within {secondsLeft}s</Text>
          </View>
          <View style={styles.timerTrack}>
            <Animated.View
              style={[
                styles.timerFill,
                { width: bar.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
              ]}
            />
          </View>

          <View style={styles.warnBadge}>
            <Ionicons name="warning" size={22} color={colors.coral} />
          </View>
          <Text style={styles.title}>Nearby User{'\n'}Needs Help</Text>
          <Text style={styles.subtitle}>A verified ORBII member may need assistance.</Text>

          <View style={styles.statsRow}>
            <Stat icon="location" tint="sage" value={formatDistance(alert.distanceMeters)} label="Distance" />
            <Stat icon="navigate" tint="lavender" value={alert.location.address ?? 'Nearby'} label="Location" />
            <Stat icon="time" tint="coral" value={timeAgo} label="Time" />
          </View>

          <View style={styles.liveRow}>
            <View style={styles.liveDot} />
            <Text style={styles.liveLabel}>Live Location</Text>
            <Text style={styles.liveUpdating}>Updating…</Text>
          </View>

          <View style={styles.map}>
            <MLMapView markers={markers} fitAll interactive={false} style={StyleSheet.absoluteFill} />
          </View>

          <View style={styles.reassure}>
            <IconBadge icon="shield-checkmark" tint="gold" size={36} />
            <View style={{ flex: 1, marginLeft: spacing.sm }}>
              <Text style={styles.reassureTitle}>This is a real emergency request.</Text>
              <Text style={styles.reassureBody}>Your help can make a big difference.</Text>
            </View>
          </View>

          <Pressable
            onPress={handleHelp}
            disabled={responding}
            style={({ pressed }) => [styles.helpBtn, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Ionicons name="shield-half" size={18} color={colors.textInverse} />
            <Text style={styles.helpText}>{responding ? 'CONNECTING…' : 'HELP NOW'}</Text>
          </Pressable>
          <Pressable
            onPress={handleDecline}
            style={({ pressed }) => [styles.declineBtn, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.declineText}>NOT AVAILABLE</Text>
          </Pressable>

          <Text style={styles.footer}>You are one of the nearest available helpers.</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

function Stat({
  icon,
  tint,
  value,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: 'sage' | 'lavender' | 'coral';
  value: string;
  label: string;
}) {
  return (
    <View style={styles.stat}>
      <IconBadge icon={icon} tint={tint} size={40} />
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  safe: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
  mascotRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginBottom: -24,
    zIndex: 2,
  },
  bubble: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    marginBottom: 28,
    marginRight: -8,
    ...shadows.icon,
  },
  bubbleText: { ...typography.bodyMedium, fontSize: 13, color: colors.textSecondary },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.lg,
    paddingTop: spacing.xl,
    ...shadows.card,
  },
  timerRow: { alignItems: 'center', marginBottom: spacing.xs },
  timerText: { ...typography.label, color: colors.coral },
  timerTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.coralSoft,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  timerFill: { height: 4, borderRadius: 2, backgroundColor: colors.coral },
  warnBadge: {
    alignSelf: 'center',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.coralSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.displaySmall,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
  },
  stat: { flex: 1, alignItems: 'center', gap: 4 },
  statValue: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 12.5,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: 4,
  },
  statLabel: { ...typography.caption, fontSize: 11, color: colors.textMuted },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.sage },
  liveLabel: { ...typography.label, color: colors.textPrimary },
  liveUpdating: { ...typography.label, color: colors.sageDeep },
  map: {
    height: 150,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginTop: spacing.sm,
    backgroundColor: colors.cream,
  },
  reassure: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.goldSoft,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  reassureTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 13.5, color: colors.textPrimary },
  reassureBody: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  helpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.sage,
    borderRadius: radius.pill,
    paddingVertical: 16,
    marginTop: spacing.lg,
    ...shadows.card,
  },
  helpText: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 15,
    color: colors.textInverse,
    letterSpacing: 0.5,
  },
  declineBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    paddingVertical: 15,
    marginTop: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  declineText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  footer: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  gone: {
    flex: 1,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  goneText: { ...typography.h3, color: colors.textPrimary },
  goneBtn: {
    backgroundColor: colors.peach,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  goneBtnText: { fontFamily: 'Poppins_600SemiBold', color: colors.textPrimary },
});
