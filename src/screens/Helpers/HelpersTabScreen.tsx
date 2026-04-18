import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import {
  Card,
  ScreenContainer,
  StarRating,
} from '@/components/common';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { formatDistance, haversineMeters, offsetPoint } from '@/utils/geo';
import type { GeoPoint } from '@/types';

type Mode = 'map' | 'list';

const DEMO_HELPERS = [
  { id: 'h1', name: 'Priya Sharma', rating: 4.9, jobs: 47, bearing: 30, distance: 320 },
  { id: 'h2', name: 'Rahul Verma', rating: 4.7, jobs: 28, bearing: 120, distance: 610 },
  { id: 'h3', name: 'Anjali Rao', rating: 5.0, jobs: 12, bearing: 220, distance: 890 },
  { id: 'h4', name: 'Neha Kapoor', rating: 4.8, jobs: 34, bearing: 300, distance: 1250 },
  { id: 'h5', name: 'Farhan Ali', rating: 4.6, jobs: 18, bearing: 75, distance: 1480 },
];

export function HelpersTabScreen() {
  const currentLocation = useAppSelector((s) => s.sos.currentLocation);
  const [mode, setMode] = useState<Mode>('map');

  const base: GeoPoint = currentLocation ?? {
    latitude: 12.8236,
    longitude: 80.0444,
  };

  const helpers = useMemo(
    () =>
      DEMO_HELPERS.map((h) => {
        const point = offsetPoint(base, h.distance, (h.bearing * Math.PI) / 180);
        return {
          ...h,
          point,
          distanceMeters: haversineMeters(point, base),
        };
      }).sort((a, b) => a.distanceMeters - b.distanceMeters),
    [base],
  );

  return (
    <ScreenContainer padded={false} scroll={false}>
      <View style={styles.header}>
        <Text style={styles.title}>Helpers nearby</Text>
        <Text style={styles.subtitle}>
          {helpers.length} verified helpers within 2 km
        </Text>

        <View style={styles.toggleWrap}>
          <Pressable
            style={[styles.toggleBtn, mode === 'map' && styles.toggleActive]}
            onPress={() => setMode('map')}
          >
            <Ionicons
              name="map"
              size={16}
              color={mode === 'map' ? colors.textInverse : colors.textPrimary}
            />
            <Text
              style={[
                styles.toggleText,
                mode === 'map' && styles.toggleTextActive,
              ]}
            >
              Map
            </Text>
          </Pressable>
          <Pressable
            style={[styles.toggleBtn, mode === 'list' && styles.toggleActive]}
            onPress={() => setMode('list')}
          >
            <Ionicons
              name="list"
              size={16}
              color={mode === 'list' ? colors.textInverse : colors.textPrimary}
            />
            <Text
              style={[
                styles.toggleText,
                mode === 'list' && styles.toggleTextActive,
              ]}
            >
              List
            </Text>
          </Pressable>
        </View>
      </View>

      {mode === 'map' ? (
        <View style={styles.mapWrap}>
          <MapView
            provider={PROVIDER_DEFAULT}
            style={StyleSheet.absoluteFill}
            initialRegion={{
              latitude: base.latitude,
              longitude: base.longitude,
              latitudeDelta: 0.04,
              longitudeDelta: 0.04,
            }}
            showsUserLocation
            showsMyLocationButton={false}
            toolbarEnabled={false}
          >
            {helpers.map((h) => (
              <Marker
                key={h.id}
                coordinate={h.point}
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <View style={styles.pin}>
                  <Text style={styles.pinInitial}>
                    {h.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
              </Marker>
            ))}
          </MapView>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.listContent}>
          {helpers.map((h) => (
            <Card key={h.id} style={styles.item}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {h.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.info}>
                <Text style={styles.name}>{h.name}</Text>
                <View style={styles.metaRow}>
                  <StarRating value={h.rating} size={12} />
                  <Text style={styles.meta}>{h.rating.toFixed(1)}</Text>
                  <Text style={styles.dot}>•</Text>
                  <Text style={styles.meta}>
                    {formatDistance(h.distanceMeters)}
                  </Text>
                  <Text style={styles.dot}>•</Text>
                  <Text style={styles.meta}>{h.jobs} jobs</Text>
                </View>
              </View>
              <View style={styles.onlineDot} />
            </Card>
          ))}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    padding: spacing.lg,
    gap: spacing.xs,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  toggleWrap: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: 4,
    alignSelf: 'flex-start',
    gap: 2,
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  toggleActive: {
    backgroundColor: colors.primary,
  },
  toggleText: {
    ...typography.bodyMedium,
    fontSize: 13,
    color: colors.textPrimary,
  },
  toggleTextActive: {
    color: colors.textInverse,
  },
  mapWrap: {
    flex: 1,
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: '#E3E8EE',
    marginBottom: spacing.lg,
  },
  pin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1976D2',
    borderWidth: 2.5,
    borderColor: colors.textInverse,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinInitial: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: colors.textInverse,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E3F2FD',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#1976D2',
  },
  avatarText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    color: '#1976D2',
  },
  info: { flex: 1, gap: 2 },
  name: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 16,
    color: colors.textPrimary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  dot: {
    ...typography.caption,
    color: colors.textMuted,
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
  },
});
