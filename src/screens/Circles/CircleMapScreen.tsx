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
  useBrandSheet,
  MemberHistorySheet,
  OSMMapView,
  SyncBar,
  VoiceDurationSheet,
  type OSMMarker,
  type OSMPolyline,
  type OSMCircle,
} from '@/components/common';
import { MemberCard } from '@/components/circles/MemberCard';
import { useGlide } from '@/hooks/useGlide';
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
  cachedMemberLocations,
  loadCircleTrails,
  refreshMemberLocations,
  detectStops,
  dwellMinutes,
  formatDuration,
  sameMemberLocations,
  circleSharingExpiry,
  type MemberLocation,
  type TrailPoint,
  type Stop,
} from '@/services/circle-location';
import { haversineMeters, formatDistance, INDIA_CENTER } from '@/utils/geo';
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

/**
 * How far back to ask for a trail.
 *
 * This used to compute hours since local midnight, because the server wiped
 * everything at midnight and asking for more was pointless. Retention is now 7
 * days (sql/115), so the clamp had to go with it: leaving it would have meant
 * the map quietly asking for a day while the server was willing to give a week,
 * and the feature would have looked unchanged.
 *
 * The server caps this at the retention window anyway, so this number can never
 * outlive the promise even if it drifts.
 */
const TRAIL_HOURS = 7 * 24;

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
  // Background refresh of the roster. Not a loading state: the map and the
  // member list stay exactly where they are while this is true.
  const revalidating = useAppSelector((s) => s.circles.revalidating);

  const sheet = useBrandSheet();
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

  // Pull the last week of breadcrumbs for everyone visible, refreshed with
  // the map. The server caps this at the retention window regardless.
  useEffect(() => {
    if (shown.length === 0) { setTrails({}); return; }
    let alive = true;
    // ONE request for everybody, thinned server-side (sql/126). This was a
    // Promise.all of one query per member: four members meant four round trips
    // returning up to 2000 rows, which were then thinned to ~480 here on the
    // main thread after paying to transfer all 2000.
    //
    // It is also deliberately not awaited by anything that draws. Trails are
    // decoration; the pins are the content, and the pins must never wait on
    // them.
    void loadCircleTrails(shown.map((m) => m.userId), TRAIL_HOURS)
      .then((byUser) => { if (alive) setTrails(byUser); })
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
    const next = await refreshMemberLocations();
    setMembers((prev) => (sameMemberLocations(prev, next) ? prev : next));
  }, []);

  // Frame one, off the device, before any network call. Every row carries its
  // own age and an `unreachable` flag, so a restored pin says how old it is
  // rather than posing as live. Skipped if the network already won the race,
  // which on a good connection it sometimes does.
  useEffect(() => {
    let alive = true;
    void cachedMemberLocations().then((cached) => {
      if (!alive || cached.length === 0) return;
      setMembers((prev) => (prev.length > 0 ? prev : cached));
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    getCurrentLocation()
      .then((p) => {
        if (!alive) return;
        setCenter(p);
        setMyLoc(p);
      })
      .catch(() => alive && setCenter(INDIA_CENTER));
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
    // Confirm, and say plainly what happens next. The circle is told either
    // way; hiding that from the person turning it off would make ORBII report
    // on people behind their backs, which is the opposite of the point.
    sheet.confirm({
      title: 'Turn off location sharing?',
      body: "Your circle will be told that you turned it off, along with the time and the last place you were seen. They will not see where you go after that.",
      confirmLabel: 'Turn it off',
      icon: 'location-outline',
      onConfirm: async () => {
        setBusy(true);
        try {
          await stopCircleSharing();
          void logConsentEvent('location_share', false, { method: 'toggle' });
          setSharing(false);
        } finally {
          setBusy(false);
        }
      },
    });
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

  // Members glide to a new fix instead of teleporting to it. Fixes land every
  // 60 seconds, so without this somebody vanishes and reappears 400 metres
  // away, which is most of what makes this map feel less alive than Life360's.
  // The map itself was never the problem: it is already native MapLibre on GPU
  // vector tiles. Nothing sat between the data and the marker.
  const glided = useGlide(shown.map((m) => ({ id: m.userId, lat: m.lat, lng: m.lng })));

  const markers: OSMMarker[] = shown.map((m) => ({
    id: m.userId,
    coordinate: {
      latitude: glided[m.userId]?.lat ?? m.lat,
      longitude: glided[m.userId]?.lng ?? m.lng,
    },
    // A member who turned sharing off shows greyed at their LAST known spot.
    html: avatarHtml(m.name, colorFor(m.userId), !m.emergency && (!m.sharing || freshness(m.updatedAt).stale), m.photoUri),
  }));
  // Accuracy rings, and bubbles, which are the same shape meaning two very
  // different things.
  //
  // An accuracy ring says "the GPS is confident to about this much" and is
  // clamped to 300m, because a 900m accuracy reading is a bad fix and drawing
  // it at full size would swamp the map with a circle nobody can act on.
  //
  // A BUBBLE MUST NOT BE CLAMPED. When precisionM is set, the position is the
  // centre of a cell of that size and the circle IS the information: she chose
  // to be locatable to a neighbourhood and nothing narrower. Clamping a 2000m
  // bubble to 300m would draw a small tight circle around a point she is
  // probably not standing at, which claims precision the data does not have
  // and is exactly the lie the feature exists to prevent.
  const rings: OSMCircle[] = shown
    .filter((m) => m.sharing && (m.precisionM != null || m.accuracyM != null))
    .map((m) => {
      const bubbled = m.precisionM != null;
      return {
        id: `acc-${m.userId}`,
        center: {
          latitude: glided[m.userId]?.lat ?? m.lat,
          longitude: glided[m.userId]?.lng ?? m.lng,
        },
        radiusM: bubbled
          ? (m.precisionM as number)
          : Math.max(15, Math.min(300, m.accuracyM as number)),
        color: colorFor(m.userId),
        fillColor: colorFor(m.userId),
        // A bubble is filled more heavily than an accuracy ring. It is a
        // deliberate choice somebody made, not a measurement artefact, and it
        // should read as a region rather than as a margin of error.
        fillOpacity: bubbled ? 0.16 : 0.1,
      };
    });
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
      <SyncBar active={revalidating} />
      {/*
        Mounted unconditionally, and deliberately without a `key`.

        This used to be `{center ? <map/> : <full-screen spinner/>}`. Because
        `center` starts null and is only filled once GPS or a member position
        resolves, opening this screen showed a spinner over the whole surface
        for as long as the first fix took, which outdoors is a second and
        indoors can be much longer.

        Worse, it made the native map view conditional. Every remount of a
        MapLibre surface re-creates the GL context and re-requests tiles, so
        the cost of that spinner was paid twice: once waiting, once redrawing.

        Now the map mounts at frame one on a default centre and the camera
        moves when the real position arrives. `fitAll` already re-frames on
        markers, so nothing is lost. Keeping it out of any conditional is also
        what makes switching circles flash-free: the surface is never torn
        down, only its marker and polyline props change.
      */}
      <OSMMapView
        style={StyleSheet.absoluteFill}
        center={center ?? INDIA_CENTER}
        zoom={center ? 13 : 4}
        markers={markers}
        circles={[...rings, ...stopRings, ...breadcrumbs]}
        polylines={trailLines}
        fitAll={markers.length > 0}
      />

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
                  : 'Only your circle sees it. Your route clears after 7 days.'}
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
              {shown.map((m) => (
                <MemberCard
                  key={m.userId}
                  member={m}
                  color={colorFor(m.userId)}
                  distanceM={distanceOf(m)}
                  selected={selectedId === m.userId}
                  onPress={() => void selectMember(m)}
                  actions={
                    <>
                      <Pressable
                        onPress={() => {
                          setSelectedId(m.userId);
                          setCenter({ latitude: m.lat, longitude: m.lng });
                          setHistoryOpen(true);
                        }}
                        style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}
                        accessibilityRole="button"
                      >
                        <Ionicons name="footsteps-outline" size={16} color={colors.brandDeep} />
                        <Text style={styles.actionText}>Where they went</Text>
                      </Pressable>
                      {/* The one people actually want, and previously a
                          fingernail-sized glyph nobody found. "Replay the day"
                          says what it does; a play triangle next to a distance
                          reads as a media control for something else. */}
                      <Pressable
                        onPress={() =>
                          // @ts-expect-error TripReplay lives in the AppStack, same
                          // as the other pushes from this screen.
                          navigation.navigate('TripReplay', { userId: m.userId, name: m.name })
                        }
                        style={({ pressed }) => [styles.actionBtn, styles.actionPrimary, pressed && { opacity: 0.7 }]}
                        accessibilityRole="button"
                      >
                        <Ionicons name="play-circle" size={16} color={colors.textInverse} />
                        <Text style={[styles.actionText, { color: colors.textInverse }]}>
                          Replay the day
                        </Text>
                      </Pressable>
                    </>
                  }
                />
              ))}
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
  freshRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  freshDot: { width: 7, height: 7, borderRadius: 4 },

  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  actionPrimary: { backgroundColor: colors.brandDeep },
  actionText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12.5,
    color: colors.brandDeep,
  },
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
