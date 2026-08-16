import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { appAlert, OSMMapView, VoiceDurationSheet, type OSMMarker, type OSMPolyline, type OSMCircle } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import { supabase } from '@/services/supabase';
import { getCurrentLocation } from '@/services/location';
import { useAppSelector } from '@/redux/store';
import { listCircleMembers } from '@/services/circles';
import { logConsentEvent, isDeclaredAdult } from '@/services/consent';
import {
  isCircleSharing,
  startCircleSharing,
  stopCircleSharing,
  loadCircleMembersLocations,
  loadMemberTrail,
  detectStops,
  dwellMinutes,
  formatDuration,
  type MemberLocation,
  type TrailPoint,
  type Stop,
} from '@/services/circle-location';
import type { GeoPoint } from '@/types';
import { escapeHtml } from '@/utils/html';

// A circle holds at most four people, so each one gets a fixed, permanent
// colour by their position in the circle. Same person, same colour, every
// session: that is what makes four overlapping trails readable at a glance.
const MEMBER_COLORS = ['#6C5CE7', '#00B894', '#E8804A', '#D6467F'] as const;
/** Stable colour for a member, by their index in the circle's sorted roster. */
function colorAt(index: number): string {
  return MEMBER_COLORS[index % MEMBER_COLORS.length];
}
function avatarHtml(
  name: string | null,
  color: string,
  stale: boolean,
  photoUri: string | null,
): string {
  // Escaped defensively: this string is rendered as raw HTML inside the map
  // WebView, so any user-controlled character must be neutralised.
  const initial = escapeHtml((name || '?').slice(0, 1).toUpperCase());
  const op = stale ? '0.6' : '1';
  const inner = photoUri
    ? `<img src="${escapeHtml(photoUri)}" style="width:100%;height:100%;object-fit:cover;display:block" />`
    : `<div style="width:100%;height:100%;background:${color};display:flex;align-items:center;justify-content:center;color:#fff;font-family:sans-serif;font-weight:700;font-size:17px">${initial}</div>`;
  // Coloured ring + white gap + soft drop shadow, the Life360 read, but with a
  // glass highlight so it sits on our own design language rather than theirs.
  return `<div style="opacity:${op};position:relative;width:46px;height:46px">
    <div style="position:absolute;inset:0;border-radius:50%;background:${stale ? '#9a958c' : color};box-shadow:0 6px 18px rgba(20,18,40,0.30)"></div>
    <div style="position:absolute;inset:3px;border-radius:50%;overflow:hidden;background:#fff;border:2px solid #fff">${inner}</div>
    <div style="position:absolute;inset:0;border-radius:50%;background:linear-gradient(160deg,rgba(255,255,255,0.45),rgba(255,255,255,0) 55%);pointer-events:none"></div>
  </div>`;
}
/** Hours elapsed since local midnight, so history always means "today". */
function hoursSinceMidnight(): number {
  const now = new Date();
  const mid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0.25, (now.getTime() - mid.getTime()) / 3_600_000);
}
function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
// Freshness: how recent is this fix?
function freshness(iso: string): { color: string; stale: boolean } {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 120) return { color: colors.sageDeep, stale: false };
  if (s < 600) return { color: colors.goldDeep, stale: false };
  return { color: colors.textMuted, stale: true };
}

export function CircleMapScreen() {
  const navigation = useNavigation();
  const circles = useAppSelector((s) => s.circles.circles);
  const activeCircleId = useAppSelector((s) => s.circles.activeCircleId);

  const [members, setMembers] = useState<MemberLocation[]>([]);
  const [sharing, setSharing] = useState(false);
  const [center, setCenter] = useState<GeoPoint | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [durationOpen, setDurationOpen] = useState(false);
  // Modern animated toggle (replaces the default Switch).
  const toggleAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(toggleAnim, {
      toValue: sharing ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [sharing, toggleAnim]);
  // Which circle's members we're viewing, and that circle's member ids.
  const [selectedCircleId, setSelectedCircleId] = useState<string | null>(null);
  const [memberIds, setMemberIds] = useState<Set<string> | null>(null);
  // Today's history for every member of the circle, keyed by user id. All four
  // are drawn at once, each in that member's own colour.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trails, setTrails] = useState<Record<string, TrailPoint[]>>({});

  // Default the selection to the active circle (or the first one).
  useEffect(() => {
    if (selectedCircleId || circles.length === 0) return;
    setSelectedCircleId(activeCircleId ?? circles[0].id);
  }, [circles, activeCircleId, selectedCircleId]);

  // Load the selected circle's member ids so we can filter the shared locations
  // down to just that circle, rather than everyone the user shares any circle with.
  useEffect(() => {
    if (!selectedCircleId) {
      setMemberIds(null);
      return;
    }
    let alive = true;
    setMemberIds(null);
    listCircleMembers(selectedCircleId)
      .then((ms) => alive && setMemberIds(new Set(ms.map((m) => m.userId))))
      .catch(() => alive && setMemberIds(new Set()));
    return () => {
      alive = false;
    };
  }, [selectedCircleId]);

  // Only the selected circle's members (the RPC already excludes yourself).
  const shown = useMemo(
    () => (memberIds ? members.filter((m) => memberIds.has(m.userId)) : []),
    [members, memberIds],
  );

  const selectedCircle = circles.find((c) => c.id === selectedCircleId) ?? null;

  // Fixed colour per member for this circle. Sorted by user id so the mapping is
  // identical on every device and every launch.
  const colorByUser = useMemo(() => {
    const map: Record<string, string> = {};
    [...shown].sort((a, b) => a.userId.localeCompare(b.userId))
      .forEach((m, i) => { map[m.userId] = colorAt(i); });
    return map;
  }, [shown]);
  const colorFor = useCallback((id: string) => colorByUser[id] ?? MEMBER_COLORS[0], [colorByUser]);

  // Pull today's breadcrumbs for everyone visible, refreshed with the map.
  useEffect(() => {
    if (shown.length === 0) { setTrails({}); return; }
    let alive = true;
    const hrs = hoursSinceMidnight();
    Promise.all(shown.map(async (m) => [m.userId, await loadMemberTrail(m.userId, hrs)] as const))
      .then((pairs) => { if (alive) setTrails(Object.fromEntries(pairs)); })
      .catch(() => undefined);
    return () => { alive = false; };
    // Re-run when the roster changes, not on every position tick.
  }, [shown.map((m) => m.userId).join(',')]);

  const selectMember = (m: MemberLocation) => {
    if (selectedId === m.userId) {
      setSelectedId(null);
      return;
    }
    setSelectedId(m.userId);
    setCenter({ latitude: m.lat, longitude: m.lng });
  };

  const refresh = useCallback(async () => {
    setMembers(await loadCircleMembersLocations());
  }, []);

  useEffect(() => {
    let alive = true;
    getCurrentLocation()
      .then((p) => alive && setCenter(p))
      .catch(() => alive && setCenter({ latitude: 22.9734, longitude: 78.6569 }));
    isCircleSharing().then((s) => alive && setSharing(s));
    return () => {
      alive = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const run = () => {
        if (alive) void refresh().finally(() => alive && setLoading(false));
      };
      run();
      const poll = setInterval(run, 10000);
      // Realtime: refetch the instant any visible member's row changes, so the
      // map moves live instead of waiting for the next poll. The poll stays as a
      // fallback in case realtime isn't enabled on the project (needs sql/70).
      const channel = supabase
        .channel('circle-locations-live')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'circle_locations' },
          () => run(),
        )
        .subscribe();
      return () => {
        alive = false;
        clearInterval(poll);
        supabase.removeChannel(channel);
      };
    }, [refresh]),
  );

  const toggleShare = async (next: boolean) => {
    if (busy) return;
    if (next) {
      setDurationOpen(true); // turning ON always picks a duration first
      return;
    }
    setBusy(true);
    try {
      await stopCircleSharing();
      void logConsentEvent('location_share', false, { method: 'toggle' });
      setSharing(false);
    } finally {
      setBusy(false);
    }
  };

  const onPickShareDuration = async (hours: number) => {
    setDurationOpen(false);
    setBusy(true);
    try {
      const ok = await startCircleSharing(hours);
      if (!ok && !(await isDeclaredAdult())) {
        appAlert(
          'Location sharing is 18+',
          "Indian law does not allow us to track anyone under 18, so live location stays off for your account. Voice SOS, your circle alerts and one-tap 112 all work exactly as normal.",
        );
      }
      if (ok) {
        void logConsentEvent('location_share', true, { method: 'toggle' });
        void logConsentEvent('location_history', true, { method: 'toggle' });
      }
      setSharing(ok);
    } finally {
      setBusy(false);
    }
  };

  const markers: OSMMarker[] = shown.map((m) => ({
    id: m.userId,
    coordinate: { latitude: m.lat, longitude: m.lng },
    // A member who turned sharing off shows greyed at their LAST known spot.
    html: avatarHtml(m.name, colorFor(m.userId), !m.sharing || freshness(m.updatedAt).stale, m.photoUri),
  }));
  // Accuracy rings, "precise to ~Xm". Only for people actually sharing now.
  const rings: OSMCircle[] = shown
    .filter((m) => m.sharing && m.accuracyM != null)
    .map((m) => ({
      id: `acc-${m.userId}`,
      center: { latitude: m.lat, longitude: m.lng },
      radiusM: Math.max(15, Math.min(300, m.accuracyM as number)),
      color: colorFor(m.userId),
      fillColor: colorFor(m.userId),
      fillOpacity: 0.1,
    }));
  // Today's paths, one per member, each in that member's colour. When someone is
  // selected the others dim back so a single day reads clearly.
  const trailLines: OSMPolyline[] = shown
    .map((m) => {
      const pts = trails[m.userId] ?? [];
      if (pts.length < 2) return null;
      return {
        id: `trail-${m.userId}`,
        coordinates: pts.map((t) => ({ latitude: t.lat, longitude: t.lng })),
        color: colorFor(m.userId),
        width: selectedId === m.userId ? 5 : 3,
      } as OSMPolyline;
    })
    .filter((x): x is OSMPolyline => x !== null);

  const selectedMember = shown.find((m) => m.userId === selectedId) ?? null;

  // Where the selected member actually stopped, and for how long. A raw trail is
  // hundreds of jittering dots; these are the handful of places that mean
  // something. Rendered as sized rings, bigger the longer she stayed.
  // Where each member actually stopped today, sized by how long they stayed.
  const stopRings: OSMCircle[] = useMemo(
    () =>
      shown.flatMap((m) => {
        if (selectedId && selectedId !== m.userId) return [];
        return detectStops(trails[m.userId] ?? []).map((st, i) => ({
          id: `stop-${m.userId}-${i}`,
          center: { latitude: st.lat, longitude: st.lng },
          radiusM: Math.max(35, Math.min(140, 30 + st.minutes * 1.2)),
          color: colorFor(m.userId),
          fillColor: colorFor(m.userId),
          fillOpacity: 0.18,
        }));
      }),
    [shown, trails, selectedId, colorFor],
  );
  const selectedStops: Stop[] = useMemo(
    () => (selectedId ? detectStops(trails[selectedId] ?? []) : []),
    [selectedId, trails],
  );
  // How long the selected member has been sitting where they are right now.
  const dwell = useMemo(
    () => (selectedId ? dwellMinutes(trails[selectedId] ?? []) : null),
    [selectedId, trails],
  );

  return (
    <View style={styles.root}>
      {center ? (
        <OSMMapView
          style={StyleSheet.absoluteFill}
          center={center}
          zoom={13}
          markers={markers}
          circles={[...rings, ...stopRings]}
          polylines={trailLines}
          fitAll={markers.length > 0}
        />
      ) : (
        <View style={styles.skeleton}><ActivityIndicator color={colors.brandDeep} /></View>
      )}

      <SafeAreaView style={StyleSheet.absoluteFill} edges={['top', 'bottom']} pointerEvents="box-none">
        {/* Top bar, floating glass controls. */}
        <View style={styles.topBar} pointerEvents="box-none">
          <GlassButton icon="chevron-back" onPress={() => navigation.goBack()} />
          <View style={styles.titlePill}>
            <Ionicons name="people" size={13} color={colors.textPrimary} />
            <Text style={styles.titleText}>Circle map</Text>
          </View>
          <GlassButton icon="refresh" onPress={() => void refresh()} />
        </View>

        {/* Circle selector, pick whose circle you're looking at. */}
        {circles.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
            style={styles.chipsScroll}
          >
            {circles.map((c) => {
              const on = c.id === selectedCircleId;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => { setSelectedCircleId(c.id); setSelectedId(null); setTrails({}); }}
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Show ${c.name}`}
                >
                  <Text style={styles.chipEmoji}>{c.emoji || '👥'}</Text>
                  <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{c.name}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        <View style={{ flex: 1 }} pointerEvents="box-none" />

        {selectedMember ? (
          <View style={styles.trailBar}>
            <Ionicons name="time" size={14} color={colors.textInverse} />
            <Text style={styles.trailText} numberOfLines={1}>
              {selectedMember.name || 'Member'} · today ·{' '}
              {selectedStops.length > 0
                ? `${selectedStops.length} stop${selectedStops.length > 1 ? 's' : ''}`
                : `${(trails[selectedMember.userId] ?? []).length} points`}
              {dwell != null ? ` · here ${formatDuration(dwell)}` : ''}
            </Text>
            <Pressable onPress={() => setSelectedId(null)} hitSlop={8}>
              <Ionicons name="close" size={16} color={colors.textInverse} />
            </Pressable>
          </View>
        ) : null}

        {/* Bottom sheet, frosted glass. */}
        <BlurView intensity={32} tint="light" style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.shareRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.shareTitle}>Share my live location</Text>
              <Text style={styles.shareSub}>
                {sharing ? 'Your circle can see you. Turn off any time.' : 'Only your circle can see it, when it’s on.'}
              </Text>
            </View>
            <Pressable
              onPress={() => !busy && toggleShare(!sharing)}
              disabled={busy}
              accessibilityRole="switch"
              accessibilityState={{ checked: sharing }}
              hitSlop={8}
            >
              <Animated.View
                style={[
                  styles.toggleTrack,
                  { backgroundColor: toggleAnim.interpolate({ inputRange: [0, 1], outputRange: [colors.border, colors.brand] }) },
                ]}
              >
                <Animated.View
                  style={[
                    styles.toggleThumb,
                    { transform: [{ translateX: toggleAnim.interpolate({ inputRange: [0, 1], outputRange: [2, 24] }) }] },
                  ]}
                />
              </Animated.View>
            </Pressable>
          </View>

          <View style={styles.listHead}>
            <Text style={styles.sectionLabel}>
              {selectedCircle ? selectedCircle.name.toUpperCase() : 'CIRCLE'}
            </Text>
            <Text style={styles.countPill}>{shown.length}</Text>
          </View>

          {loading || memberIds === null ? (
            <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.md }} />
          ) : shown.length === 0 ? (
            <Text style={styles.empty}>
              No one in {selectedCircle ? selectedCircle.name : 'this circle'} is sharing right now. Ask them to open the Circle map and turn on live location.
            </Text>
          ) : (
            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
              {shown.map((m, i) => {
                const f = freshness(m.updatedAt);
                const sel = selectedId === m.userId;
                const off = !m.sharing;
                return (
                  <Pressable
                    key={m.userId}
                    onPress={() => void selectMember(m)}
                    style={[styles.memberRow, i > 0 && styles.memberDivider, sel && styles.memberRowOn]}
                  >
                    <View style={[styles.memberDot, { backgroundColor: off ? '#9a958c' : colorFor(m.userId) }]}>
                      <Text style={styles.memberInitial}>{(m.name || '?').slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName} numberOfLines={1}>{m.name || 'Circle member'}</Text>
                      <View style={styles.freshRow}>
                        {off ? (
                          <Ionicons name="location-outline" size={12} color={colors.textMuted} />
                        ) : (
                          <View style={[styles.freshDot, { backgroundColor: f.color }]} />
                        )}
                        <Text style={styles.memberMeta} numberOfLines={1}>
                          {off
                            ? `Location off · last seen ${ago(m.updatedAt)}`
                            : `${ago(m.updatedAt)}${m.accuracyM != null ? ` · ~${Math.round(m.accuracyM)}m` : ''}`}
                        </Text>
                      </View>
                    </View>
                    {off ? (
                      <View style={styles.offPill}><Text style={styles.offPillText}>OFF</Text></View>
                    ) : m.battery != null ? (
                      <Text style={styles.battery}>{m.battery}%</Text>
                    ) : null}
                    <Ionicons name={sel ? 'time' : 'time-outline'} size={18} color={sel ? colors.brandDeep : colors.textMuted} />
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </BlurView>
      </SafeAreaView>
      <VoiceDurationSheet
        visible={durationOpen}
        icon="location"
        allowAlways
        title="How long should your circle see you?"
        subtitle="Pick a window and it turns off on its own, or leave it always on. Your phone shows a permanent notice whenever your circle can see you."
        onConfirm={onPickShareDuration}
        onCancel={() => setDurationOpen(false)}
      />
    </View>
  );
}

// A small frosted round control used in the top bar.
function GlassButton({ icon, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
      <BlurView intensity={30} tint="light" style={styles.glassBtn}>
        <Ionicons name={icon} size={20} color={colors.textPrimary} />
      </BlurView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceMuted },
  skeleton: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    gap: spacing.sm,
  },
  glassBtn: {
    width: 44, height: 44, borderRadius: 22,
    overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(255,255,255,0.35)',
    ...shadows.card,
  },
  titlePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 9,
    ...shadows.icon,
  },
  titleText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13, color: colors.textPrimary, letterSpacing: 0.2 },

  chipsScroll: { flexGrow: 0, marginTop: spacing.sm },
  chipsRow: { paddingHorizontal: spacing.md, gap: 8, alignItems: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 13, paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)',
    maxWidth: 190,
    ...shadows.icon,
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipEmoji: { fontSize: 13 },
  chipText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.textPrimary },
  chipTextOn: { color: colors.textInverse },

  sheet: {
    overflow: 'hidden',
    borderTopLeftRadius: 30, borderTopRightRadius: 30,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)',
    backgroundColor: 'rgba(255,255,255,0.62)',
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(20,18,40,0.14)', alignSelf: 'center', marginBottom: spacing.xs },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: 'rgba(20,18,40,0.06)' },
  shareTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15.5, color: colors.textPrimary },
  shareSub: { fontFamily: fontFamilies.interMedium, fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  toggleTrack: { width: 50, height: 28, borderRadius: 14, justifyContent: 'center' },
  toggleThumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 2, elevation: 2 },

  listHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.xs },
  sectionLabel: { fontFamily: fontFamilies.poppinsBold, fontSize: 11, letterSpacing: 1, color: colors.textMuted },
  countPill: {
    fontFamily: fontFamilies.poppinsBold, fontSize: 11, color: colors.brandDeep,
    backgroundColor: colors.brandSoft, overflow: 'hidden',
    minWidth: 20, textAlign: 'center', borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 1,
  },
  empty: { fontFamily: fontFamilies.interMedium, fontSize: 13, color: colors.textMuted, lineHeight: 19, paddingVertical: spacing.sm },
  list: { maxHeight: 244 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 11, paddingHorizontal: spacing.xs, borderRadius: radius.md },
  memberDivider: { borderTopWidth: 1, borderTopColor: 'rgba(20,18,40,0.05)' },
  memberRowOn: { backgroundColor: 'rgba(134,114,206,0.10)' },
  memberDot: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  memberInitial: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: '#fff' },
  memberName: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary },
  freshRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  freshDot: { width: 7, height: 7, borderRadius: 4 },
  memberMeta: { fontFamily: fontFamilies.interMedium, fontSize: 12, color: colors.textSecondary },
  battery: { fontFamily: fontFamilies.interMedium, fontSize: 12.5, color: colors.textMuted },
  offPill: { backgroundColor: 'rgba(20,18,40,0.06)', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  offPillText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 10, color: colors.textMuted, letterSpacing: 0.6 },

  trailBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'center',
    marginBottom: spacing.sm,
    backgroundColor: 'rgba(20,18,40,0.86)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    maxWidth: '92%',
  },
  trailText: { flexShrink: 1, fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.textInverse },
});
