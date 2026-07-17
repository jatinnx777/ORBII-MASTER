import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { appAlert, useBrandSheet } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { getCurrentLocation } from '@/services/location';
import {
  createZone,
  deleteZone,
  loadZoneEvents,
  loadZonesISet,
  loadMyZones,
  syncZoneMonitoring,
  type Geofence,
  type ZoneEvent,
} from '@/services/geofence';

// Safe zones — set a zone around someone you love, and know if they leave it.
//
// Consent is built in, not bolted on: you can only fence someone who shares a
// circle with you (enforced by RLS, not just this UI), the person being fenced
// sees every zone set on them, and either side can delete it. Silent tracking
// of another person is stalking, and ORBII will not ship it.

const RADII = [200, 500, 1000, 2000];

export function GeofencesScreen() {
  const navigation = useNavigation();
  const sheet = useBrandSheet();
  const profile = useAppSelector((s) => s.user.profile);
  const contacts = profile?.emergencyContacts ?? [];

  const [mine, setMine] = useState<Geofence[]>([]); // zones I set on others
  const [onMe, setOnMe] = useState<Geofence[]>([]); // zones others set on me
  const [events, setEvents] = useState<ZoneEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [label, setLabel] = useState('');
  const [radius, setRadius] = useState(500);

  const refresh = useCallback(async () => {
    if (!profile?.uid) return;
    const [a, b, e] = await Promise.all([
      loadZonesISet(profile.uid),
      loadMyZones(profile.uid),
      loadZoneEvents(profile.uid),
    ]);
    setMine(a);
    setOnMe(b);
    setEvents(e);
    setLoading(false);
  }, [profile?.uid]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const addZoneHere = async () => {
    if (!profile?.uid || busy) return;
    const name = label.trim();
    if (name.length < 2) {
      appAlert('Name the zone', 'Give it a name like "Home" or "College".');
      return;
    }
    setBusy(true);
    try {
      let point;
      try {
        point = await getCurrentLocation();
      } catch {
        appAlert(
          'Location needed',
          'ORBII needs your location to place the zone. Turn location on and try again.',
        );
        return;
      }
      // A zone on yourself: the honest default. Fencing someone else is done
      // from their contact card, so consent is explicit.
      const res = await createZone({
        ownerId: profile.uid,
        memberId: profile.uid,
        label: name,
        lat: point.latitude,
        lng: point.longitude,
        radiusM: radius,
      });
      if (!res.ok) {
        appAlert("Couldn't create the zone", res.error);
        return;
      }
      setLabel('');
      await refresh();
      await syncZoneMonitoring(profile.uid);
    } finally {
      setBusy(false);
    }
  };

  const removeZone = (z: Geofence) => {
    sheet.confirm({
      title: `Delete "${z.label}"?`,
      body: 'You will stop being told when this zone is crossed.',
      destructive: true,
      confirmLabel: 'Delete',
      icon: 'trash',
      onConfirm: async () => {
        await deleteZone(z.id);
        await refresh();
        if (profile?.uid) await syncZoneMonitoring(profile.uid);
      },
    });
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Safe zones</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Ionicons name="locate" size={22} color={colors.brandDeep} />
            </View>
            <Text style={styles.heroTitle}>Know when someone leaves</Text>
            <Text style={styles.heroBody}>
              Draw a zone around a place that matters, like home or college. If
              it's crossed, the people who set it are told, and it's saved here.
            </Text>
          </View>

          {/* ── Create ── */}
          <Text style={styles.sectionLabel}>NEW ZONE AT MY LOCATION</Text>
          <View style={styles.card}>
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="Name it (Home, College, Hostel)"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              maxLength={40}
            />
            <View style={styles.radiiRow}>
              {RADII.map((r) => (
                <Pressable
                  key={r}
                  onPress={() => setRadius(r)}
                  style={[styles.radChip, radius === r && styles.radChipOn]}
                >
                  <Text style={[styles.radText, radius === r && styles.radTextOn]}>
                    {r >= 1000 ? `${r / 1000} km` : `${r} m`}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              onPress={addZoneHere}
              disabled={busy}
              style={({ pressed }) => [styles.cta, busy && { opacity: 0.6 }, pressed && styles.pressed]}
            >
              <Text style={styles.ctaText}>{busy ? 'Creating…' : 'Create zone here'}</Text>
            </Pressable>
          </View>

          {/* ── Zones I set ── */}
          <Text style={styles.sectionLabel}>ZONES YOU SET</Text>
          {loading ? (
            <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.lg }} />
          ) : mine.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No zones yet.</Text>
            </View>
          ) : (
            <View style={styles.card}>
              {mine.map((z, i) => (
                <React.Fragment key={z.id}>
                  {i > 0 ? <View style={styles.divider} /> : null}
                  <View style={styles.zoneRow}>
                    <View style={styles.zoneIcon}>
                      <Ionicons name="location" size={17} color={colors.brandDeep} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.zoneName}>{z.label}</Text>
                      <Text style={styles.zoneSub}>
                        {z.memberId === profile?.uid ? 'On you' : 'On a circle member'} ·{' '}
                        {z.radiusM >= 1000 ? `${z.radiusM / 1000} km` : `${z.radiusM} m`}
                      </Text>
                    </View>
                    <Pressable onPress={() => removeZone(z)} hitSlop={8}>
                      <Ionicons name="close-circle" size={21} color={colors.textMuted} />
                    </Pressable>
                  </View>
                </React.Fragment>
              ))}
            </View>
          )}

          {/* ── Zones on me (transparency) ── */}
          {onMe.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>ZONES SET ON YOU</Text>
              <View style={styles.card}>
                {onMe.map((z, i) => (
                  <React.Fragment key={z.id}>
                    {i > 0 ? <View style={styles.divider} /> : null}
                    <View style={styles.zoneRow}>
                      <View style={styles.zoneIcon}>
                        <Ionicons name="eye" size={17} color={colors.brandDeep} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.zoneName}>{z.label}</Text>
                        <Text style={styles.zoneSub}>
                          Someone in your circle is told if you leave this.
                        </Text>
                      </View>
                      <Pressable onPress={() => removeZone(z)} hitSlop={8}>
                        <Ionicons name="close-circle" size={21} color={colors.textMuted} />
                      </Pressable>
                    </View>
                  </React.Fragment>
                ))}
              </View>
              <Text style={styles.footnote}>
                You can always see and delete any zone set on you. ORBII will
                never track you silently.
              </Text>
            </>
          ) : null}

          {/* ── History ── */}
          {events.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>RECENT CROSSINGS</Text>
              <View style={styles.card}>
                {events.map((e, i) => (
                  <React.Fragment key={e.id}>
                    {i > 0 ? <View style={styles.divider} /> : null}
                    <View style={styles.zoneRow}>
                      <View
                        style={[
                          styles.zoneIcon,
                          e.kind === 'exit' && { backgroundColor: colors.coralSoft },
                        ]}
                      >
                        <Ionicons
                          name={e.kind === 'exit' ? 'exit-outline' : 'enter-outline'}
                          size={17}
                          color={e.kind === 'exit' ? colors.coralDeep : colors.sageDeep}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.zoneName}>
                          {e.kind === 'exit' ? 'Left' : 'Arrived at'} {e.label}
                        </Text>
                        <Text style={styles.zoneSub}>
                          {new Date(e.createdAt).toLocaleString('en-IN')}
                        </Text>
                      </View>
                    </View>
                  </React.Fragment>
                ))}
              </View>
            </>
          ) : null}

          {contacts.length === 0 ? (
            <Text style={styles.footnote}>
              Add people to your circle first, then you can set zones for each
              other.
            </Text>
          ) : null}
        </ScrollView>
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.icon,
  },
  headerTitle: { ...typography.h2, fontSize: 17, color: colors.textPrimary },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  pressed: { opacity: 0.92 },

  hero: { alignItems: 'center', gap: 6, paddingVertical: spacing.md },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 19,
    color: colors.textPrimary,
    marginTop: 4,
  },
  heroBody: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 17,
    maxWidth: 300,
  },

  sectionLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 1,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  input: {
    backgroundColor: colors.cream,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontFamily: fontFamilies.interMedium,
    fontSize: 14.5,
    color: colors.textPrimary,
  },
  radiiRow: { flexDirection: 'row', gap: spacing.sm },
  radChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.cream,
    alignItems: 'center',
  },
  radChipOn: { backgroundColor: colors.brand },
  radText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12, color: colors.textSecondary },
  radTextOn: { color: colors.textInverse },
  cta: {
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingVertical: 13,
    alignItems: 'center',
  },
  ctaText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14.5,
    color: colors.textInverse,
  },

  zoneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 6 },
  zoneIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoneName: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textPrimary },
  zoneSub: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary, marginTop: 1 },
  divider: { height: 1, backgroundColor: colors.divider },
  empty: { alignItems: 'center', paddingVertical: spacing.lg },
  emptyText: { ...typography.caption, fontSize: 12.5, color: colors.textMuted },
  footnote: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 15,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.xs,
  },
});
