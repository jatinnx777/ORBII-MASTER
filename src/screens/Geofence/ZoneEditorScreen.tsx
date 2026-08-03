import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { appAlert, OSMMapView, type OSMMarker, type OSMPolyline } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { getCurrentLocation } from '@/services/location';
import { listCircleMembers, listCircles, type Circle, type CircleMember } from '@/services/circles';
import { createPolygonZone, syncZoneMonitoring, type Corner } from '@/services/geofence';
import type { GeoPoint } from '@/types';

// Guided geofence setup: choose a circle -> choose the member -> draw the area on
// the map (tap up to 4 corners). When that person leaves the area, the circle is
// told, with the time, and it's stored. Monitoring uses the circle that covers
// the drawn area (phones only watch circular zones reliably in the background).

type Step = 'circle' | 'member' | 'map';
const MAX_CORNERS = 4;

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

  // Load the user's circles up front.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const c = await listCircles();
        if (alive) setCircles(c);
      } catch {
        if (alive) setCircles([]);
      }
      if (alive) setLoading(false);
    })();
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
    setStep('map');
    if (!center) {
      try {
        setCenter(await getCurrentLocation());
      } catch {
        setCenter({ latitude: 22.9734, longitude: 78.6569 });
      }
    }
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

  const markers: OSMMarker[] = corners.map((c, i) => ({
    id: `corner-${i}`,
    coordinate: { latitude: c.lat, longitude: c.lng },
    kind: 'destination',
  }));
  const polylines: OSMPolyline[] =
    corners.length >= 2
      ? [
          {
            id: 'area',
            coordinates: [...corners, corners[0]].map((c) => ({ latitude: c.lat, longitude: c.lng })),
            color: colors.brandDeep,
            width: 3,
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
        `${target.name || 'They'} will be watched for leaving "${label.trim()}". You'll be told, with the time, if they leave.`,
        [{ text: 'Done', onPress: () => navigation.goBack() }],
      );
    } finally {
      setBusy(false);
    }
  };

  const title = step === 'circle' ? 'Choose a circle' : step === 'member' ? 'Choose a person' : 'Draw the area';

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={goBackStep} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>{title}</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Step dots */}
        <View style={styles.steps}>
          {(['circle', 'member', 'map'] as Step[]).map((s, i) => (
            <View
              key={s}
              style={[
                styles.stepDot,
                (step === s || (['circle', 'member', 'map'].indexOf(step) > i)) && styles.stepDotOn,
              ]}
            />
          ))}
        </View>

        {step === 'circle' ? (
          <ScrollView contentContainerStyle={styles.list}>
            <Text style={styles.lead}>Which circle is this person in?</Text>
            {loading ? (
              <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.lg }} />
            ) : circles.length === 0 ? (
              <Text style={styles.empty}>You have no circles yet. Create one and add people first.</Text>
            ) : (
              circles.map((c) => (
                <Pressable key={c.id} onPress={() => pickCircle(c)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                  <View style={styles.rowIcon}>
                    <Ionicons name="people" size={18} color={colors.brandDeep} />
                  </View>
                  <Text style={styles.rowLabel}>{c.name}</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </Pressable>
              ))
            )}
          </ScrollView>
        ) : step === 'member' ? (
          <ScrollView contentContainerStyle={styles.list}>
            <Text style={styles.lead}>Who do you want to set an area for?</Text>
            {loadingMembers ? (
              <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.lg }} />
            ) : members.length === 0 ? (
              <Text style={styles.empty}>No other people in this circle yet. Add someone to it first.</Text>
            ) : (
              members.map((m) => (
                <Pressable key={m.userId} onPress={() => pickMember(m)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{(m.name || m.username || '?').slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <Text style={styles.rowLabel}>{m.name || m.username || 'Member'}</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </Pressable>
              ))
            )}
          </ScrollView>
        ) : (
          <>
            <View style={styles.mapWrap}>
              {center ? (
                <OSMMapView center={center} zoom={16} onMapPress={onMapPress} markers={markers} polylines={polylines} />
              ) : (
                <View style={styles.mapLoading}>
                  <ActivityIndicator color={colors.brand} />
                </View>
              )}
              <View style={styles.mapHint} pointerEvents="none">
                <Ionicons name="hand-left" size={14} color={colors.textInverse} />
                <Text style={styles.mapHintText}>
                  {corners.length === 0
                    ? `Tap the map to fence ${target?.name || 'them'} in`
                    : corners.length < MAX_CORNERS
                      ? `${corners.length}/${MAX_CORNERS} corners · tap to add`
                      : 'Area set · 4/4 corners'}
                </Text>
              </View>
              <View style={styles.mapBtns}>
                <Pressable onPress={() => setCorners((c) => c.slice(0, -1))} disabled={corners.length === 0} style={[styles.mapBtn, corners.length === 0 && styles.mapBtnDim]}>
                  <Ionicons name="arrow-undo" size={16} color={colors.textPrimary} />
                  <Text style={styles.mapBtnText}>Undo</Text>
                </Pressable>
                <Pressable onPress={() => setCorners([])} disabled={corners.length === 0} style={[styles.mapBtn, corners.length === 0 && styles.mapBtnDim]}>
                  <Ionicons name="close" size={16} color={colors.textPrimary} />
                  <Text style={styles.mapBtnText}>Clear</Text>
                </Pressable>
              </View>
            </View>

            <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
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
            </ScrollView>
          </>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.icon },
  headerTitle: { ...typography.h3, color: colors.textPrimary },

  steps: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingBottom: spacing.sm },
  stepDot: { width: 26, height: 4, borderRadius: 2, backgroundColor: colors.border },
  stepDotOn: { backgroundColor: colors.brand },

  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  lead: { ...typography.body, fontSize: 14, color: colors.textSecondary, marginBottom: spacing.xs, marginTop: spacing.xs },
  empty: { ...typography.caption, fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.md, ...shadows.card },
  rowIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.brandDeep },
  rowLabel: { flex: 1, fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary },

  mapWrap: { height: '52%', marginHorizontal: spacing.lg, borderRadius: radius.xl, overflow: 'hidden', ...shadows.card },
  mapLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  mapHint: {
    position: 'absolute',
    top: spacing.sm,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(20,18,15,0.82)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  mapHintText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12, color: colors.textInverse },
  mapBtns: { position: 'absolute', bottom: spacing.sm, right: spacing.sm, gap: spacing.sm },
  mapBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8, ...shadows.icon },
  mapBtnDim: { opacity: 0.5 },
  mapBtnText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.textPrimary },

  form: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontFamily: fontFamilies.interMedium,
    fontSize: 14.5,
    color: colors.textPrimary,
    ...shadows.icon,
  },
  cta: { backgroundColor: colors.brand, borderRadius: radius.pill, paddingVertical: 15, alignItems: 'center' },
  ctaDim: { opacity: 0.5 },
  ctaText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15.5, color: colors.textInverse },
  pressed: { opacity: 0.9 },
});
