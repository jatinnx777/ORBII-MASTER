import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appAlert } from '@/components/common';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { EmptyState, MascotLoader, ScreenContainer } from '@/components/common';
import { CirclesHero } from './components/CirclesHero';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import {
  refreshCircles,
  setActiveCircle,
} from '@/services/circles-bootstrap';
import {
  acceptInvite,
  declineInvite,
  type Circle,
  type CircleInvite,
  type CircleKind,
} from '@/services/circles';
import { inviteResolved } from '@/redux/slices/circlesSlice';
import { isCircleSharing, startCircleSharing } from '@/services/circle-location';
import { useIsPremium } from '@/services/entitlements';
import { promptUpgrade } from '@/services/paywall';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '@/theme';
import type { AppStackParamList } from '@/navigation/types';

// Circles tab — top-level list of every circle the user belongs to, plus
// any pending invites. Everything comes from Redux (server-backed); the
// only persisted local thing is the active-circle id.

type Nav = NativeStackNavigationProp<AppStackParamList>;

const KIND_META: Record<
  CircleKind,
  { icon: React.ComponentProps<typeof Ionicons>['name']; label: string }
> = {
  family: { icon: 'home', label: 'Family' },
  friends: { icon: 'people', label: 'Friends' },
  trip: { icon: 'airplane', label: 'Trip' },
  college: { icon: 'school', label: 'College' },
  women: { icon: 'female', label: 'Women' },
  emergency: { icon: 'alert-circle', label: 'Emergency' },
  general: { icon: 'people-circle', label: 'Circle' },
};

export function CirclesScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const isPremium = useIsPremium();

  // Family Circle creation is an ORBII Plus feature — the circle owner must be
  // a subscriber. Joining a circle (via invite) stays free.
  const handleCreatePress = () => {
    if (!isPremium) {
      promptUpgrade({
        feature: 'Family Circles',
        body:
          'Creating a Family Circle is part of ORBII Plus (₹99/month). The ' +
          'circle owner needs Plus. Members you invite join for free.',
        onUpgrade: () => navigation.navigate('PremiumUpgrade'),
      });
      return;
    }
    navigation.navigate('CircleCreate');
  };
  const insets = useSafeAreaInsets();
  const { circles, incomingInvites, activeCircleId, status, error, setupNeeded } =
    useAppSelector((s) => s.circles);
  const profile = useAppSelector((s) => s.user.profile);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refreshCircles();
    }, []),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshCircles();
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleSelect = useCallback(
    (circle: Circle) => {
      setActiveCircle(circle.id);
      navigation.navigate('CircleDetail', { circleId: circle.id });
    },
    [navigation],
  );

  // On joining a circle, offer to turn on live location so the circle can see
  // her on the map right away. Asked once (skipped if already sharing); the
  // system location permission is requested inside startCircleSharing.
  const promptEnableSharing = useCallback(async () => {
    try {
      if (await isCircleSharing()) return;
    } catch {
      // fall through and still offer
    }
    appAlert(
      'Share your live location?',
      'Let this circle see where you are on the live map, so they can reach you fast if something goes wrong. You can turn it off any time.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Turn on',
          onPress: () => {
            void startCircleSharing().then((ok) => {
              if (!ok) {
                appAlert(
                  'Location permission needed',
                  'To share your live location, allow ORBII to access your location in Settings, then turn it on from the Circle map.',
                );
              }
            });
          },
        },
      ],
    );
  }, []);

  const handleAccept = useCallback(
    async (invite: CircleInvite) => {
      try {
        await acceptInvite(invite);
        dispatch(inviteResolved(invite.id));
        await refreshCircles();
        await setActiveCircle(invite.circleId);
        void promptEnableSharing();
      } catch (err) {
        appAlert(
          'Could not accept',
          err instanceof Error ? err.message : 'Something went wrong.',
        );
      }
    },
    [dispatch, promptEnableSharing],
  );

  const handleDecline = useCallback(
    async (invite: CircleInvite) => {
      try {
        await declineInvite(invite.id);
        dispatch(inviteResolved(invite.id));
      } catch (err) {
        appAlert(
          'Could not decline',
          err instanceof Error ? err.message : 'Something went wrong.',
        );
      }
    },
    [dispatch],
  );

  const data = useMemo(() => circles, [circles]);

  const hasContent = data.length > 0 || incomingInvites.length > 0;

  return (
    <ScreenContainer padded={false} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={10}
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressedScale]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Circles</Text>
          <Text style={styles.subtitle}>
            Trusted people who get your SOS and share live location with you, 24/7.
          </Text>
        </View>
        <Pressable
          onPress={handleCreatePress}
          style={({ pressed }) => [
            styles.addBtn,
            pressed && styles.pressedScale,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Create circle"
          hitSlop={8}
        >
          <Ionicons name="add" size={22} color={colors.textPrimary} />
        </Pressable>
      </View>

      {!profile ? (
        <View style={styles.center}>
          <EmptyState
            icon="lock-closed-outline"
            title="Sign in to use circles"
            body="Circles share your live location with people you trust. You'll need to be signed in."
          />
        </View>
      ) : setupNeeded ? (
        <View style={styles.center}>
          <View style={styles.setupCard}>
            <View style={styles.setupIcon}>
              <Ionicons name="server-outline" size={20} color={colors.brandDeep} />
            </View>
            <Text style={styles.setupTitle}>Backend setup needed</Text>
            <Text style={styles.setupBody}>
              The circles tables aren't installed on this Supabase project
              yet. Open Supabase → SQL Editor → paste the contents of{' '}
              <Text style={styles.setupCode}>sql/09_circles.sql</Text> → Run.
            </Text>
            <Pressable
              onPress={() => refreshCircles()}
              style={({ pressed }) => [
                styles.setupRetry,
                pressed && styles.pressedScale,
              ]}
              accessibilityRole="button"
            >
              <Ionicons name="refresh" size={14} color={colors.brandDeep} />
              <Text style={styles.setupRetryText}>I've run it, retry</Text>
            </Pressable>
          </View>
        </View>
      ) : status === 'loading' && !hasContent ? (
        <View style={styles.center}>
          <MascotLoader message="Loading your circles…" />
        </View>
      ) : status === 'errored' && !hasContent ? (
        <View style={styles.center}>
          <EmptyState
            icon="cloud-offline-outline"
            title="Could not load circles"
            body={error ?? 'Check your connection and try again.'}
            actionLabel="Retry"
            onAction={() => refreshCircles()}
          />
        </View>
      ) : !hasContent ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.emptyWrap,
            { paddingBottom: insets.bottom + 32 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <CirclesHero size={160} />
          <Text style={styles.emptyTitle}>Your circle starts here</Text>
          <Text style={styles.emptyBody}>
            Add family or friends. They get your SOS instantly, and you both
            share live location 24/7, just with each other.
          </Text>
          <CircleExplainer />
          <Pressable
            onPress={handleCreatePress}
            style={({ pressed }) => [
              styles.emptyCta,
              pressed && styles.pressedScale,
            ]}
            accessibilityRole="button"
          >
            <Ionicons name="add" size={16} color={colors.textPrimary} />
            <Text style={styles.emptyCtaText}>Create your first circle</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <CircleRow
              circle={item}
              isActive={item.id === activeCircleId}
              onPress={() => handleSelect(item)}
            />
          )}
          contentContainerStyle={{
            paddingHorizontal: spacing.md,
            paddingBottom: insets.bottom + 96,
            gap: spacing.sm,
          }}
          ListHeaderComponent={
            <View style={styles.invitesWrap}>
              <Text style={styles.sectionLabel}>Circle tools</Text>
              <Pressable
                onPress={() => navigation.navigate('Geofences')}
                style={({ pressed }) => [styles.zonesRow, pressed && styles.pressedScale]}
                accessibilityRole="button"
                accessibilityLabel="Geofencing"
              >
                <View style={styles.zonesIcon}>
                  <Ionicons name="locate" size={18} color={colors.goldDeep} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.zonesTitle}>Geofencing</Text>
                  <Text style={styles.zonesSub}>Draw a safe area, get told if someone leaves it.</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>
              <Pressable
                onPress={() => navigation.navigate('CircleMap')}
                style={({ pressed }) => [styles.zonesRow, pressed && styles.pressedScale]}
                accessibilityRole="button"
                accessibilityLabel="Live location map"
              >
                <View style={[styles.zonesIcon, { backgroundColor: colors.sageSoft }]}>
                  <Ionicons name="map" size={18} color={colors.sageDeep} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.zonesTitle}>Live location map</Text>
                  <Text style={styles.zonesSub}>See everyone in your circle on one live map.</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </Pressable>
              {incomingInvites.length > 0 ? (
                <>
                  <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>
                    Pending invites
                  </Text>
                  {incomingInvites.map((invite) => (
                    <InviteRow
                      key={invite.id}
                      invite={invite}
                      onAccept={() => handleAccept(invite)}
                      onDecline={() => handleDecline(invite)}
                    />
                  ))}
                </>
              ) : null}
              <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>
                Your circles
              </Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.brandDeep}
            />
          }
        />
      )}
    </ScreenContainer>
  );
}

// Explains what a circle actually does, in the user's own framing:
// trusted people who receive your SOS and share live location both ways.
function CircleExplainer() {
  const rows: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    bg: string;
    fg: string;
    title: string;
    body: string;
  }[] = [
    {
      icon: 'notifications',
      bg: colors.coralSoft,
      fg: colors.coral,
      title: 'They get your SOS',
      body: 'Everyone in the circle is alerted the instant you trigger an emergency.',
    },
    {
      icon: 'location',
      bg: colors.sageSoft,
      fg: colors.sageDeep,
      title: 'Live location, both ways',
      body: 'You and your circle can see each other on the map 24/7, only if you each allow it.',
    },
    {
      icon: 'lock-closed',
      bg: colors.lavenderSoft,
      fg: colors.lavenderDeep,
      title: 'Only people you invite',
      body: 'Circles are private. Nothing is ever public, and you can leave anytime.',
    },
  ];
  return (
    <View style={styles.explainer}>
      {rows.map((r, i) => (
        <View key={r.title} style={[styles.explainerRow, i > 0 && styles.explainerDivider]}>
          <View style={[styles.explainerIcon, { backgroundColor: r.bg }]}>
            <Ionicons name={r.icon} size={18} color={r.fg} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.explainerTitle}>{r.title}</Text>
            <Text style={styles.explainerBody}>{r.body}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function CircleRow({
  circle,
  isActive,
  onPress,
}: {
  circle: Circle;
  isActive: boolean;
  onPress: () => void;
}) {
  const meta = KIND_META[circle.kind] ?? KIND_META.general;
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter]);

  const translateY = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [8, 0],
  });

  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY }] }}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          isActive && styles.rowActive,
          pressed && styles.pressedScale,
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Open ${circle.name}`}
      >
        <View
          style={[
            styles.rowIcon,
            { backgroundColor: tint(circle.color, 0.16) },
          ]}
        >
          {circle.emoji ? (
            <Text style={styles.rowEmoji}>{circle.emoji}</Text>
          ) : (
            <Ionicons name={meta.icon} size={20} color={circle.color} />
          )}
        </View>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {circle.name}
          </Text>
          <View style={styles.rowMetaRow}>
            <View style={[styles.kindPill, { backgroundColor: tint(circle.color, 0.14) }]}>
              <Ionicons name={meta.icon} size={11} color={circle.color} />
              <Text style={[styles.kindPillText, { color: circle.color }]}>{meta.label}</Text>
            </View>
            {circle.isDefault ? <Text style={styles.defaultText}>Default</Text> : null}
          </View>
        </View>
        {isActive ? (
          <View style={styles.activeChip}>
            <View style={styles.activeDot} />
            <Text style={styles.activeChipText}>Active</Text>
          </View>
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        )}
      </Pressable>
    </Animated.View>
  );
}

function InviteRow({
  invite,
  onAccept,
  onDecline,
}: {
  invite: CircleInvite;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <View style={styles.inviteRow}>
      <View style={styles.inviteIcon}>
        <Ionicons name="mail-outline" size={18} color={colors.brandDeep} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.inviteTitle}>You've been invited</Text>
        <Text style={styles.inviteSubtitle} numberOfLines={1}>
          Join a circle to share live safety with the people who sent it.
        </Text>
      </View>
      <Pressable
        onPress={onDecline}
        style={({ pressed }) => [styles.inviteSecondary, pressed && styles.pressedScale]}
        accessibilityRole="button"
        accessibilityLabel="Decline"
      >
        <Text style={styles.inviteSecondaryText}>Decline</Text>
      </Pressable>
      <Pressable
        onPress={onAccept}
        style={({ pressed }) => [styles.invitePrimary, pressed && styles.pressedScale]}
        accessibilityRole="button"
        accessibilityLabel="Accept"
      >
        <Text style={styles.invitePrimaryText}>Accept</Text>
      </Pressable>
    </View>
  );
}

// Soft tint of a hex colour. Used to seed each circle's icon background
// from its accent colour without storing a second hex.
function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  title: {
    ...typography.h2,
    color: colors.textPrimary,
    letterSpacing: -0.4,
  },
  subtitle: {
    ...typography.body,
    fontSize: 13.5,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 19,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.icon,
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.peach,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  pressedScale: {
    opacity: 0.92,
    transform: [{ scale: 0.97 }],
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  emptyWrap: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  emptyTitle: {
    ...typography.h2,
    color: colors.textPrimary,
    letterSpacing: -0.4,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  emptyBody: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 20,
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.peach,
    marginTop: spacing.lg,
    ...shadows.card,
  },
  emptyCtaText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13.5,
    color: colors.textPrimary,
    letterSpacing: 0.3,
  },
  explainer: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.md,
    ...shadows.card,
  },
  explainerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  explainerDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  explainerIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  explainerTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  explainerBody: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
    marginTop: 1,
  },
  setupCard: {
    borderRadius: radius.lg,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: 360,
    ...shadows.card,
  },
  setupIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  setupTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textPrimary,
    marginTop: 4,
  },
  setupBody: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
  },
  setupCode: {
    fontFamily: fontFamilies.poppinsBold,
    color: colors.brandDeep,
  },
  setupRetry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.circle,
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.brandMid,
    marginTop: 4,
  },
  setupRetryText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 12,
    color: colors.brandDeep,
    letterSpacing: 0.2,
  },
  sectionLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  invitesWrap: {
    paddingBottom: spacing.sm,
  },
  zonesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  zonesIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zonesTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14.5, color: colors.textPrimary },
  zonesSub: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    ...shadows.card,
  },
  rowActive: {
    borderColor: colors.brandMid,
    backgroundColor: colors.brandSoft,
  },
  rowIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowEmoji: { fontSize: 22 },
  rowTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 15.5,
    color: colors.textPrimary,
    letterSpacing: -0.1,
  },
  rowMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kindPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  kindPillText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 11,
    letterSpacing: 0.1,
  },
  defaultText: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 11.5,
    color: colors.textMuted,
  },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.circle,
    backgroundColor: colors.brandDeep,
  },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textInverse },
  activeChipText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 10,
    color: colors.textInverse,
    letterSpacing: 0.6,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 20,
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.brandMid,
    marginBottom: spacing.sm,
  },
  inviteIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13.5,
    color: colors.textPrimary,
  },
  inviteSubtitle: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 11.5,
    color: colors.textSecondary,
  },
  inviteSecondary: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.circle,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  inviteSecondaryText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12,
    color: colors.textPrimary,
  },
  invitePrimary: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.circle,
    backgroundColor: colors.peach,
  },
  invitePrimaryText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 12,
    color: colors.textPrimary,
    letterSpacing: 0.3,
  },
});
