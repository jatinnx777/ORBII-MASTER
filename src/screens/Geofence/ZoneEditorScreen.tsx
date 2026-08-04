import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { appAlert, OSMMapView, type OSMMarker, type OSMPolyline } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { getCurrentLocation } from '@/services/location';
import { listCircleMembers, listCircles, type Circle, type CircleMember } from '@/services/circles';
import { createPolygonZone, syncZoneMonitoring, type Corner } from '@/services/geofence';
import { searchPlaces, type Place } from '@/services/geocode';
import type { GeoPoint } from '@/types';

// Full-bleed map with the wizard as floating sheets over it. The map mounts the
// instant we have a location — while the parent picks a circle + member (a few
// seconds) the tiles finish loading, so the "draw" step feels instant.

type Step = 'circle' | 'member' | 'map';
const MAX_CORNERS = 4;
const PIN = `<div style="width:16px;height:16px;border-radius:50%;background:${colors.brandDeep};border:3px solid #ffffff;box-shadow:0 3px 9px rgba(0,0,0,0.4)"></div>`;

export function ZoneEditorScreen() {
  const navigation = useNavigation();
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
      setResults(await searchPlaces(q));
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

  const pickMember = (m: CircleMember) => {
    setTarget(m);
    setLabel('');
    setCorners([]);
    setStep('map');
  };

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
      ? corners.map((c, i) => ({ id: `corner-${i}`, coordinate: { latitude: c.lat, longitude: c.lng }, html: PIN }))
      : [];
  const polylines: OSMPolyline[] =
    step === 'map' && corners.length >= 2
      ? [
          {
            id: 'area',
            coordinates: [...corners, corners[0]].map((c) => ({ latitude: c.lat, longitude: c.lng })),
            color: colors.brandDeep,
            width: 2.5,
            fill: corners.length >= 3,
            fillColor: colors.brand,
            fillOpacity: 0.18,
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
      });
      if (!res.ok) {
        appAlert("Couldn't save the area", res.error);
        return;
      }
      await syncZoneMonitoring(profile.uid);
      appAlert(
        'Area saved',
        `Your circle will be alerted, with the time, if ${target.name || 'they'} leave "${label.trim()}".`,
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
          onMapPress={step === 'map' ? onMapPress : undefined}
          markers={markers}
          polylines={polylines}
        />
      ) : (
        <View style={styles.skeleton}>
          <ActivityIndicator color={colors.brandDeep} />
        </View>
      )}

      <SafeAreaView style={StyleSheet.absoluteFill} edges={['top', 'bottom']} pointerEvents="box-none">
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
                  ? `Tap to fence ${target?.name || 'them'} in`
                  : corners.length < MAX_CORNERS
                    ? `${corners.length}/${MAX_CORNERS} corners`
                    : 'Area set'}
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

        {/* Floating bottom sheet */}
        <View style={styles.sheet}>
          <View style={styles.handle} />
          {step === 'circle' ? (
            <>
              <Text style={styles.sheetTitle}>Choose a circle</Text>
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
              <TextInput
                value={label}
                onChangeText={setLabel}
                placeholder="Name the area (College, Home, Hostel)"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                maxLength={40}
              />
              <Pressable
                onPress={save}
                disabled={busy || corners.length < 3}
                style={({ pressed }) => [styles.cta, (busy || corners.length < 3) && styles.ctaDim, pressed && styles.pressed]}
              >
                <Text style={styles.ctaText}>{busy ? 'Saving…' : `Save area for ${target?.name || 'them'}`}</Text>
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
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.xs },
  sheetTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: colors.textPrimary, marginBottom: spacing.xs },
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
  cta: { backgroundColor: colors.brand, borderRadius: radius.pill, paddingVertical: 16, alignItems: 'center', marginTop: spacing.xs },
  ctaDim: { opacity: 0.5 },
  ctaText: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.textInverse },
  pressed: { opacity: 0.85 },
});
