import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OSMMapView, type OSMMarker, type OSMPolyline, type OSMCircle } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import { getCurrentLocation } from '@/services/location';
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
  const op = stale ? '0.6' : '1';
  return `<div style="opacity:${op};width:38px;height:38px;border-radius:50%;background:${bg};border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:#fff;font-family:sans-serif;font-weight:700;font-size:15px">${initial}</div>`;
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
  const [members, setMembers] = useState<MemberLocation[]>([]);
  const [sharing, setSharing] = useState(false);
  const [center, setCenter] = useState<GeoPoint | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // History: which member's trail is shown.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trail, setTrail] = useState<TrailPoint[]>([]);

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
      const poll = setInterval(run, 15000);
      return () => {
        alive = false;
        clearInterval(poll);
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

  const markers: OSMMarker[] = members.map((m) => ({
    id: m.userId,
    coordinate: { latitude: m.lat, longitude: m.lng },
    html: avatarHtml(m.name, colorFor(m.userId), freshness(m.updatedAt).stale),
  }));
  // Accuracy rings — "precise to ~Xm".
  const rings: OSMCircle[] = members
    .filter((m) => m.accuracyM != null)
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
  const selectedMember = members.find((m) => m.userId === selectedId) ?? null;

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
        <View style={styles.topBar} pointerEvents="box-none">
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.glassBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.titlePill}>
            <Ionicons name="people" size={14} color={colors.textInverse} />
            <Text style={styles.titleText}>Circle map</Text>
          </View>
          <Pressable onPress={() => void refresh()} hitSlop={10} style={styles.glassBtn}>
            <Ionicons name="refresh" size={19} color={colors.textPrimary} />
          </Pressable>
        </View>

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

        <View style={styles.sheet}>
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
              trackColor={{ false: colors.border, true: colors.brandSoft }}
              thumbColor={sharing ? colors.brand : colors.surface}
            />
          </View>

          <Text style={styles.sectionLabel}>PEOPLE SHARING WITH YOU ({members.length})</Text>
          {loading ? (
            <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.md }} />
          ) : members.length === 0 ? (
            <Text style={styles.empty}>
              No one in your circle is sharing right now. Ask them to open the Circle map and turn on live location.
            </Text>
          ) : (
            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
              {members.map((m) => {
                const f = freshness(m.updatedAt);
                const sel = selectedId === m.userId;
                return (
                  <Pressable key={m.userId} onPress={() => void selectMember(m)} style={[styles.memberRow, sel && styles.memberRowOn]}>
                    <View style={[styles.memberDot, { backgroundColor: colorFor(m.userId) }]}>
                      <Text style={styles.memberInitial}>{(m.name || '?').slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName} numberOfLines={1}>{m.name || 'Circle member'}</Text>
                      <View style={styles.freshRow}>
                        <View style={[styles.freshDot, { backgroundColor: f.color }]} />
                        <Text style={styles.memberMeta}>
                          {ago(m.updatedAt)}{m.accuracyM != null ? ` · ~${Math.round(m.accuracyM)}m` : ''}
                        </Text>
                      </View>
                    </View>
                    {m.battery != null ? <Text style={styles.battery}>{m.battery}%</Text> : null}
                    <Ionicons name={sel ? 'time' : 'time-outline'} size={18} color={sel ? colors.brandDeep : colors.textMuted} />
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
    </View>
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
    backgroundColor: 'rgba(255,255,255,0.94)',
    alignItems: 'center', justifyContent: 'center', ...shadows.card,
  },
  titlePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(20,18,15,0.85)', borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 9,
  },
  titleText: { fontFamily: fontFamilies.poppinsBold, fontSize: 13, color: colors.textInverse },

  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg,
    gap: spacing.sm,
    shadowColor: '#000', shadowOffset: { width: 0, height: -6 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 16,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.xs },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  shareTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 15.5, color: colors.textPrimary },
  shareSub: { fontFamily: fontFamilies.interMedium, fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  sectionLabel: { fontFamily: fontFamilies.poppinsBold, fontSize: 11, letterSpacing: 0.8, color: colors.textMuted, marginTop: spacing.xs },
  empty: { fontFamily: fontFamilies.interMedium, fontSize: 13, color: colors.textMuted, lineHeight: 19, paddingVertical: spacing.sm },
  list: { maxHeight: 220 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, borderRadius: radius.md },
  memberRowOn: { backgroundColor: colors.brandSoft },
  memberDot: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  memberInitial: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: '#fff' },
  memberName: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary },
  freshRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  freshDot: { width: 7, height: 7, borderRadius: 4 },
  memberMeta: { fontFamily: fontFamilies.interMedium, fontSize: 12, color: colors.textSecondary },
  battery: { fontFamily: fontFamilies.interMedium, fontSize: 12.5, color: colors.textMuted },

  trailBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'center',
    marginBottom: spacing.sm,
    backgroundColor: 'rgba(20,18,15,0.88)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    maxWidth: '92%',
  },
  trailText: { flexShrink: 1, fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.textInverse },
});
