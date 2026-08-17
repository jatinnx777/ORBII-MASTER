import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  appAlert,
  AgeCheckSheet,
  CircleSwitcher,
  CircleSwitcherTrigger,
  GlassButton,
  MemberHistorySheet,
  OSMMapView,
  VoiceDurationSheet,
  type OSMMarker,
  type OSMPolyline,
  type OSMCircle,
} from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import { supabase } from '@/services/supabase';
import { getCurrentLocation } from '@/services/location';
import { useAppSelector } from '@/redux/store';
import { listCircleMembers } from '@/services/circles';
import { logConsentEvent, getAgeStatus } from '@/services/consent';
import {
  isCircleSharing,
  startCircleSharing,
  stopCircleSharing,
  loadCircleMembersLocations,
  loadMemberTrail,
  detectStops,
  dwellMinutes,
  formatDuration,
  sameMemberLocations,
  circleSharingExpiry,
  type MemberLocation,
  type TrailPoint,
  type Stop,
} from '@/services/circle-location';
import { haversineMeters, formatDistance } from '@/utils/geo';
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
// Marker HTML is rebuilt on every refresh and then JSON-stringified to cross
// into the WebView, which showed up as jank on a 10-second poll. The strings are
// pure functions of their inputs, so cache them.
const avatarCache = new Map<string, string>();
function avatarHtml(
  name: string | null,
  color: string,
  stale: boolean,
  photoUri: string | null,
): string {
  const key = `${name ?? ''}|${color}|${stale ? 1 : 0}|${photoUri ?? ''}`;
  const hit = avatarCache.get(key);
  if (hit) return hit;
  const built = buildAvatarHtml(name, color, stale, photoUri);
  if (avatarCache.size > 64) avatarCache.clear();
  avatarCache.set(key, built);
  return built;
}
function buildAvatarHtml(
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
// A day's breadcrumbs can run to 500 points per person. Four of those, serialised
// into the map WebView on every refresh, is what made the screen crawl. Thinning
// to ~120 points keeps the shape of the route identical at any zoom a phone can
// show, at a quarter of the cost. Endpoints are always kept.
const MAX_TRAIL_POINTS = 120;
function thinTrail(points: TrailPoint[]): TrailPoint[] {
  if (points.length <= MAX_TRAIL_POINTS) return points;
  const step = points.length / MAX_TRAIL_POINTS;
  const out: TrailPoint[] = [];
  for (let i = 0; i < MAX_TRAIL_POINTS; i++) out.push(points[Math.floor(i * step)]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
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
  // My own position, kept separate from `center` (which moves when you tap a
  // member). Needed to answer the only question people actually ask of this
  // screen: how far away is she?
  const [myLoc, setMyLoc] = useState<GeoPoint | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [durationOpen, setDurationOpen] = useState(false);
  const [ageOpen, setAgeOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pendingHours, setPendingHours] = useState(2);
  // When sharing is on with a bounded window, say when it ends. "Until 9:30 PM"
  // is the thing people actually want to know, and it is the honest counterpart
  // to a permanent notification.
  const [shareEnds, setShareEnds] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!sharing) {
      setShareEnds(null);
      return;
    }
    void circleSharingExpiry().then((ms) => {
      if (!alive) return;
      if (!ms) {
        setShareEnds(null);
        return;
      }
      const d = new Date(ms);
      setShareEnds(
        d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?([ap])m/i, (_x, p1) => ` ${String(p1).toUpperCase()}M`),
      );
    });
    return () => { alive = false; };
  }, [sharing]);

  // Slow breathing ring behind the share icon while live, so "on" reads at a
  // glance without another line of text.
  const pulseAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!sharing) {
      pulseAnim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.55, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0, duration: 1100, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [sharing, pulseAnim]);

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

  // How far this member is FROM ME. The row used to show m.accuracyM here, which
  // is the GPS error radius, not a distance, so someone 3 km away read as "100m".
  const distanceOf = useCallback(
    (m: MemberLocation): number | null =>
      myLoc ? haversineMeters(myLoc, { latitude: m.lat, longitude: m.lng }) : null,
    [myLoc],
  );

  // Pull today's breadcrumbs for everyone visible, refreshed with the map.
  useEffect(() => {
    if (shown.length === 0) { setTrails({}); return; }
    let alive = true;
    const hrs = hoursSinceMidnight();
    Promise.all(shown.map(async (m) => [m.userId, thinTrail(await loadMemberTrail(m.userId, hrs))] as const))
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
    const next = await loadCircleMembersLocations();
    setMembers((prev) => (sameMemberLocations(prev, next) ? prev : next));
  }, []);

  useEffect(() => {
    let alive = true;
    getCurrentLocation()
      .then((p) => {
        if (!alive) return;
        setCenter(p);
        setMyLoc(p);
      })
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
      // Realtime is the live path; this is only a fallback for projects where it
      // is not enabled (needs sql/70). Polling every 10s on top of realtime meant
      // the screen was doing the same work twice.
      const poll = setInterval(run, 45000);
      // A burst of row changes (four phones reporting at once) used to fire four
      // full refetches back to back. Coalesce them into one.
      let debounce: ReturnType<typeof setTimeout> | null = null;
      const runSoon = () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(run, 400);
      };
      // Realtime: refetch the instant any visible member's row changes, so the
      // map moves live instead of waiting for the next poll. The poll stays as a
      // fallback in case realtime isn't enabled on the project (needs sql/70).
      const channel = supabase
        .channel('circle-locations-live')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'circle_locations' },
          () => runSoon(),
        )
        .subscribe();
      return () => {
        alive = false;
        clearInterval(poll);
        if (debounce) clearTimeout(debounce);
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

  // Shared by the duration picker and the age sheet, so answering the age
  // question drops the user straight into sharing instead of making them start
  // the whole flow again.
  const beginSharing = async (hours: number) => {
    setBusy(true);
    try {
      const ok = await startCircleSharing(hours);
      if (!ok && (await getAgeStatus()) === 'minor') {
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

  const onPickShareDuration = async (hours: number) => {
    setDurationOpen(false);
    // Ask for a date of birth once, only if we have genuinely never been told.
    // Anyone who signed up before that field existed lands here exactly once.
    if ((await getAgeStatus()) === 'unknown') {
      setPendingHours(hours);
      setAgeOpen(true);
      return;
    }
    await beginSharing(hours);
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
  // Every recorded fix as a small dot, so the day reads as a trail of pings
  // rather than a smooth line that implies more precision than we have. Only for
  // the selected member: four people's worth at once is unreadable.
  const breadcrumbs: OSMCircle[] = useMemo(() => {
    if (!selectedId) return [];
    const pts = trails[selectedId] ?? [];
    return pts.map((pt, i) => ({
      id: `crumb-${selectedId}-${i}`,
      center: { latitude: pt.lat, longitude: pt.lng },
      radiusM: 8,
      color: colorFor(selectedId),
      fillColor: colorFor(selectedId),
      fillOpacity: 0.85,
    }));
  }, [selectedId, trails, colorFor]);

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
          circles={[...rings, ...stopRings, ...breadcrumbs]}
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
          <MemberHistorySheet
        visible={historyOpen && !!selectedMember}
        name={selectedMember?.name ?? null}
        photoUri={selectedMember?.photoUri ?? null}
        color={selectedMember ? colorFor(selectedMember.userId) : MEMBER_COLORS[0]}
        trail={selectedId ? trails[selectedId] ?? [] : []}
        onFocus={(lat, lng) => setCenter({ latitude: lat, longitude: lng })}
        onClose={() => setHistoryOpen(false)}
      />
      <CircleSwitcherTrigger
            name={selectedCircle?.name ?? 'Circle map'}
            count={shown.length}
            onPress={() => setSwitcherOpen(true)}
          />
          <GlassButton icon="refresh" onPress={() => void refresh()} />
        </View>


        <View style={{ flex: 1 }} pointerEvents="box-none" />

        {selectedMember ? (
          <Pressable
            onPress={() => setHistoryOpen(true)}
            style={({ pressed }) => [styles.trailBar, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel={`See ${selectedMember.name || 'their'} day`}
          >
            <Ionicons name="footsteps" size={15} color={colors.textInverse} />
            <Text style={styles.trailText} numberOfLines={1}>
              {(selectedMember.name || 'Member').split(' ')[0]}'s day
              {selectedStops.length > 0
                ? ` · ${selectedStops.length} place${selectedStops.length > 1 ? 's' : ''}`
                : ''}
            </Text>
            <View style={styles.trailCta}>
              <Text style={styles.trailCtaText}>See history</Text>
              <Ionicons name="chevron-forward" size={13} color={colors.textInverse} />
            </View>
          </Pressable>
        ) : null}

        {/* Bottom sheet, frosted glass. */}
        <BlurView intensity={32} tint="light" style={styles.sheet}>
          <View style={styles.handle} />
          <View style={[styles.shareRow, sharing && styles.shareRowOn]}>
            <View style={[styles.shareIcon, sharing && styles.shareIconOn]}>
              {sharing ? <Animated.View style={[styles.sharePulse, { opacity: pulseAnim }]} /> : null}
              <Ionicons
                name={sharing ? 'navigate' : 'navigate-outline'}
                size={17}
                color={sharing ? colors.textInverse : colors.brandDeep}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.shareTitle}>
                {sharing ? 'You are sharing' : 'Share my live location'}
              </Text>
              <Text style={styles.shareSub}>
                {sharing
                  ? shareEnds
                    ? `Your circle can see you until ${shareEnds}.`
                    : 'Your circle can see you until you turn this off.'
                  : 'Only your circle sees it. Today’s route clears at midnight.'}
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
                    <View style={[styles.avatarRing, { borderColor: off ? '#9a958c' : colorFor(m.userId) }]}>
                      {m.photoUri ? (
                        <Image source={{ uri: m.photoUri }} style={styles.avatarImg} />
                      ) : (
                        <View style={[styles.memberDot, { backgroundColor: off ? '#9a958c' : colorFor(m.userId) }]}>
                          <Text style={styles.memberInitial}>{(m.name || '?').slice(0, 1).toUpperCase()}</Text>
                        </View>
                      )}
                      {!off ? <View style={[styles.liveDot, { backgroundColor: f.color }]} /> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName} numberOfLines={1}>{m.name || 'Circle member'}</Text>
                      <Text style={styles.memberMeta} numberOfLines={1}>
                        {off ? `Location off · last seen ${ago(m.updatedAt)}` : ago(m.updatedAt)}
                      </Text>
                    </View>
                    <View style={styles.rightCol}>
                      {distanceOf(m) != null ? (
                        <Text style={[styles.distance, off && styles.distanceOff]}>
                          {formatDistance(distanceOf(m) as number)}
                        </Text>
                      ) : off ? (
                        <View style={styles.offPill}><Text style={styles.offPillText}>OFF</Text></View>
                      ) : null}
                      {m.battery != null ? (
                        <View style={styles.batteryRow}>
                          <Ionicons
                            name={m.battery <= 20 ? 'battery-dead' : m.battery <= 50 ? 'battery-half' : 'battery-full'}
                            size={13}
                            color={m.battery <= 20 ? colors.coralDeep : colors.textMuted}
                          />
                          <Text style={[styles.battery, m.battery <= 20 && styles.batteryLow]}>{m.battery}%</Text>
                        </View>
                      ) : null}
                    </View>
                    <Pressable
                      onPress={() => {
                        setSelectedId(m.userId);
                        setCenter({ latitude: m.lat, longitude: m.lng });
                        setHistoryOpen(true);
                      }}
                      hitSlop={8}
                      style={styles.historyBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`See ${m.name || 'their'} location history`}
                    >
                      <Ionicons name="footsteps-outline" size={17} color={colors.brandDeep} />
                    </Pressable>
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
      <CircleSwitcher
        visible={switcherOpen}
        circles={circles}
        selectedId={selectedCircleId}
        onSelect={(id) => {
          setSelectedCircleId(id);
          setSelectedId(null);
          setTrails({});
        }}
        onCreate={() => navigation.navigate('CircleCreate' as never)}
        onClose={() => setSwitcherOpen(false)}
      />
      <AgeCheckSheet
        visible={ageOpen}
        onResolved={async (status) => {
          setAgeOpen(false);
          if (status === 'minor') {
            appAlert(
              'Location sharing is 18+',
              "Indian law does not allow us to track anyone under 18, so live location stays off for your account. Voice SOS, your circle alerts and one-tap 112 all work exactly as normal.",
            );
            return;
          }
          await beginSharing(pendingHours);
        }}
        onCancel={() => setAgeOpen(false)}
      />
    </View>
  );
}

// A small frosted round control used in the top bar.

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
  shareRowOn: {},
  shareIcon: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: colors.brandSoft,
    alignItems: 'center', justifyContent: 'center',
    marginRight: spacing.sm,
  },
  shareIconOn: { backgroundColor: colors.brand },
  sharePulse: {
    position: 'absolute', left: -5, top: -5, right: -5, bottom: -5,
    borderRadius: 24, backgroundColor: colors.brand,
  },
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
  avatarRing: {
    width: 46, height: 46, borderRadius: 23, borderWidth: 2.5,
    overflow: 'visible', alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  avatarImg: { width: 39, height: 39, borderRadius: 20 },
  liveDot: {
    position: 'absolute', right: -1, bottom: -1,
    width: 12, height: 12, borderRadius: 6,
    borderWidth: 2, borderColor: colors.surface,
  },
  rightCol: { alignItems: 'flex-end', gap: 3 },
  distance: {
    fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textPrimary,
  },
  distanceOff: { color: colors.textMuted },
  batteryRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  batteryLow: { color: colors.coralDeep },
  memberDot: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  memberInitial: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: '#fff' },
  memberName: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary },
  freshRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  freshDot: { width: 7, height: 7, borderRadius: 4 },
  memberMeta: { fontFamily: fontFamilies.interMedium, fontSize: 12, color: colors.textSecondary },
  battery: { fontFamily: fontFamilies.interMedium, fontSize: 12.5, color: colors.textMuted },
  offPill: { backgroundColor: 'rgba(20,18,40,0.06)', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  offPillText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 10, color: colors.textMuted, letterSpacing: 0.6 },

  historyBtn: {
    width: 32, height: 32, borderRadius: 16, marginLeft: 2,
    backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center',
  },
  trailCta: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  trailCtaText: {
    fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12, color: colors.textInverse, opacity: 0.85,
  },
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
