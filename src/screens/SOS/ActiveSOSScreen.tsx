import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, {
  Marker,
  Polyline,
  PROVIDER_DEFAULT,
} from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ResolvedModal } from './components/ResolvedModal';
import { HelperCard, HelperCardData } from './components/HelperCard';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import {
  sosCancelled,
  sosCleared,
  sosResolved,
} from '@/redux/slices/sosSlice';
import { historyRecordAdded } from '@/redux/slices/historySlice';
import { startSOSSimulation, SimulatedHelper } from '@/services/sosSimulator';
import { trackEvent } from '@/services/analytics';
import { fireLocalNotification } from '@/services/notifications';
import { etaSeconds, formatElapsed, haversineMeters } from '@/utils/geo';
import type { GeoPoint, HelperSummary } from '@/types';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

const NO_HELPER_TIMEOUT_MS = 120_000;

export function ActiveSOSScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const activeSOS = useAppSelector((s) => s.sos.activeSOS);

  const [helpers, setHelpers] = useState<SimulatedHelper[]>([]);
  const [resolved, setResolved] = useState(false);
  const [resolvedBy, setResolvedBy] = useState<SimulatedHelper | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [noHelperWarned, setNoHelperWarned] = useState(false);

  const mapRef = useRef<MapView | null>(null);
  const stopSimRef = useRef<() => void>(() => undefined);

  const userLocation: GeoPoint | null = activeSOS
    ? {
        latitude: activeSOS.location.latitude,
        longitude: activeSOS.location.longitude,
      }
    : null;

  useEffect(() => {
    if (!userLocation) return;
    stopSimRef.current = startSOSSimulation(userLocation, {
      onState: ({ helpers: nextHelpers, resolved: nextResolved, resolvedBy: by }) => {
        setHelpers(nextHelpers);
        if (nextResolved && !resolved) {
          setResolved(true);
          setResolvedBy(by);
          fireLocalNotification(
            'Help has arrived',
            `${by?.name ?? 'Your helper'} is with you now.`,
          );
        }
      },
    });
    return () => stopSimRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSOS?.id]);

  useEffect(() => {
    if (resolved) return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [resolved]);

  useEffect(() => {
    if (noHelperWarned || helpers.length > 0 || resolved) return;
    const id = setTimeout(() => {
      setNoHelperWarned(true);
      Alert.alert(
        'Expanding search',
        'No helpers accepted yet. Expanding to 5km and escalating to police control.',
      );
    }, NO_HELPER_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [helpers.length, resolved, noHelperWarned]);

  const helperSummaries = useMemo<HelperSummary[]>(
    () =>
      helpers.map((h) => ({
        id: h.id,
        name: h.name,
        photoUri: h.photoUri,
        rating: h.rating,
      })),
    [helpers],
  );

  const handleCancel = useCallback(() => {
    Alert.alert(
      'Cancel SOS?',
      'Helpers are on the way. Only cancel if you are truly safe.',
      [
        { text: 'Keep active', style: 'cancel' },
        {
          text: 'Cancel SOS',
          style: 'destructive',
          onPress: () => {
            stopSimRef.current();
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
      stopSimRef.current();
      if (activeSOS) {
        const responder = resolvedBy
          ? {
              id: resolvedBy.id,
              name: resolvedBy.name,
              photoUri: resolvedBy.photoUri,
              rating: resolvedBy.rating,
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
    return helpers.map((h) => {
      const dist = haversineMeters(h.location, userLocation);
      return {
        id: h.id,
        name: h.name,
        photoUri: h.photoUri,
        rating: h.rating,
        phone: h.phone,
        distanceMeters: dist,
        etaSeconds: etaSeconds(dist),
      };
    });
  }, [helpers, userLocation]);

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
        <MapView
          ref={mapRef}
          provider={PROVIDER_DEFAULT}
          style={StyleSheet.absoluteFill}
          initialRegion={{
            latitude: userLocation.latitude,
            longitude: userLocation.longitude,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          }}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass={false}
          toolbarEnabled={false}
        >
          <UserPin coordinate={userLocation} />

          {helpers.map((h) => (
            <React.Fragment key={h.id}>
              <Polyline
                coordinates={[h.location, userLocation]}
                strokeColor={colors.primary}
                strokeWidth={2.5}
                lineDashPattern={[6, 6]}
              />
              <Marker
                coordinate={h.location}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={!resolved}
              >
                <HelperPin name={h.name} photoUri={h.photoUri} />
              </Marker>
            </React.Fragment>
          ))}
        </MapView>

        <View pointerEvents="none" style={styles.mapShade} />
      </View>

      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle}>
          {helperCards.length > 0
            ? `${helperCards.length} helper${helperCards.length === 1 ? '' : 's'} responding`
            : 'Helpers Responding'}
        </Text>

        {helperCards.length === 0 ? (
          <View style={styles.findingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.findingText}>Finding helpers nearby…</Text>
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

function UserPin({ coordinate }: { coordinate: GeoPoint }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, {
            toValue: 2.2,
            duration: 1400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 0,
            duration: 1400,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, { toValue: 0.5, duration: 0, useNativeDriver: true }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scale, opacity]);

  return (
    <Marker coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }}>
      <View style={userPinStyles.wrap}>
        <Animated.View
          style={[
            userPinStyles.ripple,
            { transform: [{ scale }], opacity },
          ]}
        />
        <View style={userPinStyles.dot} />
      </View>
    </Marker>
  );
}

const userPinStyles = StyleSheet.create({
  wrap: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ripple: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.textInverse,
  },
});

function HelperPin({ name, photoUri }: { name: string; photoUri: string | null }) {
  const initial = name.trim().charAt(0).toUpperCase();
  return (
    <View style={helperPinStyles.wrap}>
      <View style={helperPinStyles.bubble}>
        {photoUri ? null : <Text style={helperPinStyles.initial}>{initial}</Text>}
      </View>
      <View style={helperPinStyles.tail} />
    </View>
  );
}

const helperPinStyles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
  bubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1976D2',
    borderWidth: 2.5,
    borderColor: colors.textInverse,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: colors.textInverse,
  },
  tail: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#1976D2',
    marginTop: -2,
  },
});

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
  mapShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    minHeight: `${SHEET_HEIGHT_PCT * 100}%`,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 12,
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
