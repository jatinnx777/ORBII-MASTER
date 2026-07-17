import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { appAlert } from '@/components/common';
import { MLMapView, type AvatarMarker } from '@/components/common/MLMapView';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { useReadiness } from '@/services/readiness';
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

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const profile = useAppSelector((s) => s.user.profile);
  const tier = profile?.premiumTier ?? null;
  const { pct } = useReadiness();

  const [me, setMe] = useState<GeoPoint | null>(null);
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => subscribePresence(setPeers), []);

  const loadMe = useCallback(async () => {
    try {
      setMe(await getFastLocation());
    } catch {
      // location off — the map centres on the circle instead
    }
  }, []);

  useFocusEffect(useCallback(() => { void loadMe(); }, [loadMe]));

  const circleUids = useMemo(
    () => new Set((profile?.friends ?? []).map((f) => f.uid).filter((u): u is string => !!u)),
    [profile?.friends],
  );

  const members = useMemo(() => {
    const online = new Map<string, PresencePeer>();
    for (const p of peers) if (circleUids.has(p.userId)) online.set(p.userId, p);
    return (profile?.friends ?? []).map((f) => {
      const live = f.uid ? online.get(f.uid) : undefined;
      return {
        uid: f.uid ?? f.username,
        name: (live?.name || f.name || f.username || 'Member') as string,
        photoUri: live?.photoUri ?? null,
        online: !!live,
      };
    });
  }, [peers, circleUids, profile?.friends]);

  const avatars = useMemo<AvatarMarker[]>(() => {
    const list: AvatarMarker[] = [];
    if (me) list.push({ id: 'me', coordinate: me, photoUri: profile?.photoUri ?? null, name: 'You' });
    for (const p of peers) {
      if (p.userId === profile?.uid || !circleUids.has(p.userId) || !p.location) continue;
      list.push({ id: p.userId, coordinate: p.location, photoUri: p.photoUri, name: p.name || 'Circle' });
    }
    return list;
  }, [me, peers, circleUids, profile?.uid, profile?.photoUri]);

  const respondersNearby = peers.filter((p) => p.isVerified && p.userId !== profile?.uid).length;
  const onlineCircle = avatars.length - (me ? 1 : 0);
  const firstName = (profile?.name ?? '').trim().split(' ')[0] || 'there';
  const greeting = greetingFor(new Date().getHours());

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMe();
    setRefreshing(false);
  }, [loadMe]);

  const onShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const res = await shareMyLocation();
      appAlert(
        res.ok ? 'Location shared' : "Couldn't share your location",
        res.ok
          ? res.contact
            ? `A maps link was sent to ${res.contact}, and your circle was notified.`
            : 'Your circle was notified with your location.'
          : res.error,
      );
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
          }
        >
          {/* ── Header ── */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.greeting}>
                {greeting}, {firstName}
              </Text>
              <View style={styles.activeRow}>
                <View style={styles.activeDot} />
                <Text style={styles.activeText}>ORBII is protecting you</Text>
              </View>
            </View>
            <Pressable onPress={() => navigation.navigate('Notifications')} style={styles.iconBtn} hitSlop={6} accessibilityLabel="Notifications">
              <Ionicons name="notifications-outline" size={20} color={colors.textPrimary} />
            </Pressable>
            <Pressable onPress={() => navigation.navigate('EditProfile')} accessibilityLabel="Your profile">
              {profile?.photoUri ? (
                <Image source={{ uri: profile.photoUri }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitial}>{firstName.charAt(0).toUpperCase()}</Text>
                </View>
              )}
            </Pressable>
          </View>

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
                  {onlineCircle > 0 ? `${onlineCircle} in your circle online` : 'Your circle appears here when online'}
                </Text>
              </View>
            </View>
          </View>

          {/* ── Score + circle ── */}
          <View style={styles.midRow}>
            <ScoreRing pct={pct} onPress={() => navigation.navigate('SafetyReadiness')} />
            <CircleStrip members={members} onPress={() => navigation.navigate('Circles')} />
          </View>

          {/* ── Uniform quick-action grid ── */}
          <View style={styles.grid}>
            <QuickTile
              icon="pulse-outline"
              label="Helpers online"
              hint={`${respondersNearby} nearby`}
              badge
              onPress={() => navigation.navigate('CommunityAlerts')}
            />
            <QuickTile icon="call-outline" label="Fake call" hint="Escape a moment" onPress={() => comingSoon('Fake call')} />
            <QuickTile icon="navigate-outline" label="Safe journey" hint="Watched travel" onPress={() => navigation.navigate('SafeJourneyStart')} />
            <QuickTile icon="recording-outline" label="Recordings" hint="Your evidence" onPress={() => navigation.navigate('Recordings')} />
          </View>

          {/* ── Share location ── */}
          <Pressable
            onPress={onShare}
            disabled={sharing}
            style={({ pressed }) => [styles.shareBtn, (sharing || pressed) && { opacity: 0.9 }]}
            accessibilityLabel="Share my live location"
          >
            <Ionicons name="paper-plane" size={18} color={colors.textInverse} />
            <Text style={styles.shareText}>{sharing ? 'Sharing…' : 'Share my live location'}</Text>
          </Pressable>

          {/* ── Premium (tier-aware) ── */}
          {tier !== 'family' ? (
            <Pressable
              onPress={() => navigation.navigate('PremiumUpgrade')}
              style={({ pressed }) => [styles.proCard, pressed && styles.pressed]}
              accessibilityLabel={tier === 'plus' ? 'Upgrade to Family' : 'Upgrade to Plus'}
            >
              <View style={styles.proIcon}>
                <Ionicons name="sparkles" size={17} color={colors.goldDeep} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.proTitle}>
                  {tier === 'plus' ? 'Upgrade to ORBII Family' : 'Go Pro with ORBII Plus'}
                </Text>
                <Text style={styles.proSub}>
                  {tier === 'plus' ? 'Protect up to 4 people you love.' : 'Verified helpers reach you, not just your circle.'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.goldDeep} />
            </Pressable>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function QuickTile({
  icon,
  label,
  hint,
  badge,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  hint: string;
  badge?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.tileIcon}>
        <Ionicons name={icon} size={19} color={colors.brandDeep} />
        {badge ? <View style={styles.livePulse} /> : null}
      </View>
      <Text style={styles.tileLabel} numberOfLines={1}>{label}</Text>
      <Text style={styles.tileHint} numberOfLines={1}>{hint}</Text>
    </Pressable>
  );
}

function ScoreRing({ pct, onPress }: { pct: number; onPress: () => void }) {
  const size = 120;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.scoreCard, pressed && styles.pressed]} accessibilityLabel={`Protection score ${pct} percent`}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={{ position: 'absolute' }}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.creamDeep} strokeWidth={stroke} fill="none" />
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.brand} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${dash} ${circ}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        </Svg>
        <Text style={styles.scoreNum}>{pct}</Text>
        <Text style={styles.scoreUnit}>protected</Text>
      </View>
    </Pressable>
  );
}

function CircleStrip({
  members,
  onPress,
}: {
  members: { uid: string; name: string; photoUri: string | null; online: boolean }[];
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.circleCard, pressed && styles.pressed]} accessibilityLabel="Your circle">
      <Text style={styles.circleTitle}>Your circle</Text>
      {members.length === 0 ? (
        <View style={styles.circleEmpty}>
          <Ionicons name="person-add-outline" size={20} color={colors.brandDeep} />
          <Text style={styles.circleEmptyText}>Add the people you trust</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
          {members.slice(0, 8).map((m) => (
            <View key={m.uid} style={styles.member}>
              <View style={[styles.memberRing, { borderColor: m.online ? colors.sage : colors.creamDeep }]}>
                {m.photoUri ? (
                  <Image source={{ uri: m.photoUri }} style={styles.memberImg} />
                ) : (
                  <View style={styles.memberFallback}>
                    <Text style={styles.memberInitial}>{m.name.charAt(0).toUpperCase()}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.memberName} numberOfLines={1}>{m.name.split(' ')[0]}</Text>
              <Text style={[styles.memberState, { color: m.online ? colors.sageDeep : colors.textMuted }]}>
                {m.online ? 'Safe' : 'Offline'}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingTop: spacing.xs },
  pressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm },
  greeting: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textPrimary,
    letterSpacing: -0.4,
  },
  activeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  activeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.sage },
  activeText: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary },
  iconBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', ...shadows.icon,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.creamDeep },
  avatarFallback: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontFamily: fontFamilies.poppinsBold, fontSize: 17, color: colors.brandDeep },

  mapCard: { height: 210, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.creamDeep, ...shadows.card },
  map: { flex: 1 },
  mapOverlay: { position: 'absolute', left: 0, right: 0, top: 0, alignItems: 'center', padding: spacing.sm },
  mapPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface,
    paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, ...shadows.icon,
  },
  mapPillText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 11.5, color: colors.textPrimary },

  midRow: { flexDirection: 'row', gap: spacing.md },
  scoreCard: {
    backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.md,
    alignItems: 'center', justifyContent: 'center', ...shadows.card,
  },
  scoreNum: { fontFamily: fontFamilies.poppinsBold, fontSize: 32, color: colors.textPrimary, lineHeight: 36 },
  scoreUnit: { ...typography.caption, fontSize: 11, color: colors.textSecondary, marginTop: -2 },
  circleCard: {
    flex: 1, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.md,
    gap: spacing.sm, justifyContent: 'center', ...shadows.card,
  },
  circleTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13.5, color: colors.textPrimary },
  circleEmpty: { alignItems: 'center', gap: 6, paddingVertical: spacing.md },
  circleEmptyText: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary, textAlign: 'center' },
  member: { alignItems: 'center', width: 56 },
  memberRing: { width: 50, height: 50, borderRadius: 25, borderWidth: 2.5, padding: 2, alignItems: 'center', justifyContent: 'center' },
  memberImg: { width: '100%', height: '100%', borderRadius: 22 },
  memberFallback: { width: '100%', height: '100%', borderRadius: 22, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  memberInitial: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.brandDeep },
  memberName: { fontFamily: fontFamilies.interMedium, fontSize: 11, color: colors.textPrimary, marginTop: 4 },
  memberState: { ...typography.caption, fontSize: 9.5 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: {
    flexGrow: 1, flexBasis: '46%', backgroundColor: colors.surface, borderRadius: radius.xl,
    padding: spacing.md, gap: 6, ...shadows.card,
  },
  tileIcon: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandSoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: 2,
  },
  livePulse: {
    position: 'absolute', top: 6, right: 6, width: 9, height: 9, borderRadius: 5,
    backgroundColor: colors.sage, borderWidth: 1.5, borderColor: colors.surface,
  },
  tileLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textPrimary },
  tileHint: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary },

  shareBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.brand, borderRadius: radius.pill, paddingVertical: 15, ...shadows.card,
  },
  shareText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: colors.textInverse },

  proCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.goldSoft,
    borderRadius: radius.xl, padding: spacing.md,
  },
  proIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  proTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 14, color: colors.textPrimary },
  proSub: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary, marginTop: 1 },
});
