import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OSMMapView, type OSMMarker, type OSMPolyline, type OSMCircle } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import { supabase } from '@/services/supabase';
import { getCurrentLocation } from '@/services/location';
import { useAppSelector } from '@/redux/store';
import { listCircleMembers } from '@/services/circles';
import {
  isCircleSharing,
  startCircleSharing,
  stopCircleSharing,
  loadCircleMembersLocations,
  loadMemberTrail,
  type MemberLocation,
  type TrailPoint,
} from '@/services/circle-location';
import type { GeoPoint } from '@/types';
import { escapeHtml } from '@/utils/html';

const DOT_COLORS = ['#8672CE', '#C6913A', '#6F7C61', '#BC5B3C', '#4F86C6', '#B0568C'];
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return DOT_COLORS[h % DOT_COLORS.length];
}
function avatarHtml(name: string | null, color: string, stale: boolean): string {
  // Escaped defensively: this string is rendered as raw HTML inside the map
  // WebView, so any user-controlled character must be neutralised.
  const initial = escapeHtml((name || '?').slice(0, 1).toUpperCase());
  const bg = stale ? '#9a958c' : color;
  const op = stale ? '0.65' : '1';
  return `<div style="opacity:${op};width:40px;height:40px;border-radius:50%;background:${bg};border:3px solid #fff;box-shadow:0 4px 14px rgba(20,18,40,0.28);display:flex;align-items:center;justify-content:center;color:#fff;font-family:sans-serif;font-weight:700;font-size:16px">${initial}</div>`;
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
  // Which circle's members we're viewing, and that circle's member ids.
  const [selectedCircleId, setSelectedCircleId] = useState<string | null>(null);
  const [memberIds, setMemberIds] = useState<Set<string> | null>(null);
  // History: which member's trail is shown.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trail, setTrail] = useState<TrailPoint[]>([]);

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

  const selectMember = async (m: MemberLocation) => {
    if (selectedId === m.userId) {
      setSelectedId(null);
      setTrail([]);
      return;
    }
    setSelectedId(m.userId);
    setCenter({ latitude: m.lat, longitude: m.lng });
    setTrail(await loadMemberTrail(m.userId, 12));
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
    setBusy(true);
    try {
      if (next) {
        const ok = await startCircleSharing();
        setSharing(ok);
      } else {
        await stopCircleSharing();
        setSharing(false);
      }
    } finally {
      setBusy(false);
    }
  };

  const markers: OSMMarker[] = shown.map((m) => ({
    id: m.userId,
    coordinate: { latitude: m.lat, longitude: m.lng },
    // A member who turned sharing off shows greyed at their LAST known spot.
    html: avatarHtml(m.name, colorFor(m.userId), !m.sharing || freshness(m.updatedAt).stale),
  }));
  // Accuracy rings — "precise to ~Xm". Only for people actually sharing now.
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
  // History trail of the selected member.
  const trailLines: OSMPolyline[] =
    selectedId && trail.length >= 2
      ? [{ id: 'trail', coordinates: trail.map((t) => ({ latitude: t.lat, longitude: t.lng })), color: colors.brandDeep, width: 3 }]
      : [];
  const selectedMember = shown.find((m) => m.userId === selectedId) ?? null;

  return (
    <View style={styles.root}>
      {center ? (
        <OSMMapView
          style={StyleSheet.absoluteFill}
          center={center}
          zoom={13}
          markers={markers}
          circles={rings}
          polylines={trailLines}
          fitAll={markers.length > 0}
        />
      ) : (
        <View style={styles.skeleton}><ActivityIndicator color={colors.brandDeep} /></View>
      )}

      <SafeAreaView style={StyleSheet.absoluteFill} edges={['top', 'bottom']} pointerEvents="box-none">
        {/* Top bar — floating glass controls. */}
        <View style={styles.topBar} pointerEvents="box-none">
          <GlassButton icon="chevron-back" onPress={() => navigation.goBack()} />
          <View style={styles.titlePill}>
            <Ionicons name="people" size={13} color={colors.textPrimary} />
            <Text style={styles.titleText}>Circle map</Text>
          </View>
          <GlassButton icon="refresh" onPress={() => void refresh()} />
        </View>

        {/* Circle selector — pick whose circle you're looking at. */}
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
                  onPress={() => { setSelectedCircleId(c.id); setSelectedId(null); setTrail([]); }}
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
              {selectedMember.name || 'Member'} · last 12h · {trail.length} points
            </Text>
            <Pressable onPress={() => { setSelectedId(null); setTrail([]); }} hitSlop={8}>
              <Ionicons name="close" size={16} color={colors.textInverse} />
            </Pressable>
          </View>
        ) : null}

        {/* Bottom sheet — frosted glass. */}
        <BlurView intensity={32} tint="light" style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.shareRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.shareTitle}>Share my live location</Text>
              <Text style={styles.shareSub}>
                {sharing ? 'Your circle can see you. Turn off any time.' : 'Only your circle can see it, when it’s on.'}
              </Text>
            </View>
            <Switch
              value={sharing}
              onValueChange={toggleShare}
              disabled={busy}
              trackColor={{ false: colors.border, true: colors.brandMid }}
              thumbColor={sharing ? colors.brand : '#FFFFFF'}
            />
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
