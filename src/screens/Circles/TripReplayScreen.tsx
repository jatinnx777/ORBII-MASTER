import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DriveReplay, type DriveReplayHandle } from '@/components/replay/DriveReplay';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { colors, fontFamilies, radius, spacing } from '@/theme';
import {
  formatDistance,
  formatDuration,
  loadTrip,
  type DriveEvent,
  type DriveTrip,
} from '@/services/replay';

/**
 * Replaying a circle member's day on the map.
 *
 * WHAT THIS IS NOT. It is not a driving score. ORBII writes a location fix
 * every 60 seconds or 40 metres, which is enough to draw where somebody went
 * and roughly how fast, and nowhere near enough to see a brake pedal. Every
 * telemetry number on this screen is derived from that trail and says so, and
 * the events it can honestly detect are two: a fast stretch and a long stop.
 * See replay.ts for what was refused and why.
 *
 * WHY IT EXISTS AT ALL. A live dot tells you where somebody is. It does not
 * tell you whether they are okay. "Near the metro" is a walk home or it is
 * forty minutes of not moving at 11pm, and a dot cannot tell those apart. The
 * replay can.
 */


/** Real time per replay tick. 16ms would burn battery to move a dot 3 metres. */

export function TripReplayScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { userId, name } = (route.params ?? {}) as { userId: string; name?: string };

  const [trip, setTrip] = useState<DriveTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Mirrors DriveReplay's playhead, fed by its onSeek, so the clock under the
  // controls stays in step. The component owns the value; this is a copy for
  // display, which is why nothing here writes to it except that callback.
  const [t, setT] = useState(0);
  const replayRef = useRef<DriveReplayHandle>(null);



  // Pausing and flying the camera are both inside seekTo now, because both are
  // properties of moving the playhead rather than of tapping a chip.
  const jumpTo = useCallback((e: DriveEvent) => {
    Haptics.selectionAsync().catch(() => undefined);
    replayRef.current?.seekTo(e.at);
  }, []);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.brandDeep} />
      </View>
    );
  }

  if (failed || !trip) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <Header name={name} onBack={() => navigation.goBack()} />
        <View style={s.center}>
          <Ionicons name="map-outline" size={34} color={colors.textMuted} />
          <Text style={s.emptyTitle}>Nothing to replay</Text>
          <Text style={s.emptyText}>
            {name ?? 'They'} has not shared location today, or there are too few points to draw
            a route. Trails older than 7 days are deleted.
          </Text>
        </View>
      </SafeAreaView>
    );
  }


  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <Header name={name} onBack={() => navigation.goBack()} />

      {/*
        The map, the moving marker and the transport controls all live in
        DriveReplay now. This screen keeps what is actually its own job:
        loading the trip, the header, the totals, and the event chips.

        The playhead is NOT lifted into this screen. It changes on every
        animation frame, and owning it here would re-render the totals and
        the chip list sixty times a second to move one marker. A chip tap
        reaches in through the ref instead.
      */}
      <DriveReplay ref={replayRef} trip={trip} onSeek={setT} style={s.replay} />

      <View style={s.sheet}>

        <Text style={s.clock}>
          {clock(t)} <Text style={s.clockDim}>of {clock(trip.endedAt)}</Text>
        </Text>

        <View style={s.summary}>
          <Stat label="Distance" value={formatDistance(trip.distanceM)} />
          <Stat label="Duration" value={formatDuration(trip.durationMs)} />
          <Stat
            label="Average"
            value={trip.averageKmh === null ? '--' : `${Math.round(trip.averageKmh)} km/h`}
          />
          <Stat
            label="Fastest"
            value={trip.topSpeedKmh === null ? '--' : `${Math.round(trip.topSpeedKmh)} km/h`}
          />
        </View>

        {trip.events.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.chips}
          >
            {trip.events.map((e) => (
              <Pressable key={e.id} onPress={() => jumpTo(e)} style={s.chip}>
                <View
                  style={[
                    s.chipDot,
                    {
                      backgroundColor:
                        e.kind === 'high_speed' ? colors.coralDeep : colors.goldDeep,
                    },
                  ]}
                />
                <View>
                  <Text style={s.chipTitle}>{e.label}</Text>
                  <Text style={s.chipDetail}>{e.detail}</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <Text style={s.noEvents}>
            Nothing unusual on this route. ORBII only marks what a one minute location sample can
            actually show: a fast stretch, or a long stop.
          </Text>
        )}
      </View>
    </SafeAreaView>
  );

}

function Header({ name, onBack }: { name?: string; onBack: () => void }) {
  return (
    <View style={s.header}>
      <Pressable onPress={onBack} hitSlop={12} style={s.back}>
        <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
      </Pressable>
      <View>
        <Text style={s.headerTitle}>{name ? `${name}'s day` : 'Replay'}</Text>
        <Text style={s.headerSub}>Last 7 days</Text>
      </View>
      <View style={{ width: 40 }} />
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}



const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  replay: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.cream,
  },
  emptyTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 17,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  emptyText: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 300,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 17,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  headerSub: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 11.5,
    color: colors.textMuted,
    textAlign: 'center',
  },



  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },

  trackBg: { height: 4, borderRadius: 2, backgroundColor: colors.creamDeep },
  tick: { position: 'absolute', width: 3, height: 12, borderRadius: 2, marginLeft: -1.5 },
  knob: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    marginLeft: -8,
    backgroundColor: colors.surface,
    borderWidth: 3,
    borderColor: colors.brandDeep,
  },

  clock: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  clockDim: { fontFamily: fontFamilies.interRegular, color: colors.textMuted },

  summary: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', flex: 1 },
  statValue: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  statLabel: { fontFamily: fontFamilies.interRegular, fontSize: 11.5, color: colors.textMuted },

  chips: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cream,
  },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13.5, color: colors.textPrimary },
  chipDetail: { fontFamily: fontFamilies.interRegular, fontSize: 11.5, color: colors.textSecondary },

  noEvents: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textMuted,
  },
});
