import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
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
import { HelperCard, HelperCardData } from './components/HelperCard';
import { OSMMapView, type OSMMarker, type OSMPolyline } from '@/components/common';
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

// Auto-resolve when the nearest responder closes to within 40m — they're
// physically with the victim at that point.
const ARRIVAL_RADIUS_M = 40;
const STALE_PING_MS = 45_000;
const NO_HELPER_WARN_MS = 120_000;

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

  const userLocation: GeoPoint | null = activeSOS
    ? {
        latitude: activeSOS.location.latitude,
        longitude: activeSOS.location.longitude,
      }
    : null;

  // Subscribe to the SOS's live-location channel. Every responder who is
  // actively navigating to this SOS broadcasts their GPS here. We upsert
  // by responder id so multiple helpers can show up simultaneously.
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

  // Prune stale responders that haven't pinged in 45s (app closed, lost
  // signal, gave up). Keeps the card list honest.
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

  // Arrival detection: the closest responder within ARRIVAL_RADIUS_M of
  // the victim ends the SOS.
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
      Alert.alert(
        'Still searching',
        'No one has responded yet. Your SOS is still broadcasting to every ORBII user within 2km.',
      );
    }, NO_HELPER_WARN_MS);
    return () => clearTimeout(id);
  }, [responderList.length, resolved, noHelperWarned]);

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

  const handleCancel = useCallback(() => {
    Alert.alert(
      'Cancel SOS?',
      'Helpers may be on the way. Only cancel if you are truly safe.',
      [
        { text: 'Keep active', style: 'cancel' },
        {
          text: 'Cancel SOS',
          style: 'destructive',
          onPress: () => {
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
        },
      ],
    );
  }, [activeSOS, dispatch, helperSummaries, navigation]);

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
        dispatch(
          sosResolved({ responderId: responder?.id ?? null, rating }),
        );
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

  const helperCards: HelperCardData[] = useMemo(() => {
    if (!userLocation) return [];
    return responderList.map((r) => {
      const dist = haversineMeters(r.point, userLocation);
      return {
        id: r.id,
        name: r.name,
        photoUri: r.photoUri,
        rating: 0,
        phone: r.phone ?? '',
        distanceMeters: dist,
        etaSeconds: etaSeconds(dist),
      };
    });
  }, [responderList, userLocation]);

  const mapMarkers: OSMMarker[] = useMemo(() => {
    if (!userLocation) return [];
    const list: OSMMarker[] = [
      { id: 'me', coordinate: userLocation, kind: 'user', pulse: !resolved },
    ];
    responderList.forEach((r) => {
      const initial = r.name.charAt(0).toUpperCase() || '?';
      list.push({
        id: r.id,
        coordinate: r.point,
        html: `
          <div style="
            width:40px;height:40px;border-radius:20px;
            background:#00C853;border:3px solid #fff;
            display:flex;align-items:center;justify-content:center;
            color:#fff;font-family:-apple-system,Roboto,sans-serif;
            font-weight:700;font-size:16px;
            box-shadow:0 4px 12px rgba(0,0,0,0.35);
          ">${initial}</div>
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
      color: '#00C853',
      width: 4,
    }));
  }, [userLocation, responderList, resolved]);

  if (!userLocation || !activeSOS) {
    return <MissingRecord navigation={navigation} />;
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.topBar}>
        <View style={styles.topRow}>
          <View style={styles.liveDot} />
          <Text style={styles.topLabel}>Help requested</Text>
        </View>
        <Text style={styles.topTimer}>{formatElapsed(elapsed)}</Text>
      </View>

      <View style={styles.mapWrap}>
        <OSMMapView
          style={StyleSheet.absoluteFill}
          center={userLocation}
          zoom={15}
          fitAll={responderList.length > 0}
          markers={mapMarkers}
          polylines={mapPolylines}
        />
      </View>

      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle}>
          {helperCards.length > 0
            ? `${helperCards.length} responder${helperCards.length === 1 ? '' : 's'} heading to you`
            : 'Broadcasting SOS…'}
        </Text>

        {helperCards.length === 0 ? (
          <View style={styles.findingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.findingText}>
              Alerting every ORBII user within 2km
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {helperCards.map((card) => (
              <HelperCard key={card.id} data={card} />
            ))}
          </ScrollView>
        )}

        <Pressable
          onPress={handleCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel SOS"
          style={({ pressed }) => [
            styles.cancelBtn,
            pressed && styles.cancelPressed,
          ]}
        >
          <Ionicons name="close-circle-outline" size={20} color={colors.primary} />
          <Text style={styles.cancelText}>Cancel SOS</Text>
        </Pressable>
      </View>

      <ResolvedModal
        visible={resolved}
        helperName={resolvedBy?.name ?? ''}
        onSubmit={handleResolved}
      />
    </View>
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

const SHEET_HEIGHT_PCT = 0.38;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    backgroundColor: colors.primary,
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.textInverse,
  },
  topLabel: {
    ...typography.bodyMedium,
    color: colors.textInverse,
    letterSpacing: 0.5,
  },
  topTimer: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textInverse,
    fontVariant: ['tabular-nums'],
  },
  mapWrap: {
    flex: 1,
    backgroundColor: '#E3E8EE',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    minHeight: `${SHEET_HEIGHT_PCT * 100}%`,
    ...shadows.sheet,
    gap: spacing.sm,
  },
  sheetHandle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginTop: 4,
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  findingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  findingText: { ...typography.body, color: colors.textSecondary },
  list: { flexGrow: 0 },
  listContent: { paddingBottom: spacing.sm },
  cancelBtn: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  cancelPressed: { opacity: 0.85 },
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
