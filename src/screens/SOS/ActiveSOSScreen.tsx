import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ResolvedModal } from './components/ResolvedModal';
import {
  OSMMapView,
  useBrandSheet,
  type OSMMarker,
  type OSMPolyline,
} from '@/components/common';
import { broadcastExpandRadius } from '@/services/community';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import {
  sosCancelled,
  sosCleared,
  sosResolved,
} from '@/redux/slices/sosSlice';
import { historyRecordAdded } from '@/redux/slices/historySlice';
import { trackEvent } from '@/services/analytics';
import { fireLocalNotification } from '@/services/notifications';
import { subscribeLiveLocation } from '@/services/live-location';
import { etaSeconds, formatElapsed, haversineMeters } from '@/utils/geo';
import type { GeoPoint, HelperSummary } from '@/types';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

// Auto-resolve when the nearest responder closes to within 40m of the user.
const ARRIVAL_RADIUS_M = 40;
const STALE_PING_MS = 45_000;
const NO_HELPER_WARN_MS = 120_000;
// Sender expands the alert radius from 2 km → 5 km if no responder pings
// the live-location channel within this window.
const EXPAND_RADIUS_AFTER_MS = 60_000;

type LiveResponder = {
  id: string;
  name: string;
  photoUri: string | null;
  phone: string | null;
  point: GeoPoint;
  lastSeenAt: number;
  firstSeenAt: number;
};

export function ActiveSOSScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const activeSOS = useAppSelector((s) => s.sos.activeSOS);

  const [responders, setResponders] = useState<Record<string, LiveResponder>>({});
  const [resolved, setResolved] = useState(false);
  const [resolvedBy, setResolvedBy] = useState<LiveResponder | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [noHelperWarned, setNoHelperWarned] = useState(false);

  const sheet = useBrandSheet();

  const userLocation: GeoPoint | null = activeSOS
    ? {
        latitude: activeSOS.location.latitude,
        longitude: activeSOS.location.longitude,
      }
    : null;

  useEffect(() => {
    if (!activeSOS?.id) return;
    const sub = subscribeLiveLocation(activeSOS.id, (payload) => {
      setResponders((prev) => {
        const existing = prev[payload.responder.id];
        return {
          ...prev,
          [payload.responder.id]: {
            id: payload.responder.id,
            name: payload.responder.name,
            photoUri: payload.responder.photoUri,
            phone: payload.responder.phone,
            point: payload.point,
            lastSeenAt: payload.at,
            firstSeenAt: existing?.firstSeenAt ?? payload.at,
          },
        };
      });
    });
    return () => sub.unsubscribe();
  }, [activeSOS?.id]);

  useEffect(() => {
    const id = setInterval(() => {
      setResponders((prev) => {
        const cutoff = Date.now() - STALE_PING_MS;
        const next: Record<string, LiveResponder> = {};
        Object.values(prev).forEach((r) => {
          if (r.lastSeenAt >= cutoff) next[r.id] = r;
        });
        return next;
      });
    }, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (resolved || !userLocation) return;
    const list = Object.values(responders);
    if (list.length === 0) return;
    const closest = list.reduce<LiveResponder | null>((best, r) => {
      if (!best) return r;
      return haversineMeters(r.point, userLocation) <
        haversineMeters(best.point, userLocation)
        ? r
        : best;
    }, null);
    if (!closest) return;
    if (haversineMeters(closest.point, userLocation) <= ARRIVAL_RADIUS_M) {
      setResolved(true);
      setResolvedBy(closest);
      fireLocalNotification(
        'Help has arrived',
        `${closest.name ?? 'Your helper'} is with you now.`,
      );
    }
  }, [responders, userLocation, resolved]);

  useEffect(() => {
    if (resolved) return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [resolved]);

  const responderList = useMemo(() => Object.values(responders), [responders]);

  useEffect(() => {
    if (noHelperWarned || responderList.length > 0 || resolved) return;
    const id = setTimeout(() => {
      setNoHelperWarned(true);
      sheet.notify({
        title: 'Still searching',
        body: 'No one has responded yet. Your SOS is still broadcasting to every ORBII user within 2 km.',
        tone: 'warning',
        icon: 'pulse',
      });
    }, NO_HELPER_WARN_MS);
    return () => clearTimeout(id);
  }, [responderList.length, resolved, noHelperWarned, sheet]);

  // Radius expansion: if no one responds in 60s, broadcast an expand
  // pulse so users 2-5 km away get this alert too. Fires only once per
  // active SOS — once any responder pings, we cancel the timer.
  const expandedRef = useRef(false);
  useEffect(() => {
    if (expandedRef.current || resolved || !activeSOS?.id) return;
    if (responderList.length > 0) return;
    const id = setTimeout(() => {
      if (expandedRef.current || responderList.length > 0) return;
      expandedRef.current = true;
      broadcastExpandRadius(activeSOS.id).catch(() => undefined);
    }, EXPAND_RADIUS_AFTER_MS);
    return () => clearTimeout(id);
  }, [responderList.length, resolved, activeSOS?.id]);

  const helperSummaries = useMemo<HelperSummary[]>(
    () =>
      responderList.map((r) => ({
        id: r.id,
        name: r.name,
        photoUri: r.photoUri,
        rating: 0,
      })),
    [responderList],
  );

  // Closest responder is the "primary" helper we render in the doorstep card.
  const primary = useMemo<LiveResponder | null>(() => {
    if (!userLocation || responderList.length === 0) return null;
    return responderList.reduce<LiveResponder | null>((best, r) => {
      if (!best) return r;
      return haversineMeters(r.point, userLocation) <
        haversineMeters(best.point, userLocation)
        ? r
        : best;
    }, null);
  }, [responderList, userLocation]);

  const primaryDistance =
    primary && userLocation ? haversineMeters(primary.point, userLocation) : null;
  const primaryEta = primaryDistance != null ? etaSeconds(primaryDistance) : null;

  const handleCancel = useCallback(() => {
    sheet.confirm({
      title: 'Cancel SOS?',
      body: 'Helpers may be on the way. Only cancel if you are truly safe.',
      cancelLabel: 'Keep active',
      confirmLabel: 'Cancel SOS',
      destructive: true,
      icon: 'close-circle',
      onConfirm: () => {
        if (activeSOS) {
          trackEvent('sos_cancelled', { sosId: activeSOS.id });
          dispatch(sosCancelled());
          dispatch(
            historyRecordAdded({
              ...activeSOS,
              helpers: helperSummaries,
              status: 'cancelled',
              resolvedAt: Date.now(),
              responseTime: Math.round(
                (Date.now() - activeSOS.timestamp) / 1000,
              ),
            }),
          );
        }
        dispatch(sosCleared());
        navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
      },
    });
  }, [activeSOS, dispatch, helperSummaries, navigation, sheet]);

  const handleResolved = useCallback(
    (rating: number) => {
      if (activeSOS) {
        const responder = resolvedBy
          ? {
              id: resolvedBy.id,
              name: resolvedBy.name,
              photoUri: resolvedBy.photoUri,
              rating: 0,
            }
          : null;
        trackEvent('sos_resolved', {
          sosId: activeSOS.id,
          rating,
          responderId: responder?.id ?? null,
        });
        dispatch(sosResolved({ responderId: responder?.id ?? null, rating }));
        dispatch(
          historyRecordAdded({
            ...activeSOS,
            helpers: helperSummaries,
            responder,
            rating,
            status: 'resolved',
            resolvedAt: Date.now(),
            responseTime: Math.round((Date.now() - activeSOS.timestamp) / 1000),
          }),
        );
      }
      dispatch(sosCleared());
      navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
    },
    [activeSOS, dispatch, helperSummaries, navigation, resolvedBy],
  );

  const handleCallHelper = () => {
    if (!primary?.phone) {
      sheet.notify({
        title: 'No number shared',
        body: 'This helper has not shared a phone number.',
        tone: 'warning',
      });
      return;
    }
    Linking.openURL(`tel:${primary.phone}`).catch(() => undefined);
  };

  const handleTip = (amount: number | 'other') => {
    sheet.notify({
      title: 'Tip recorded',
      body:
        amount === 'other'
          ? 'A custom tip will be available once payments are live.'
          : `₹${amount} tip queued. We will charge it once payments are live.`,
      tone: 'success',
      icon: 'heart',
    });
  };

  const mapMarkers: OSMMarker[] = useMemo(() => {
    if (!userLocation) return [];
    const list: OSMMarker[] = [
      {
        id: 'me',
        coordinate: userLocation,
        html: `
          <div style="position:relative;width:40px;height:48px;display:flex;align-items:flex-end;justify-content:center;">
            <div style="position:absolute;top:0;width:32px;height:32px;border-radius:16px;background:#fff;border:2px solid #1a1a1a;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.25);">
              <span style="font-size:16px;">🏠</span>
            </div>
            <div style="position:absolute;bottom:2px;width:10px;height:10px;border-radius:5px;background:#FF0000;border:2px solid #fff;"></div>
          </div>
        `,
        kind: 'destination',
        pulse: !resolved,
      },
    ];
    responderList.forEach((r) => {
      list.push({
        id: r.id,
        coordinate: r.point,
        html: `
          <div style="width:36px;height:36px;border-radius:18px;background:#1a1a1a;border:3px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-family:-apple-system,Roboto,sans-serif;font-weight:700;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.4);">
            <span>🛵</span>
          </div>
        `,
        pulse: true,
      });
    });
    return list;
  }, [userLocation, responderList, resolved]);

  const mapPolylines: OSMPolyline[] = useMemo(() => {
    if (!userLocation || resolved) return [];
    return responderList.map((r) => ({
      id: `line-${r.id}`,
      coordinates: [r.point, userLocation],
      color: '#1a1a1a',
      width: 3,
      dashed: true,
    }));
  }, [userLocation, responderList, resolved]);

  if (!userLocation || !activeSOS) {
    return <MissingRecord navigation={navigation} />;
  }

  const headerTitle = primary
    ? primaryDistance != null && primaryDistance <= 80
      ? 'Almost at your location'
      : 'Helper is on the way'
    : 'Broadcasting your SOS';
  const headerSub = primary ? 'Hold tight, help is closing in' : 'We are alerting everyone nearby';
  const statusBannerText = !primary
    ? 'No one has accepted yet. Still broadcasting.'
    : primaryDistance != null && primaryDistance <= 80
      ? 'Your helper is at your location'
      : primaryDistance != null && primaryDistance <= 300
        ? 'Your helper is very close'
        : `ETA about ${Math.max(1, Math.round((primaryEta ?? 0) / 60))} min`;

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Pressable
            onPress={handleCancel}
            hitSlop={12}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Cancel SOS"
          >
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.headerSub}>{headerSub}</Text>
            <Text style={styles.headerTitle}>{headerTitle}</Text>
          </View>
          <View style={styles.elapsedPill}>
            <View style={styles.liveDot} />
            <Text style={styles.elapsedText}>{formatElapsed(elapsed)}</Text>
          </View>
        </View>

        <View style={styles.statusBanner}>
          <Text style={styles.statusBannerText}>{statusBannerText}</Text>
        </View>

        <View style={styles.mapCard}>
          <OSMMapView
            style={styles.map}
            center={primary ? primary.point : userLocation}
            zoom={16}
            fitAll={responderList.length > 0}
            markers={mapMarkers}
            polylines={mapPolylines}
          />
        </View>

        {primary ? (
          <View style={styles.helperCard}>
            <HelperAvatar />
            <View style={{ flex: 1 }}>
              <Text style={styles.helperGreeting}>I'm {primary.name},</Text>
              <Text style={styles.helperRole}>your helper</Text>
            </View>
            <Pressable
              onPress={handleCallHelper}
              style={styles.callBtn}
              accessibilityRole="button"
              accessibilityLabel="Call helper"
            >
              <Ionicons name="call" size={18} color={colors.primary} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.searchingCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.searchingText}>
              Alerting every ORBII user within 2 km
            </Text>
          </View>
        )}

        {primary ? (
          <View style={styles.subStatus}>
            <Text style={styles.subStatusText}>
              {primaryDistance != null && primaryDistance <= 300
                ? "I'm near your location and will reach you very soon"
                : "I'm on my way, share your spot if anything changes"}
            </Text>
          </View>
        ) : null}

        <View style={styles.tipCard}>
          <View style={styles.tipCardLeft}>
            <Text style={styles.tipTitle}>Thank your helper</Text>
            <Text style={styles.tipSub}>A small tip goes a long way</Text>
          </View>
          <ThankYouArt />
        </View>

        <View style={styles.tipRow}>
          <TipPill emoji="🤞" label="₹20" onPress={() => handleTip(20)} />
          <TipPill emoji="💌" label="₹50" onPress={() => handleTip(50)} />
          <TipPill emoji="❤️" label="₹100" onPress={() => handleTip(100)} highlight />
          <TipPill emoji="👏" label="Other" onPress={() => handleTip('other')} />
        </View>

        <View style={styles.tipFootnote}>
          <Ionicons name="shield-checkmark" size={14} color={colors.success} />
          <Text style={styles.tipFootnoteText}>
            Stay on this screen until your helper arrives. Police and emergency
            contacts have already been notified.
          </Text>
        </View>

        <Pressable
          onPress={handleCancel}
          style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel="Cancel SOS"
        >
          <Ionicons name="close-circle-outline" size={18} color={colors.primary} />
          <Text style={styles.cancelText}>I'm safe, cancel SOS</Text>
        </Pressable>
      </ScrollView>

      <ResolvedModal
        visible={resolved}
        helperName={resolvedBy?.name ?? ''}
        onSubmit={handleResolved}
      />
    </View>
  );
}

// Stylised "cartoon" helper avatar built from layered Views. Black helmet,
// red shirt, white face. No external assets so the bundle stays small.
function HelperAvatar() {
  return (
    <View style={avatar.wrap}>
      <View style={avatar.helmet} />
      <View style={avatar.face} />
      <View style={avatar.shirt} />
    </View>
  );
}

// "Thank you" cartoon: scooter helper + waving home recipient, suggested
// with shapes and emoji rather than imported art.
function ThankYouArt() {
  return (
    <View style={art.wrap}>
      <View style={art.house}>
        <Text style={art.houseEmoji}>🏠</Text>
      </View>
      <View style={art.helperBlock}>
        <View style={art.helperHelmet} />
        <View style={art.helperBody} />
        <Text style={art.scooterEmoji}>🛵</Text>
      </View>
    </View>
  );
}

function TipPill({
  emoji,
  label,
  onPress,
  highlight,
}: {
  emoji: string;
  label: string;
  onPress: () => void;
  highlight?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tipPill,
        highlight && styles.tipPillHighlight,
        pressed && { opacity: 0.85 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Tip ${label}`}
    >
      <Text style={styles.tipPillEmoji}>{emoji}</Text>
      <Text style={[styles.tipPillLabel, highlight && styles.tipPillLabelHighlight]}>
        {label}
      </Text>
    </Pressable>
  );
}

function MissingRecord({ navigation }: { navigation: Nav }) {
  return (
    <View style={[styles.container, styles.missing]}>
      <Text style={styles.missingText}>No active SOS.</Text>
      <Pressable
        onPress={() =>
          navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] })
        }
      >
        <Text style={styles.missingLink}>Back to home</Text>
      </Pressable>
    </View>
  );
}

const avatar = StyleSheet.create({
  wrap: {
    width: 56,
    height: 64,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  helmet: {
    position: 'absolute',
    top: 0,
    width: 36,
    height: 26,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: '#1a1a1a',
    zIndex: 2,
  },
  face: {
    position: 'absolute',
    top: 16,
    width: 28,
    height: 22,
    borderRadius: 6,
    backgroundColor: '#F4C28E',
    zIndex: 1,
  },
  shirt: {
    position: 'absolute',
    bottom: 0,
    width: 56,
    height: 30,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.primary,
  },
});

const art = StyleSheet.create({
  wrap: {
    width: 110,
    height: 78,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
  },
  house: {
    position: 'absolute',
    right: 0,
    bottom: 6,
    width: 50,
    height: 60,
    borderRadius: 12,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#1a1a1a',
  },
  houseEmoji: {
    fontSize: 28,
  },
  helperBlock: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: 64,
    height: 70,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  helperHelmet: {
    position: 'absolute',
    top: 4,
    width: 24,
    height: 18,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    backgroundColor: '#1a1a1a',
    zIndex: 3,
  },
  helperBody: {
    position: 'absolute',
    top: 18,
    width: 30,
    height: 28,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    backgroundColor: colors.primary,
    zIndex: 2,
  },
  scooterEmoji: {
    fontSize: 30,
    zIndex: 4,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: 56,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSub: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 12,
  },
  headerTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textPrimary,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  elapsedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  elapsedText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 11,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  statusBanner: {
    backgroundColor: '#FFEDD5',
    paddingVertical: 10,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  statusBannerText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: '#B45309',
    letterSpacing: 0.2,
  },
  mapCard: {
    height: 280,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#E3E8EE',
    ...shadows.card,
  },
  map: {
    flex: 1,
  },
  helperCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  helperGreeting: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 17,
    color: colors.textPrimary,
  },
  helperRole: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
  },
  callBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  searchingText: {
    ...typography.body,
    color: colors.textSecondary,
    flex: 1,
  },
  subStatus: {
    backgroundColor: '#FFEDD5',
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  subStatusText: {
    ...typography.body,
    color: '#B45309',
    fontSize: 13,
    fontFamily: fontFamilies.poppinsMedium,
  },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF6EC',
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    gap: spacing.md,
  },
  tipCardLeft: {
    flex: 1,
    gap: 2,
  },
  tipTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  tipSub: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 12,
  },
  tipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: -spacing.sm,
  },
  tipPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tipPillHighlight: {
    borderColor: colors.primary,
    backgroundColor: '#FFF7F7',
  },
  tipPillEmoji: {
    fontSize: 14,
  },
  tipPillLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  tipPillLabelHighlight: {
    color: colors.primary,
  },
  tipFootnote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.xs,
  },
  tipFootnoteText: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.background,
    marginTop: spacing.sm,
  },
  cancelText: {
    ...typography.button,
    color: colors.primary,
  },
  missing: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  missingText: { ...typography.h3, color: colors.textPrimary },
  missingLink: { ...typography.bodyMedium, color: colors.primary },
});
