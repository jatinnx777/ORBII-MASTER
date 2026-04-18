import React from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, RouteProp } from '@react-navigation/native';
import {
  Button,
  Card,
  SectionHeader,
  StarRating,
} from '@/components/common';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import type { AppStackParamList } from '@/navigation/types';

type Route = RouteProp<AppStackParamList, 'IncidentDetail'>;

export function IncidentDetailScreen() {
  const route = useRoute<Route>();
  const record = useAppSelector((s) =>
    s.history.records.find((r) => r.id === route.params.recordId),
  );

  if (!record) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>Incident not found.</Text>
      </View>
    );
  }

  const statusText = {
    active: 'Active',
    resolved: 'Resolved',
    cancelled: 'Cancelled',
  }[record.status];

  const statusColor = {
    active: colors.primary,
    resolved: colors.success,
    cancelled: colors.textMuted,
  }[record.status];

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={[styles.banner, { backgroundColor: statusColor }]}>
        <Ionicons
          name={
            record.status === 'resolved'
              ? 'checkmark-circle'
              : record.status === 'cancelled'
              ? 'close-circle'
              : 'alert-circle'
          }
          size={28}
          color={colors.textInverse}
        />
        <View>
          <Text style={styles.bannerLabel}>{statusText}</Text>
          <Text style={styles.bannerWhen}>
            {new Date(record.timestamp).toLocaleString('en-IN')}
          </Text>
        </View>
      </View>

      <View style={styles.mapWrap}>
        <MapView
          provider={PROVIDER_DEFAULT}
          style={StyleSheet.absoluteFill}
          initialRegion={{
            latitude: record.location.latitude,
            longitude: record.location.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
          pointerEvents="none"
        >
          <Marker coordinate={record.location} />
        </MapView>
      </View>

      <SectionHeader title="Location" />
      <Card style={styles.card}>
        <Text style={styles.addr}>
          {record.location.address ?? 'Address unavailable'}
        </Text>
        <Text style={styles.coord}>
          {record.location.latitude.toFixed(5)},{' '}
          {record.location.longitude.toFixed(5)}
        </Text>
        <Button
          label="Open in maps"
          variant="outline"
          onPress={() =>
            Linking.openURL(
              `https://maps.google.com/?q=${record.location.latitude},${record.location.longitude}`,
            )
          }
        />
      </Card>

      <SectionHeader title="Helpers responded" />
      <Card style={styles.card}>
        {record.helpers.length === 0 ? (
          <Text style={styles.muted}>No helpers responded.</Text>
        ) : (
          record.helpers.map((h) => (
            <View key={h.id} style={styles.helperRow}>
              <View style={styles.helperAvatar}>
                <Text style={styles.helperInitial}>
                  {h.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.helperName}>
                  {h.name}
                  {record.responder?.id === h.id ? ' · Responder' : ''}
                </Text>
                <StarRating value={h.rating} size={12} />
              </View>
            </View>
          ))
        )}
      </Card>

      {record.rating != null ? (
        <>
          <SectionHeader title="Your rating" />
          <Card style={styles.card}>
            <StarRating value={record.rating} size={24} />
          </Card>
        </>
      ) : null}

      {record.responseTime != null ? (
        <>
          <SectionHeader title="Response time" />
          <Card style={styles.card}>
            <Text style={styles.bigStat}>
              {Math.floor(record.responseTime / 60)}m{' '}
              {record.responseTime % 60}s
            </Text>
            <Text style={styles.muted}>
              Time from SOS press to resolution.
            </Text>
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: spacing.xxl,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  bannerLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 20,
    color: colors.textInverse,
  },
  bannerWhen: {
    ...typography.caption,
    color: colors.textInverse,
    opacity: 0.9,
  },
  mapWrap: {
    height: 180,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: '#E3E8EE',
  },
  card: {
    marginHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  addr: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
  },
  coord: {
    ...typography.caption,
    color: colors.textMuted,
  },
  muted: {
    ...typography.caption,
    color: colors.textMuted,
  },
  helperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  helperAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#1976D2',
  },
  helperInitial: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: '#1976D2',
  },
  helperName: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
  },
  bigStat: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 28,
    color: colors.textPrimary,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  missingText: {
    ...typography.h3,
    color: colors.textPrimary,
  },
});
