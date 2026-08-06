import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { appAlert, OSMMapView, type OSMMarker, type OSMPolyline } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { getCurrentLocation } from '@/services/location';
import { listCircleMembers, listCircles, type Circle, type CircleMember } from '@/services/circles';
import {
  createPolygonZone,
  loadZonesForMember,
  syncZoneMonitoring,
  type Corner,
  type Geofence,
} from '@/services/geofence';
import { searchPlaces, type Place } from '@/services/geocode';
import type { GeoPoint } from '@/types';

// Full-bleed map with the wizard as floating sheets over it. The map mounts the
// instant we have a location — while the parent picks a circle + member (a few
// seconds) the tiles finish loading, so the "draw" step feels instant.

type Step = 'circle' | 'member' | 'map';
// Draw an area with as many corners as the place needs (a sane upper bound so a
// stray tap-storm can't create a 500-point polygon).
const MAX_CORNERS = 20;
function pinHtml(n: number): string {
  return `<div style="width:24px;height:24px;border-radius:50%;background:${colors.brandDeep};border:2.5px solid #ffffff;box-shadow:0 3px 10px rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;color:#fff;font-family:sans-serif;font-weight:700;font-size:12px">${n}</div>`;
}

// Scrollable time picker (30-min steps). 'HH:MM' 24h values, 12h labels.
const WHEEL_ITEM_H = 38;
const TIME_OPTS: { value: string; label: string }[] = (() => {
  const out: { value: string; label: string }[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const hr = h % 12 === 0 ? 12 : h % 12;
      const ap = h < 12 ? 'AM' : 'PM';
      out.push({ value, label: `${hr}:${String(m).padStart(2, '0')} ${ap}` });
    }
  }
  return out;
})();
function fmtTime(v: string): string {
  return TIME_OPTS.find((t) => t.value === v)?.label ?? v;
}

function Wheel({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = React.useRef<ScrollView>(null);
  const startIndex = Math.max(0, TIME_OPTS.findIndex((o) => o.value === value));
  React.useEffect(() => {
    const t = setTimeout(() => ref.current?.scrollTo({ y: startIndex * WHEEL_ITEM_H, animated: false }), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View style={styles.wheel}>
      <View pointerEvents="none" style={styles.wheelHighlight} />
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_H}
        decelerationRate="fast"
        nestedScrollEnabled
        contentContainerStyle={{ paddingVertical: WHEEL_ITEM_H }}
        onMomentumScrollEnd={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.y / WHEEL_ITEM_H);
          const opt = TIME_OPTS[Math.min(TIME_OPTS.length - 1, Math.max(0, i))];
          if (opt && opt.value !== value) onChange(opt.value);
        }}
      >
        {TIME_OPTS.map((o) => (
          <View key={o.value} style={styles.wheelItem}>
            <Text style={[styles.wheelText, o.value === value && styles.wheelTextActive]}>{o.label}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

export function ZoneEditorScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const profile = useAppSelector((s) => s.user.profile);

  const [step, setStep] = useState<Step>('circle');
  const [circles, setCircles] = useState<Circle[]>([]);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [target, setTarget] = useState<CircleMember | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const [center, setCenter] = useState<GeoPoint | null>(null);
  const [corners, setCorners] = useState<Corner[]>([]);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  // Previously-saved zones for this person (so they can reuse, not redraw).
  const [savedZones, setSavedZones] = useState<Geofence[]>([]);
  // The hours the fenced person should be inside the zone (scrollable picker).
  const [fromTime, setFromTime] = useState('09:00');
  const [toTime, setToTime] = useState('17:00');

  // Place search (hospital / college / etc.)
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      setResults(await searchPlaces(q, center ? { lat: center.latitude, lng: center.longitude } : undefined));
      setSearching(false);
    }, 350);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query]);

  const pickPlace = (p: Place) => {
    setQuery('');
    setResults([]);
    setCenter({ latitude: p.lat, longitude: p.lng });
  };

  // Warm the map + load circles immediately, in parallel.
  useEffect(() => {
    let alive = true;
    getCurrentLocation()
      .then((p) => alive && setCenter(p))
      .catch(() => alive && setCenter({ latitude: 22.9734, longitude: 78.6569 }));
    listCircles()
      .then((c) => alive && setCircles(c))
      .catch(() => alive && setCircles([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const pickCircle = async (circle: Circle) => {
    setLoadingMembers(true);
    setStep('member');
    try {
      const list = await listCircleMembers(circle.id);
      setMembers(list.filter((m) => m.userId !== profile?.uid));
    } catch {
      setMembers([]);
    } finally {
      setLoadingMembers(false);
    }
  };

  const pickMember = async (m: CircleMember) => {
    setTarget(m);
    setLabel('');
    setCorners([]);
    setSavedZones([]);
    setStep('map');
    if (profile?.uid) {
      try {
        setSavedZones(await loadZonesForMember(profile.uid, m.userId));
      } catch {
        setSavedZones([]);
      }
    }
  };

  // Reuse a saved area: load its shape, name and hours so the user can just
  // confirm and save instead of drawing it all over again.
  const reuseZone = (z: Geofence) => {
    if (z.corners && z.corners.length >= 3) {
      setCorners(z.corners);
      setCenter({ latitude: z.lat, longitude: z.lng });
    }
    setLabel(z.label);
    if (z.activeFrom) setFromTime(z.activeFrom);
    if (z.activeTo) setToTime(z.activeTo);
  };

  const stepIndex = step === 'circle' ? 1 : step === 'member' ? 2 : 3;

  const goBackStep = () => {
    if (step === 'map') setStep('member');
    else if (step === 'member') setStep('circle');
    else navigation.goBack();
  };

  const onMapPress = useCallback((coord: GeoPoint) => {
    setCorners((prev) =>
      prev.length >= MAX_CORNERS ? prev : [...prev, { lat: coord.latitude, lng: coord.longitude }],
    );
  }, []);

  const markers: OSMMarker[] =
    step === 'map'
      ? corners.map((c, i) => ({ id: `corner-${i}`, coordinate: { latitude: c.lat, longitude: c.lng }, html: pinHtml(i + 1) }))
      : [];
  const polylines: OSMPolyline[] =
    step === 'map' && corners.length >= 2
      ? [
          {
            id: 'area',
            coordinates: [...corners, corners[0]].map((c) => ({ latitude: c.lat, longitude: c.lng })),
            color: '#ffffff',
            width: 2.5,
            dashed: true,
            fill: corners.length >= 3,
            fillColor: colors.brand,
            fillOpacity: 0.22,
          },
        ]
      : [];

  const save = async () => {
    if (!profile?.uid || !target || busy) return;
    if (corners.length < 3) {
      appAlert('Draw the area', 'Tap the map to place at least 3 corners (4 for a square).');
      return;
    }
    if (label.trim().length < 2) {
      appAlert('Name the area', 'Give it a name like "College" or "Home".');
      return;
    }
    setBusy(true);
    try {
      const res = await createPolygonZone({
        ownerId: profile.uid,
        memberId: target.userId,
        label: label.trim(),
        corners,
        activeFrom: fromTime,
        activeTo: toTime,
      });
      if (!res.ok) {
        appAlert("Couldn't save the area", res.error);
        return;
      }
      await syncZoneMonitoring(profile.uid);
      appAlert(
        'Area saved',
        `Your circle will be alerted, with the time, if ${target.name || 'they'} leave "${label.trim()}" between ${fmtTime(fromTime)} and ${fmtTime(toTime)}.`,
        [{ text: 'Done', onPress: () => navigation.goBack() }],
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      {/* Full-bleed map (mounts as soon as we have a location) */}
      {center ? (
        <OSMMapView
          style={StyleSheet.absoluteFill}
          center={center}
          zoom={16}
          defaultLayer="satellite"
          onMapPress={step === 'map' ? onMapPress : undefined}
          markers={markers}
          polylines={polylines}
        />
      ) : (
        <View style={styles.skeleton}>
          <ActivityIndicator color={colors.brandDeep} />
        </View>
      )}

      <SafeAreaView style={StyleSheet.absoluteFill} edges={['top']} pointerEvents="box-none">
        {/* Floating top bar */}
        <View style={styles.topBar} pointerEvents="box-none">
          <Pressable onPress={goBackStep} hitSlop={10} style={styles.glassBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          {step === 'map' ? (
            <View style={styles.hintPill}>
              <Ionicons name="hand-left" size={13} color={colors.textInverse} />
              <Text style={styles.hintText}>
                {corners.length === 0
                  ? `Tap the corners to fence ${target?.name || 'them'} in`
                  : `${corners.length} corner${corners.length === 1 ? '' : 's'} · tap to add more`}
              </Text>
            </View>
          ) : (
            <View style={{ width: 44 }} />
          )}
          {step === 'map' && corners.length > 0 ? (
            <Pressable onPress={() => setCorners((c) => c.slice(0, -1))} hitSlop={10} style={styles.glassBtn}>
              <Ionicons name="arrow-undo" size={19} color={colors.textPrimary} />
            </Pressable>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>

        {step === 'map' ? (
          <View style={styles.searchWrap} pointerEvents="box-none">
            <View style={styles.searchBar}>
              <Ionicons name="search" size={18} color={colors.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search a place (hospital, college…)"
                placeholderTextColor={colors.textMuted}
                style={styles.searchInput}
                autoCorrect={false}
              />
              {searching ? (
                <ActivityIndicator size="small" color={colors.brandDeep} />
              ) : query ? (
                <Pressable onPress={() => { setQuery(''); setResults([]); }} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>
            {results.length > 0 ? (
              <View style={styles.searchResults}>
                {results.map((p, i) => (
                  <Pressable key={i} onPress={() => pickPlace(p)} style={({ pressed }) => [styles.searchRow, pressed && styles.pressed]}>
                    <Ionicons name="location" size={16} color={colors.brandDeep} />
                    <Text style={styles.searchRowText} numberOfLines={2}>{p.name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={{ flex: 1 }} pointerEvents="box-none" />

        {/* Bottom sheet, anchored to the screen edge */}
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <View style={styles.handle} />

          <View style={styles.stepBar}>
            {['Circle', 'Member', 'Area'].map((s, i) => {
              const n = i + 1;
              const active = n === stepIndex;
              const done = n < stepIndex;
              return (
                <React.Fragment key={s}>
                  <View style={styles.stepItem}>
                    <View style={[styles.stepDot, active && styles.stepDotActive, done && styles.stepDotDone]}>
                      {done ? (
                        <Ionicons name="checkmark" size={12} color={colors.textInverse} />
                      ) : (
                        <Text style={[styles.stepNum, active && styles.stepNumActive]}>{n}</Text>
                      )}
                    </View>
                    <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{s}</Text>
                  </View>
                  {i < 2 ? <View style={[styles.stepLine, done && styles.stepLineDone]} /> : null}
                </React.Fragment>
              );
            })}
          </View>

          {step === 'circle' ? (
            <>
              <Text style={styles.sheetTitle}>Choose a circle</Text>
              <Text style={styles.sheetSub}>Pick the group this safe zone belongs to.</Text>
              {loading ? (
                <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.lg }} />
              ) : circles.length === 0 ? (
                <Text style={styles.empty}>No circles yet. Create one and add people first.</Text>
              ) : (
                <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
                  {circles.map((c) => (
                    <Pressable key={c.id} onPress={() => pickCircle(c)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                      <View style={styles.rowIcon}><Ionicons name="people" size={18} color={colors.brandDeep} /></View>
                      <Text style={styles.rowLabel} numberOfLines={1}>{c.name}</Text>
                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </>
          ) : step === 'member' ? (
            <>
              <Text style={styles.sheetTitle}>Who do you want to fence?</Text>
              <Text style={styles.sheetSub}>Your circle is alerted the moment they leave the area.</Text>
              {loadingMembers ? (
                <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.lg }} />
              ) : members.length === 0 ? (
                <Text style={styles.empty}>No other people in this circle yet. Add someone first.</Text>
              ) : (
                <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
                  {members.map((m) => (
                    <Pressable key={m.userId} onPress={() => pickMember(m)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                      <View style={styles.avatar}><Text style={styles.avatarText}>{(m.name || m.username || '?').slice(0, 1).toUpperCase()}</Text></View>
                      <Text style={styles.rowLabel} numberOfLines={1}>{m.name || m.username || 'Member'}</Text>
                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </>
          ) : (
            <>
              {savedZones.length > 0 && corners.length === 0 ? (
                <View style={styles.reuseWrap}>
                  <Text style={styles.reuseLabel}>REUSE A SAVED AREA</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.md }}
                  >
                    {savedZones.map((z) => (
                      <Pressable key={z.id} onPress={() => reuseZone(z)} style={styles.reuseChip}>
                        <Ionicons name="bookmark" size={13} color={colors.brandDeep} />
                        <Text style={styles.reuseChipText} numberOfLines={1}>{z.label}</Text>
                        {z.activeFrom && z.activeTo ? (
                          <Text style={styles.reuseChipTime}>
                            {fmtTime(z.activeFrom)}–{fmtTime(z.activeTo)}
                          </Text>
                        ) : null}
                      </Pressable>
                    ))}
                  </ScrollView>
                  <Text style={styles.reuseHint}>or tap the map to draw a new one</Text>
                </View>
              ) : null}

              <View style={styles.fenceChip}>
                <View style={styles.chipAvatar}>
                  <Text style={styles.chipAvatarText}>
                    {(target?.name || target?.username || '?').slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.chipText} numberOfLines={1}>
                  Fencing <Text style={styles.chipName}>{target?.name || target?.username || 'them'}</Text>
                </Text>
                <View style={[styles.cornerTag, corners.length >= 3 && styles.cornerTagOk]}>
                  <Ionicons
                    name={corners.length >= 3 ? 'checkmark-circle' : 'ellipse-outline'}
                    size={13}
                    color={corners.length >= 3 ? colors.sageDeep : colors.textMuted}
                  />
                  <Text style={[styles.cornerTagText, corners.length >= 3 && styles.cornerTagTextOk]}>
                    {corners.length}/3+ corners
                  </Text>
                </View>
              </View>
              <View style={styles.inputWrap}>
                <Ionicons name="pricetag-outline" size={17} color={colors.textMuted} />
                <TextInput
                  value={label}
                  onChangeText={setLabel}
                  placeholder="Name the area (College, Home, Hostel)"
                  placeholderTextColor={colors.textMuted}
                  style={styles.inputField}
                  maxLength={40}
                />
              </View>

              {corners.length >= 3 ? (
                <View style={styles.timeCard}>
                  <Text style={styles.timeCardLabel}>
                    <Ionicons name="time-outline" size={13} color={colors.textSecondary} />{' '}
                    Hours they should be inside
                  </Text>
                  <View style={styles.timeRow}>
                    <View style={styles.timeCol}>
                      <Text style={styles.timeColLabel}>FROM</Text>
                      <Wheel value={fromTime} onChange={setFromTime} />
                    </View>
                    <Text style={styles.timeDash}>–</Text>
                    <View style={styles.timeCol}>
                      <Text style={styles.timeColLabel}>TO</Text>
                      <Wheel value={toTime} onChange={setToTime} />
                    </View>
                  </View>
                </View>
              ) : null}

              <Pressable
                onPress={save}
                disabled={busy || corners.length < 3}
                style={({ pressed }) => [styles.cta, (busy || corners.length < 3) && styles.ctaDim, pressed && styles.pressed]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.textInverse} />
                ) : (
                  <>
                    <Ionicons name="shield-checkmark" size={18} color={colors.textInverse} />
                    <Text style={styles.ctaText}>Save area for {target?.name || 'them'}</Text>
                  </>
                )}
              </Pressable>
            </>
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
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  hintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(20,18,15,0.85)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  hintText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.textInverse },

  searchWrap: { paddingHorizontal: spacing.md, marginTop: spacing.sm },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    ...shadows.card,
  },
  searchInput: { flex: 1, fontFamily: fontFamilies.interMedium, fontSize: 14.5, color: colors.textPrimary, paddingVertical: 0 },
  searchResults: {
    marginTop: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
    ...shadows.card,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  searchRowText: { flex: 1, fontFamily: fontFamilies.interMedium, fontSize: 13.5, color: colors.textPrimary, lineHeight: 18 },

  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 16,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.sm },

  stepBar: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  stepItem: { alignItems: 'center', gap: 4 },
  stepDot: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceMuted, borderWidth: 1.5, borderColor: colors.border,
  },
  stepDotActive: { backgroundColor: colors.brandSoft, borderColor: colors.brandDeep },
  stepDotDone: { backgroundColor: colors.brandDeep, borderColor: colors.brandDeep },
  stepNum: { fontFamily: fontFamilies.poppinsBold, fontSize: 12, color: colors.textMuted },
  stepNumActive: { color: colors.brandDeep },
  stepLabel: { fontFamily: fontFamilies.interMedium, fontSize: 11, color: colors.textMuted },
  stepLabelActive: { color: colors.textPrimary, fontFamily: fontFamilies.poppinsSemiBold },
  stepLine: { flex: 1, height: 1.5, backgroundColor: colors.border, marginHorizontal: 6, marginBottom: 16 },
  stepLineDone: { backgroundColor: colors.brandDeep },

  sheetTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: colors.textPrimary },
  sheetSub: { fontFamily: fontFamilies.interMedium, fontSize: 12.5, color: colors.textSecondary, marginTop: 2, marginBottom: spacing.xs },

  fenceChip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceMuted, borderRadius: radius.lg,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, marginBottom: spacing.sm,
  },
  chipAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  chipAvatarText: { fontFamily: fontFamilies.poppinsBold, fontSize: 13, color: colors.brandDeep },
  chipText: { flex: 1, fontFamily: fontFamilies.interMedium, fontSize: 13.5, color: colors.textSecondary },
  chipName: { fontFamily: fontFamilies.poppinsSemiBold, color: colors.textPrimary },
  cornerTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 },
  cornerTagOk: { backgroundColor: colors.sageSoft },
  cornerTagText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 11, color: colors.textMuted },
  cornerTagTextOk: { color: colors.sageDeep },

  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceMuted, borderRadius: radius.lg,
    paddingHorizontal: spacing.md, paddingVertical: 2,
  },
  inputField: { flex: 1, fontFamily: fontFamilies.interMedium, fontSize: 15, color: colors.textPrimary, paddingVertical: 14 },

  reuseWrap: { marginBottom: spacing.sm, gap: 6 },
  reuseLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 10.5, letterSpacing: 0.8, color: colors.textMuted },
  reuseChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.brandSoft, borderRadius: radius.pill,
    paddingHorizontal: spacing.md, paddingVertical: 9, maxWidth: 220,
  },
  reuseChipText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13, color: colors.textPrimary },
  reuseChipTime: { fontFamily: fontFamilies.interMedium, fontSize: 11, color: colors.brandDeep },
  reuseHint: { fontFamily: fontFamilies.interMedium, fontSize: 11.5, color: colors.textMuted },

  timeCard: { backgroundColor: colors.surfaceMuted, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.sm, gap: spacing.sm },
  timeCardLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12, color: colors.textSecondary },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timeCol: { flex: 1, alignItems: 'center', gap: 4 },
  timeColLabel: { fontFamily: fontFamilies.poppinsBold, fontSize: 10, letterSpacing: 1, color: colors.textMuted },
  timeDash: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: colors.textMuted, paddingHorizontal: 6 },
  wheel: { height: WHEEL_ITEM_H * 3, width: '100%', position: 'relative' },
  wheelHighlight: { position: 'absolute', left: 8, right: 8, top: WHEEL_ITEM_H, height: WHEEL_ITEM_H, borderRadius: 10, backgroundColor: colors.brandSoft },
  wheelItem: { height: WHEEL_ITEM_H, alignItems: 'center', justifyContent: 'center' },
  wheelText: { fontFamily: fontFamilies.interMedium, fontSize: 14.5, color: colors.textMuted },
  wheelTextActive: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.textPrimary },
  sheetScroll: { maxHeight: 260 },
  empty: { fontFamily: fontFamilies.interMedium, fontSize: 13, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fontFamilies.poppinsBold, fontSize: 17, color: colors.brandDeep },
  rowLabel: { flex: 1, fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15.5, color: colors.textPrimary },

  input: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontFamily: fontFamilies.interMedium,
    fontSize: 15,
    color: colors.textPrimary,
  },
  cta: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.brand, borderRadius: radius.pill, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  ctaDim: { opacity: 0.5 },
  ctaText: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.textInverse },
  pressed: { opacity: 0.85 },
});
