import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { appAlert } from '@/components/common';
import { MLMapView, type AvatarMarker } from '@/components/common/MLMapView';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { useReadiness, READINESS_CAP } from '@/services/readiness';
import { subscribePresence, type PresencePeer } from '@/services/community';
import { getFastLocation } from '@/services/location';
import { shareMyLocation } from '@/services/location-share';
import { comingSoon } from '@/services/coming-soon';
import type { GeoPoint } from '@/types';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

function greetingFor(hour: number): string {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

// Nearby-place categories. Tapping one opens the phone's own maps app searching
// for that category around the user. Real and free — no places API, no ₹ cost.
const PLACES = [
  { key: 'police', label: 'Police', icon: 'shield-outline' as const, query: 'police station' },
  { key: 'hospital', label: 'Hospital', icon: 'medkit-outline' as const, query: 'hospital' },
  { key: 'cafe', label: 'Cafe', icon: 'cafe-outline' as const, query: 'cafe' },
  { key: 'metro', label: 'Metro', icon: 'train-outline' as const, query: 'metro station' },
];

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const profile = useAppSelector((s) => s.user.profile);
  const alerts = useAppSelector((s) => s.community.alerts);
  const tier = profile?.premiumTier ?? null; // null | 'plus' | 'family'
  const { pct, doneCount, total, reload } = useReadiness();

  const [me, setMe] = useState<GeoPoint | null>(null);
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [sharing, setSharing] = useState(false);

  // uids of my circle (friends) — the only peers I plot.
  const circleUids = useMemo(
    () =>
      new Set(
        (profile?.friends ?? [])
          .map((f) => f.uid)
          .filter((u): u is string => !!u),
      ),
    [profile?.friends],
  );

  useEffect(() => subscribePresence(setPeers), []);

  const loadMe = useCallback(async () => {
    try {
      setMe(await getFastLocation());
    } catch {
      // location off — the map just centres on the circle instead
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
      void loadMe();
    }, [reload, loadMe]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    reload();
    await loadMe();
    setRefreshing(false);
  }, [reload, loadMe]);

  // Map avatars: me + online circle members who are sharing a location.
  const avatars = useMemo<AvatarMarker[]>(() => {
    const list: AvatarMarker[] = [];
    if (me) {
      list.push({
        id: 'me',
        coordinate: me,
        photoUri: profile?.photoUri ?? null,
        name: 'You',
      });
    }
    for (const p of peers) {
      if (p.userId === profile?.uid) continue;
      if (!circleUids.has(p.userId)) continue;
      if (!p.location) continue;
      list.push({
        id: p.userId,
        coordinate: p.location,
        photoUri: p.photoUri,
        name: p.name || 'Circle',
      });
    }
    return list;
  }, [me, peers, circleUids, profile?.uid, profile?.photoUri]);

  const onlineCircle = avatars.length - (me ? 1 : 0);
  const firstName = (profile?.name ?? '').trim().split(' ')[0] || 'there';
  const greeting = greetingFor(new Date().getHours());
  const setupDone = pct >= READINESS_CAP;
  const activeAlerts = alerts?.length ?? 0;
  const barColor = setupDone ? colors.sage : colors.brand;

  const openPlaces = (query: string) => {
    const near = me ? `${query} near ${me.latitude},${me.longitude}` : query;
    const url = `https://www.google.com/maps/search/${encodeURIComponent(near)}`;
    Linking.openURL(url).catch(() =>
      Linking.openURL(`geo:0,0?q=${encodeURIComponent(query)}`).catch(() => undefined),
    );
  };

  const onShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const res = await shareMyLocation();
      if (!res.ok) {
        appAlert("Couldn't share your location", res.error);
        return;
      }
      appAlert(
        'Location shared',
        res.contact
          ? `A maps link was sent to ${res.contact}, and your circle was notified.`
          : 'Your circle was notified with your location.',
      );
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 110 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
          }
        >
          {/* ── Header ── */}
          <View style={styles.header}>
            <Pressable
              onPress={() => navigation.navigate('EditProfile')}
              style={styles.headerLeft}
              accessibilityRole="button"
              accessibilityLabel="Your profile"
            >
              {profile?.photoUri ? (
                <Image source={{ uri: profile.photoUri }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitial}>{firstName.charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.greeting}>{greeting},</Text>
                <Text style={styles.name} numberOfLines={1}>
                  {firstName}
                </Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('Notifications')}
              style={styles.bell}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Notifications"
            >
              <Ionicons name="notifications-outline" size={21} color={colors.textPrimary} />
              {activeAlerts > 0 ? <View style={styles.bellDot} /> : null}
            </Pressable>
          </View>

          {/* ── Safety status ── */}
          <Pressable
            onPress={() => navigation.navigate('SafetyReadiness')}
            style={({ pressed }) => [styles.statusCard, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Your safety status, ${pct} percent`}
          >
            <View style={styles.statusTop}>
              <Text style={styles.statusTitle}>Your safety status</Text>
              <Text style={[styles.statusPct, { color: barColor }]}>{pct}% safe</Text>
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${Math.max(pct, 4)}%`, backgroundColor: barColor }]} />
            </View>
            <Text style={styles.statusHint}>
              {setupDone
                ? "You're fully set up and protected."
                : `${doneCount} of ${total} steps done. Tap to finish.`}
            </Text>
          </Pressable>

          {/* ── Live circle map ── */}
          <View style={styles.mapCard}>
            <MLMapView
              style={styles.map}
              center={me ?? avatars[0]?.coordinate}
              zoom={14}
              avatarMarkers={avatars}
              fitAll={avatars.length > 1}
              followUser={!!me && avatars.length <= 1}
              interactive
            />
            <View style={styles.mapOverlay} pointerEvents="none">
              <View style={styles.mapPill}>
                <Ionicons name="people" size={13} color={colors.brandDeep} />
                <Text style={styles.mapPillText}>
                  {onlineCircle > 0
                    ? `${onlineCircle} in your circle online`
                    : 'Your circle appears here when online'}
                </Text>
              </View>
            </View>
          </View>

          {/* ── Location sharing ── */}
          <Pressable
            onPress={onShare}
            disabled={sharing}
            style={({ pressed }) => [styles.shareBtn, (sharing || pressed) && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel="Share my location"
          >
            <Ionicons name="paper-plane" size={18} color={colors.textInverse} />
            <Text style={styles.shareText}>
              {sharing ? 'Sharing…' : 'Share my live location'}
            </Text>
          </Pressable>
          <Text style={styles.shareHint}>
            Texts your top emergency contact and pings your whole circle.
          </Text>

          {/* ── Nearby places ── */}
          <Text style={styles.sectionLabel}>NEARBY SAFE PLACES</Text>
          <View style={styles.placesRow}>
            {PLACES.map((p) => (
              <Pressable
                key={p.key}
                onPress={() => openPlaces(p.query)}
                style={({ pressed }) => [styles.placeTile, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Find nearby ${p.label}`}
              >
                <View style={styles.placeIcon}>
                  <Ionicons name={p.icon} size={19} color={colors.brandDeep} />
                </View>
                <Text style={styles.placeLabel}>{p.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* ── Active alerts ── */}
          <Pressable
            onPress={() => navigation.navigate('CommunityAlerts')}
            style={({ pressed }) => [styles.alertCard, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Active alerts"
          >
            <View style={[styles.alertIcon, activeAlerts > 0 && { backgroundColor: colors.coralSoft }]}>
              <Ionicons
                name={activeAlerts > 0 ? 'alert-circle' : 'shield-checkmark-outline'}
                size={20}
                color={activeAlerts > 0 ? colors.coralDeep : colors.sageDeep}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>
                {activeAlerts > 0
                  ? `${activeAlerts} active alert${activeAlerts > 1 ? 's' : ''} nearby`
                  : 'No active alerts'}
              </Text>
              <Text style={styles.alertSub}>View all alerts</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>

          {/* ── Premium upsell. Tier-aware: free users see "Go Pro", Plus users
              see the upgrade to Family, and Family users see nothing (they
              already have the top plan, so an ad would just annoy them). ── */}
          {tier !== 'family' ? (
            <Pressable
              onPress={() => navigation.navigate('PremiumUpgrade')}
              style={({ pressed }) => [styles.proCard, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={tier === 'plus' ? 'Upgrade to ORBII Family' : 'Upgrade to ORBII Plus'}
            >
              <View style={styles.proIcon}>
                <Ionicons name="sparkles" size={18} color={colors.goldDeep} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.proTitle}>
                  {tier === 'plus' ? 'Upgrade to ORBII Family' : 'Go Pro with ORBII Plus'}
                </Text>
                <Text style={styles.proSub}>
                  {tier === 'plus'
                    ? 'Protect up to 4 people you love on one plan.'
                    : 'Verified helpers reach you, not just your circle.'}
                </Text>
              </View>
              <View style={styles.proBtn}>
                <Text style={styles.proBtnText}>Upgrade</Text>
              </View>
            </Pressable>
          ) : null}

          {/* ── Quick actions ── */}
          <View style={styles.grid}>
            <QuickTile
              icon="call-outline"
              label="Fake call"
              hint="Escape risky moments"
              onPress={() => comingSoon('Fake call')}
            />
            <QuickTile
              icon="people-outline"
              label="Community"
              hint="Share & support"
              onPress={() => navigation.navigate('CommunityFeed')}
            />
            <QuickTile
              icon="navigate-outline"
              label="Location sharing"
              hint="Send your live spot"
              onPress={onShare}
            />
            <QuickTile
              icon="recording-outline"
              label="Record evidence"
              hint="Your SOS recordings"
              onPress={() => navigation.navigate('Recordings')}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function QuickTile({
  icon,
  label,
  hint,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  hint: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.quickTile, pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.quickIcon}>
        <Ionicons name={icon} size={20} color={colors.brandDeep} />
      </View>
      <Text style={styles.quickLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.quickHint} numberOfLines={1}>
        {hint}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  quickTile: {
    flexGrow: 1,
    flexBasis: '46%',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: 6,
    ...shadows.card,
  },
  quickIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  quickLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textPrimary },
  quickHint: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.md },
  pressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.creamDeep },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontFamily: fontFamilies.poppinsBold, fontSize: 17, color: colors.brandDeep },
  greeting: { ...typography.caption, fontSize: 12.5, color: colors.textSecondary },
  name: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 19,
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  bell: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.icon,
  },
  bellDot: {
    position: 'absolute',
    top: 11,
    right: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.coral,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },

  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  statusTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary },
  statusPct: { fontFamily: fontFamilies.poppinsBold, fontSize: 15 },
  barTrack: { height: 9, borderRadius: 5, backgroundColor: colors.creamDeep, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 5 },
  statusHint: { ...typography.caption, fontSize: 12, color: colors.textSecondary },

  mapCard: {
    height: 230,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.creamDeep,
    ...shadows.card,
  },
  map: { flex: 1 },
  mapOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    alignItems: 'center',
    padding: spacing.sm,
  },
  mapPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    ...shadows.icon,
  },
  mapPillText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 11.5, color: colors.textPrimary },

  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingVertical: 15,
    ...shadows.card,
  },
  shareText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: colors.textInverse },
  shareHint: {
    ...typography.caption,
    fontSize: 11.5,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: -spacing.xs,
  },

  sectionLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: -spacing.xs,
  },
  placesRow: { flexDirection: 'row', gap: spacing.sm },
  placeTile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: 7,
    ...shadows.card,
  },
  placeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12, color: colors.textPrimary },

  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    ...shadows.card,
  },
  alertIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.sageSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14.5, color: colors.textPrimary },
  alertSub: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: 1 },

  proCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.goldSoft,
    borderRadius: radius.xl,
    padding: spacing.md,
  },
  proIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 14.5, color: colors.textPrimary },
  proSub: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary, marginTop: 1 },
  proBtn: {
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  proBtnText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.textInverse },

  learnCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  learnTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  learnIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  learnTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14.5, color: colors.textPrimary },
  learnSub: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary, marginTop: 1 },
  learnPct: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: colors.brandDeep },
  learnBarTrack: { height: 7, borderRadius: 4, backgroundColor: colors.creamDeep, overflow: 'hidden' },
  learnBarFill: { height: '100%', borderRadius: 4, backgroundColor: colors.brand },
});
