import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  EmptyState,
  OSMMapView,
  ScreenContainer,
  StarRating,
  type OSMMarker,
} from '@/components/common';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '@/theme';
import { useAppSelector } from '@/redux/store';
import { formatDistance } from '@/utils/geo';
import { findNearestHelpers, type NearestHelper } from '@/services/helpers';
import type { GeoPoint } from '@/types';

type Mode = 'map' | 'list';

const DEFAULT_CENTER: GeoPoint = { latitude: 12.8236, longitude: 80.0444 };

export function HelpersTabScreen() {
  const currentLocation = useAppSelector((s) => s.sos.currentLocation);
  const [mode, setMode] = useState<Mode>('map');
  const [helpers, setHelpers] = useState<NearestHelper[]>([]);
  const [loading, setLoading] = useState(true);

  const base: GeoPoint = currentLocation ?? DEFAULT_CENTER;

  const load = useCallback(async () => {
    setLoading(true);
    const list = await findNearestHelpers(base, 5, 20);
    setHelpers(list);
    setLoading(false);
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  const mapMarkers: OSMMarker[] = useMemo(() => {
    const list: OSMMarker[] = [
      {
        id: 'me',
        coordinate: base,
        kind: 'user',
        pulse: true,
      },
    ];
    helpers.forEach((h) => {
      const initial = h.name.charAt(0).toUpperCase();
      list.push({
        id: h.userId,
        coordinate: h.location,
        html: `
          <div style="
            width:36px;height:36px;border-radius:18px;
            background:#1976D2;border:2.5px solid #fff;
            display:flex;align-items:center;justify-content:center;
            color:#fff;font-family:-apple-system,Roboto,sans-serif;
            font-weight:700;font-size:14px;
            box-shadow:0 2px 10px rgba(0,0,0,0.3);
          ">${initial}</div>
        `,
      });
    });
    return list;
  }, [base, helpers]);

  return (
    <ScreenContainer padded={false} scroll={false}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Helpers nearby</Text>
          <Text style={styles.subtitle}>
            {loading
              ? 'Searching…'
              : `${helpers.length} verified within 5 km`}
          </Text>
        </View>

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
          </Pressable>
        </View>
      </View>

      {mode === 'map' ? (
        <View style={styles.mapWrap}>
          <OSMMapView
            style={StyleSheet.absoluteFill}
            center={base}
            zoom={14}
            fitAll={helpers.length > 0}
            markers={mapMarkers}
          />
        </View>
      ) : loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : helpers.length === 0 ? (
        <View style={styles.empty}>
          <EmptyState
            icon="people-outline"
            title="No helpers nearby"
            body="No verified helpers are online within 5 km right now. Pull to refresh."
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={load} />
          }
        >
          {helpers.map((h) => (
            <View key={h.userId} style={styles.item}>
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
                </View>
              </View>
              <View style={styles.onlineDot} />
            </View>
          ))}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 24,
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  toggleWrap: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: 3,
    gap: 2,
  },
  toggleBtn: {
    width: 40,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm - 2,
  },
  toggleActive: {
    backgroundColor: colors.textPrimary,
  },
  mapWrap: {
    flex: 1,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#E3E8EE',
    ...shadows.card,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
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
