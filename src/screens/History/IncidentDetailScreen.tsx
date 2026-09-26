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
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAudioPlayer } from 'expo-audio';
import * as Sharing from 'expo-sharing';
import {
  appAlert,
  Button,
  Card,
  OSMMapView,
  SectionHeader,
  StarRating,
} from '@/components/common';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { hasSosRecording, sosRecordingUri } from '@/services/sos-recording';
import { deleteSosRecording } from '@/services/sos-audio';
import { exportIncidentReport } from '@/services/incident-report';
import type { AppStackParamList } from '@/navigation/types';

type Route = RouteProp<AppStackParamList, 'IncidentDetail'>;
type Nav = NativeStackNavigationProp<AppStackParamList>;

export function IncidentDetailScreen() {
  const route = useRoute<Route>();
  const record = useAppSelector((s) =>
    s.history.records.find((r) => r.id === route.params.recordId),
  );
  const profileName = useAppSelector((s) => s.user.profile?.name ?? null);
  const [exporting, setExporting] = useState(false);
  const navigation = useNavigation<Nav>();

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

  // One tap from an SOS to a document she can take to a police station. The
  // screen only starts it; everything the report says is built and tested in
  // incident-report-html.ts.
  const exportReport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const result = await exportIncidentReport(record, profileName);
      if (result === 'failed') {
        appAlert(
          'Could not create the report',
          'Something went wrong making the PDF. Try again, and if it keeps happening, tell us from Help.',
        );
      } else if (result === 'saved') {
        appAlert('Report created', 'Sharing is not available on this phone, so the PDF could not be opened.');
      }
    } finally {
      setExporting(false);
    }
  };

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

      <SectionHeader title="Incident report" />
      <Card style={styles.card}>
        <Text style={styles.muted}>
          A timestamped PDF of this SOS for a police complaint or an FIR: where it started,
          the location trail, recordings, who was alerted and who responded.
        </Text>
        <Pressable
          onPress={() => void exportReport()}
          disabled={exporting}
          style={({ pressed }) => [
            styles.reportBtn,
            (pressed || exporting) && { opacity: 0.85 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Export incident report as PDF"
        >
          <Ionicons name="document-text-outline" size={20} color={colors.textInverse} />
          <Text style={styles.reportText}>
            {exporting ? 'Creating PDF…' : 'Export incident report'}
          </Text>
        </Pressable>

        {/* The PDF is only half of it. Most people do not know that an FIR can
            be filed at any station, that treatment is free, or that legal aid
            costs nothing, and the hours after an incident are exactly when
            somebody tells them otherwise. */}
        <Pressable
          onPress={() => navigation.navigate('AfterAnIncident')}
          style={({ pressed }) => [
            {
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              marginTop: spacing.sm,
              paddingVertical: 12,
              borderRadius: radius.circle,
              borderWidth: 1,
              borderColor: colors.border,
            },
            pressed && { opacity: 0.85 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="What to do after an incident"
        >
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.textPrimary} />
          <Text
            style={{
              fontFamily: fontFamilies.poppinsSemiBold,
              fontSize: 14,
              color: colors.textPrimary,
            }}
          >
            What to do next: FIR, treatment, legal aid
          </Text>
        </Pressable>
      </Card>

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

// SOS audio: play it back, share it with your circle, or delete the copy we
// hold.
//
// The card used to say "Saved on this phone", which was only half true and was
// the same half the privacy policy got wrong: a copy is also uploaded to private
// storage on every real SOS, so that evidence survives a phone that was snatched
// or smashed. Saying so here is the honest version, and deleting it has to be
// possible from the same place it is described.
function RecordingCard({ sosId }: { sosId: string }) {
  const exists = useMemo(() => hasSosRecording(sosId), [sosId]);
  const uri = useMemo(() => sosRecordingUri(sosId), [sosId]);
  const player = useAudioPlayer(exists ? uri : null);
  const [playing, setPlaying] = useState(false);
  const uid = useAppSelector((s) => s.user.profile?.uid ?? null);
  const [deleted, setDeleted] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Rendered when there is a local file OR when a signed-in person could have a
  // server copy. Gating the whole card on the local file would mean somebody who
  // reinstalled the app could never delete the recording we still hold, which is
  // exactly the person most likely to want it gone.
  if (!exists && !uid) return null;

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

  const removeServerCopy = () => {
    appAlert(
      'Delete the copy we hold?',
      'This permanently deletes the recording, and the few seconds captured just before it, from our storage. It cannot be undone, and it would no longer be available as evidence.\n\nThe copy on this phone is yours and stays.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!uid) return;
            setDeleting(true);
            const ok = await deleteSosRecording(uid, sosId);
            setDeleting(false);
            if (ok) {
              setDeleted(true);
              return;
            }
            appAlert(
              "Couldn't delete it",
              'Nothing was deleted. Check your connection and try again, or email orbiisafety@gmail.com and we will do it for you.',
            );
          },
        },
      ],
    );
  };

  return (
    <>
      <SectionHeader title="Voice recording" />
      <Card style={styles.card}>
        <Text style={styles.muted}>
          {deleted
            ? 'Deleted from our storage. If a copy was saved on this phone, it is still here and still yours.'
            : 'A copy is saved on this phone, and a copy is kept in private storage only you can read, so it survives if this phone does not. We delete ours after 90 days.'}
        </Text>
        {exists ? (
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
        ) : null}
        {!deleted && uid ? (
          <Pressable
            onPress={removeServerCopy}
            disabled={deleting}
            style={({ pressed }) => [
              styles.forgetBtn,
              (pressed || deleting) && { opacity: 0.6 },
            ]}
            accessibilityRole="button"
          >
            <Ionicons name="trash-outline" size={16} color={colors.coralDeep} />
            <Text style={styles.forgetText}>
              {deleting ? 'Deleting…' : 'Delete the copy we hold'}
            </Text>
          </Pressable>
        ) : null}
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
  reportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.brandDeep,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  reportText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15,
    color: colors.textInverse,
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
  // Deliberately the quietest control on the card. Deleting evidence of an
  // emergency is a real choice and it should not sit under a filled button that
  // invites a thumb.
  forgetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.sm,
    paddingVertical: 10,
  },
  forgetText: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 13,
    color: colors.coralDeep,
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
