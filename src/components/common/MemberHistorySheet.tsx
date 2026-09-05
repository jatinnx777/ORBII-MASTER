import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fontFamilies, radius, spacing } from '@/theme';
import { reverseGeocode } from '@/services/geocode';
import {
  buildDayTimeline,
  clockTime,
  formatDuration,
  type TimelineEntry,
  type TrailPoint,
} from '@/services/circle-location';

// A member's day, read top to bottom.
//
// This replaced a one-line summary bar ("3 stops · here 24m"), which told you a
// number and nothing you could act on. A location history is only useful if it
// names places and times: "College, 9:12 AM to 3:40 PM, 6h 28m" is the answer
// someone is actually looking for.
//
// Stops are reverse-geocoded lazily, one request per stop, cached by the geocode
// service. A stop whose name has not resolved yet still shows its time and
// duration, because those are most of the value and always available offline.

export function MemberHistorySheet({
  visible,
  name,
  photoUri,
  color,
  trail,
  loading,
  onFocus,
  onClose,
}: {
  visible: boolean;
  name: string | null;
  photoUri: string | null;
  color: string;
  trail: TrailPoint[];
  loading?: boolean;
  /** Centre the map on a place the user tapped in the timeline. */
  onFocus: (lat: number, lng: number) => void;
  onClose: () => void;
}) {
  const entries = useMemo(() => buildDayTimeline(trail), [trail]);
  const [labels, setLabels] = useState<Record<string, string>>({});

  // Name each stop. Sequential rather than parallel: the free reverse-geocoders
  // rate-limit hard, and a day rarely has more than a handful of stops.
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    (async () => {
      for (const e of entries) {
        if (e.kind !== 'stop') continue;
        const key = `${e.lat.toFixed(4)},${e.lng.toFixed(4)}`;
        if (labels[key]) continue;
        const label = await reverseGeocode(e.lat, e.lng);
        if (!alive) return;
        setLabels((prev) => (prev[key] ? prev : { ...prev, [key]: label }));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, entries]);

  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: visible ? 300 : 180,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

  const firstStop = entries.find((e) => e.kind === 'stop');
  const totalStops = entries.filter((e) => e.kind === 'stop').length;
  const totalMetres = entries.reduce((s, e) => (e.kind === 'move' ? s + e.metres : s), 0);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close history" />
      <Animated.View
        style={[
          styles.sheet,
          {
            opacity: anim,
            transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) }],
          },
        ]}
      >
        <SafeAreaView edges={['bottom']}>
          <View style={styles.grabber} />

          <View style={styles.head}>
            <View style={[styles.avatarRing, { borderColor: color }]}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.avatarImg} />
              ) : (
                <View style={[styles.avatarFallback, { backgroundColor: color }]}>
                  <Text style={styles.avatarInitial}>{(name || '?').slice(0, 1).toUpperCase()}</Text>
                </View>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.headName} numberOfLines={1}>
                {name || 'Circle member'}
              </Text>
              <Text style={styles.headMeta}>
                Today
                {totalStops > 0 ? ` · ${totalStops} place${totalStops > 1 ? 's' : ''}` : ''}
                {totalMetres > 0
                  ? ` · ${totalMetres >= 1000 ? `${(totalMetres / 1000).toFixed(1)} km` : `${totalMetres} m`}`
                  : ''}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} accessibilityLabel="Close">
              <Ionicons name="close" size={19} color={colors.textSecondary} />
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.brand} />
            </View>
          ) : entries.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="footsteps-outline" size={26} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Nothing recorded yet today</Text>
              <Text style={styles.emptyBody}>
                A place appears here once they have stayed somewhere for five minutes or more while
                sharing their location. Everything older than 7 days is erased.
              </Text>
            </View>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollInner}
              showsVerticalScrollIndicator={false}
            >
              {entries.map((e, i) =>
                e.kind === 'stop' ? (
                  <StopRow
                    key={`s-${e.from}`}
                    entry={e}
                    color={color}
                    label={labels[`${e.lat.toFixed(4)},${e.lng.toFixed(4)}`]}
                    first={e === firstStop}
                    last={i === entries.length - 1}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      onFocus(e.lat, e.lng);
                      onClose();
                    }}
                  />
                ) : (
                  <MoveRow key={`m-${e.from}`} entry={e} color={color} />
                ),
              )}
              <Text style={styles.footNote}>
                Anything older than 7 days is deleted. ORBII keeps no long-term record of where
                anyone has been.
              </Text>
            </ScrollView>
          )}
        </SafeAreaView>
      </Animated.View>
    </Modal>
  );
}

function StopRow({
  entry,
  color,
  label,
  first,
  last,
  onPress,
}: {
  entry: Extract<TimelineEntry, { kind: 'stop' }>;
  color: string;
  label?: string;
  first: boolean;
  last: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={styles.rail}>
        <View style={[styles.railLine, first && styles.railLineHidden]} />
        <View style={[styles.pin, { borderColor: color }]}>
          <View style={[styles.pinCore, { backgroundColor: color }]} />
        </View>
        <View style={[styles.railLine, last && styles.railLineHidden]} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.stopName} numberOfLines={2}>
          {label ?? 'Finding this place…'}
        </Text>
        <Text style={styles.stopTime}>
          {clockTime(entry.from)} to {clockTime(entry.to)}
        </Text>
        <View style={[styles.durationPill, { backgroundColor: `${color}1A` }]}>
          <Ionicons name="time-outline" size={12} color={color} />
          <Text style={[styles.durationText, { color }]}>{formatDuration(entry.minutes)}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

function MoveRow({
  entry,
  color,
}: {
  entry: Extract<TimelineEntry, { kind: 'move' }>;
  color: string;
}) {
  const dist =
    entry.metres >= 1000 ? `${(entry.metres / 1000).toFixed(1)} km` : `${entry.metres} m`;
  return (
    <View style={styles.moveRow}>
      <View style={styles.rail}>
        <View style={[styles.railDashed, { borderColor: color }]} />
      </View>
      <Text style={styles.moveText}>
        Travelled {dist} · {formatDuration(entry.minutes)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(23,22,28,0.38)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '82%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    shadowColor: '#2B0B45',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.14,
    shadowRadius: 28,
    elevation: 14,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.creamDeep,
    alignSelf: 'center',
    marginTop: spacing.sm,
  },

  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  avatarRing: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2.5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarFallback: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 17, color: colors.textInverse },
  headName: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 18, color: colors.textPrimary },
  headMeta: { fontFamily: fontFamilies.poppinsRegular, fontSize: 12.5, color: colors.textMuted, marginTop: 2 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: { paddingHorizontal: spacing.md },
  scrollInner: { paddingBottom: spacing.lg },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.lg },
  rowPressed: { backgroundColor: colors.cream },
  rowBody: { flex: 1, paddingVertical: spacing.sm },
  rail: { width: 26, alignItems: 'center', alignSelf: 'stretch' },
  railLine: { flex: 1, width: 2, backgroundColor: colors.creamDeep },
  railLineHidden: { backgroundColor: 'transparent' },
  pin: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2.5,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinCore: { width: 6, height: 6, borderRadius: 3 },
  stopName: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15.5, color: colors.textPrimary },
  stopTime: { fontFamily: fontFamilies.poppinsRegular, fontSize: 12.5, color: colors.textSecondary, marginTop: 2 },
  durationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    marginTop: 6,
  },
  durationText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 11.5 },

  moveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 42 },
  railDashed: {
    flex: 1,
    width: 0,
    borderLeftWidth: 2,
    borderStyle: 'dashed',
    opacity: 0.5,
    marginVertical: 2,
  },
  moveText: { fontFamily: fontFamilies.poppinsRegular, fontSize: 12.5, color: colors.textMuted },

  empty: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.xl },
  emptyTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15.5, color: colors.textPrimary },
  emptyBody: {
    fontFamily: fontFamilies.poppinsRegular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
    textAlign: 'center',
  },
  footNote: {
    fontFamily: fontFamilies.poppinsRegular,
    fontSize: 11.5,
    lineHeight: 17,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
});
