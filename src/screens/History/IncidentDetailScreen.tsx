import React, { useMemo, useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, RouteProp } from '@react-navigation/native';
import { useAudioPlayer } from 'expo-audio';
import * as Sharing from 'expo-sharing';
import {
  Button,
  Card,
  OSMMapView,
  SectionHeader,
  StarRating,
} from '@/components/common';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { hasSosRecording, sosRecordingUri } from '@/services/sos-recording';
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
        <OSMMapView
          style={StyleSheet.absoluteFill}
          center={record.location}
          zoom={16}
          interactive={false}
          markers={[
            {
              id: 'inc',
              coordinate: record.location,
              kind: 'destination',
            },
          ]}
        />
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

      <RecordingCard sosId={record.id} />

      <SectionHeader title="Who responded" />
      <Card style={styles.card}>
        {record.responders.length === 0 ? (
          <Text style={styles.muted}>No one responded.</Text>
        ) : (
          record.responders.map((h) => (
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

// On-device SOS audio: play it back, or share it with your circle. Only shown
// when a recording was captured + saved for this incident.
function RecordingCard({ sosId }: { sosId: string }) {
  const exists = useMemo(() => hasSosRecording(sosId), [sosId]);
  const uri = useMemo(() => sosRecordingUri(sosId), [sosId]);
  const player = useAudioPlayer(exists ? uri : null);
  const [playing, setPlaying] = useState(false);

  if (!exists) return null;

  const toggle = () => {
    if (playing) {
      player.pause();
      setPlaying(false);
    } else {
      try {
        player.seekTo(0);
      } catch {
        // ignore
      }
      player.play();
      setPlaying(true);
    }
  };

  const share = async () => {
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          dialogTitle: 'Share SOS recording with your circle',
          mimeType: 'audio/m4a',
        });
      }
    } catch {
      // user dismissed / share unavailable
    }
  };

  return (
    <>
      <SectionHeader title="Voice recording" />
      <Card style={styles.card}>
        <Text style={styles.muted}>
          Saved on this phone. Play it back, or share it with the people in your
          circle.
        </Text>
        <View style={styles.recRow}>
          <Pressable
            onPress={toggle}
            style={({ pressed }) => [styles.playBtn, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
          >
            <Ionicons
              name={playing ? 'pause' : 'play'}
              size={20}
              color={colors.textInverse}
            />
            <Text style={styles.playText}>{playing ? 'Pause' : 'Play recording'}</Text>
          </Pressable>
          <Pressable
            onPress={share}
            style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
          >
            <Ionicons name="share-social" size={18} color={colors.brandDeep} />
            <Text style={styles.shareText}>Share</Text>
          </Pressable>
        </View>
      </Card>
    </>
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
    height: 200,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.brandSoft,
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
  recRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  playBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.brand,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
  },
  playText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14,
    color: colors.textInverse,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.brandSoft,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  shareText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14,
    color: colors.brandDeep,
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
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.brandMid,
  },
  helperInitial: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: colors.brandDeep,
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
