import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appAlert } from '@/components/common';
import {
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
import { EmptyState, MascotLoader, ScreenContainer, SyncBar } from '@/components/common';
import { FREE_CIRCLE_LIMIT } from '@/services/entitlements';
import { JoinByCodeSheet } from '@/components/circles/JoinByCodeSheet';
import { CheckInSheet } from '@/components/circles/CheckInSheet';
import { PrecisionSheet } from '@/components/circles/PrecisionSheet';
import * as Clipboard from 'expo-clipboard';
import {
  loadFeed,
  myLocationPrecision,
  PRECISION_OPTIONS,
  type FeedEntry,
} from '@/services/circle-feed';
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

// Circles tab, top-level list of every circle the user belongs to, plus
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

  // Family Circle creation is an ORBII Plus feature, the circle owner must be
  // a subscriber. Joining a circle (via invite) stays free.
  const insets = useSafeAreaInsets();
  // `revalidating` is a background refresh over a list that is already
  // rendered. This screen was already careful not to blank on one (see the
  // `!hasContent` guards below); the sync line is the missing half, so the
  // refresh is visible rather than completely silent.
  const { circles, incomingInvites, activeCircleId, status, revalidating, error, setupNeeded } =
    useAppSelector((s) => s.circles);
  const profile = useAppSelector((s) => s.user.profile);
  const [refreshing, setRefreshing] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [precisionOpen, setPrecisionOpen] = useState(false);
  const [precision, setPrecision] = useState<number | null>(null);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [codeCopied, setCodeCopied] = useState(false);

  // The FIRST circle is free. A safety app whose first screen is a
  // subscription page is an app nobody finishes setting up, and a circle with
  // nobody in it protects nobody.
  //
  // Counted on circles you OWN, not circles you are in. Being on your mother's
  // list has never cost anything and is not about to.
  const owned = circles.filter((c) => c.ownerId === profile?.uid).length;
  const handleCreatePress = () => {
    if (!isPremium && owned >= FREE_CIRCLE_LIMIT) {
      promptUpgrade({
        feature: 'More circles',
        body:
          'Your first circle is free. A second one is part of ORBII Plus ' +
          '(₹149/month). Everyone you invite joins for free, however many ' +
          'circles you have.',
        onUpgrade: () => navigation.navigate('PremiumUpgrade'),
      });
      return;
    }
    navigation.navigate('CircleCreate');
  };

  // The circle every quick action on this screen applies to. Falls back to the
  // first one, because a screen whose buttons do nothing until you have made a
  // selection you were never asked to make is worse than a sensible default.
  const activeCircle = useMemo(
    () => circles.find((c) => c.id === activeCircleId) ?? circles[0] ?? null,
    [circles, activeCircleId],
  );

  const refreshFeed = useCallback(async (circleId: string | null) => {
    if (!circleId) {
      setFeed([]);
      return;
    }
    setFeed(await loadFeed(circleId, 6));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshCircles();
    }, []),
  );

  // Feed and precision are read on focus rather than on mount, because both
  // change from other screens: a check-in can come from a notification, and the
  // radius is also reachable from Settings.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void refreshFeed(activeCircle?.id ?? null);
      void myLocationPrecision().then((m) => {
        if (alive) setPrecision(m);
      });
      return () => {
        alive = false;
      };
    }, [activeCircle?.id, refreshFeed]),
  );

  const copyCode = useCallback(async () => {
    if (!activeCircle?.joinCode) return;
    await Clipboard.setStringAsync(activeCircle.joinCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 1800);
  }, [activeCircle?.joinCode]);

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
      <SyncBar active={revalidating} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        {/* No back button. This is a tab root now, and goBack() from here
            either does nothing or pops the tab navigator out from under her. */}
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Circles</Text>
          <Text style={styles.subtitle}>
            Trusted people who get your SOS and share live location with you, 24/7.
          </Text>
        </View>
        <View style={styles.headerActions}>
          {/* Join is deliberately not gated. Creating a circle is the paid
              thing; joining one somebody else made has always been free, and
              putting a paywall between a woman and her family's circle would
              be the worst possible place to put one. */}
          <Pressable
            onPress={() => setJoinOpen(true)}
            style={({ pressed }) => [styles.joinBtn, pressed && styles.pressedScale]}
            accessibilityRole="button"
            accessibilityLabel="Join a circle with a code"
            hitSlop={8}
          >
            <Ionicons name="enter-outline" size={17} color={colors.brandDeep} />
            <Text style={styles.joinBtnText}>Join</Text>
          </Pressable>
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
      </View>

      <CheckInSheet
        visible={checkInOpen}
        circleId={activeCircle?.id ?? null}
        onClose={() => setCheckInOpen(false)}
        onDone={() => {
          setCheckInOpen(false);
          void refreshFeed(activeCircle?.id ?? null);
        }}
      />

      <PrecisionSheet
        visible={precisionOpen}
        current={precision}
        onClose={() => setPrecisionOpen(false)}
        onChanged={setPrecision}
      />

      <JoinByCodeSheet
        visible={joinOpen}
        onClose={() => setJoinOpen(false)}
        onJoined={(id) => {
          setJoinOpen(false);
          void refreshCircles().then(() => setActiveCircle(id));
          navigation.navigate('CircleDetail', { circleId: id });
        }}
      />

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
            <Text style={styles.setupTitle}>Circles are not available</Text>
            <Text style={styles.setupBody}>
              Something on our side is not set up correctly, so circles cannot
              load right now. This is not a problem with your phone or your
              connection. Your SOS still works.
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
              <Text style={styles.setupRetryText}>Try again</Text>
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
            { paddingBottom: insets.bottom + 96 },
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
              {/* The circle every quick action below applies to, its code ready
                  to read out, and the three things somebody actually opens this
                  tab to do. */}
              {activeCircle ? (
                <View style={[styles.activeCard, { borderColor: tint(activeCircle.color, 0.35) }]}>
                  <View style={styles.activeTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.activeName} numberOfLines={1}>
                        {activeCircle.name}
                      </Text>
                      <Text style={styles.activeSub}>
                        {precision === null
                          ? 'Sharing your exact position'
                          : `Sharing ${PRECISION_OPTIONS.find((o) => o.metres === precision)?.label.toLowerCase() ?? 'an area'}`}
                      </Text>
                    </View>
                    {activeCircle.joinCode ? (
                      <Pressable
                        onPress={copyCode}
                        style={({ pressed }) => [styles.codeChip, pressed && styles.pressedScale]}
                        accessibilityRole="button"
                        accessibilityLabel={`Join code ${activeCircle.joinCode}, tap to copy`}
                      >
                        <Text style={styles.codeText}>{activeCircle.joinCode}</Text>
                        <Ionicons
                          name={codeCopied ? 'checkmark' : 'copy-outline'}
                          size={14}
                          color={colors.brandDeep}
                        />
                      </Pressable>
                    ) : null}
                  </View>

                  <View style={styles.quickRow}>
                    <QuickAction
                      icon="hand-left-outline"
                      label="Check in"
                      onPress={() => setCheckInOpen(true)}
                    />
                    <QuickAction
                      icon="map-outline"
                      label="Map"
                      onPress={() => navigation.navigate('CircleMap')}
                    />
                    <QuickAction
                      icon="person-add-outline"
                      label="Invite"
                      onPress={() =>
                        navigation.navigate('CircleInvite', { circleId: activeCircle.id })
                      }
                    />
                  </View>
                </View>
              ) : null}

              {feed.length > 0 ? (
                <>
                  <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>Recent</Text>
                  <View style={styles.feedCard}>
                    {feed.map((e, i) => (
                      <View key={`${e.kind}_${e.ref ?? e.at}_${i}`}>
                        {i > 0 ? <View style={styles.feedDivider} /> : null}
                        <Pressable
                          onPress={() =>
                            navigation.navigate('TripReplay', {
                              userId: e.userId,
                              name: e.name ?? undefined,
                            })
                          }
                          style={({ pressed }) => [styles.feedRow, pressed && styles.pressedScale]}
                          accessibilityRole="button"
                          accessibilityLabel={`${e.name ?? 'Someone'}: ${e.body}`}
                        >
                          <View style={[styles.feedIcon, feedTone(e.kind)]}>
                            <Ionicons name={feedIcon(e.kind)} size={15} color={feedColor(e.kind)} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.feedName} numberOfLines={1}>
                              {e.name ?? 'Someone'}
                            </Text>
                            <Text style={styles.feedBody} numberOfLines={2}>
                              {e.body}
                            </Text>
                          </View>
                          <Text style={styles.feedAgo}>{ago(e.at)}</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}

              <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>Circle tools</Text>
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
              <Pressable
                onPress={() => setPrecisionOpen(true)}
                style={({ pressed }) => [styles.zonesRow, pressed && styles.pressedScale]}
                accessibilityRole="button"
                accessibilityLabel="Location precision"
              >
                <View style={[styles.zonesIcon, { backgroundColor: colors.lavenderSoft }]}>
                  <Ionicons name="contract" size={18} color={colors.lavenderDeep} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.zonesTitle}>Location precision</Text>
                  <Text style={styles.zonesSub}>
                    Share a neighbourhood instead of a doorway. An SOS always sends exact.
                  </Text>
                </View>
                <Text style={styles.zonesValue}>
                  {PRECISION_OPTIONS.find((o) => o.metres === precision)?.label ?? 'Exact'}
                </Text>
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

// One of the three things somebody opens this tab to do. Deliberately labelled:
// an icon alone makes a person guess, and guessing on a safety app is how a
// check-in becomes an SOS.
function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.quickAction, pressed && styles.pressedScale]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={19} color={colors.brandDeep} />
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

function feedIcon(kind: FeedEntry['kind']): React.ComponentProps<typeof Ionicons>['name'] {
  if (kind === 'sos') return 'alert-circle';
  if (kind === 'arrival') return 'location';
  return 'hand-left';
}

function feedColor(kind: FeedEntry['kind']): string {
  if (kind === 'sos') return colors.coralDeep;
  if (kind === 'arrival') return colors.sageDeep;
  return colors.lavenderDeep;
}

function feedTone(kind: FeedEntry['kind']): { backgroundColor: string } {
  if (kind === 'sos') return { backgroundColor: colors.coralSoft };
  if (kind === 'arrival') return { backgroundColor: colors.sageSoft };
  return { backgroundColor: colors.lavenderSoft };
}

// Short enough to sit at the end of a row without wrapping it. An exact
// timestamp is not what anybody wants from a list they are skimming.
function ago(at: number): string {
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
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
  activeCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    padding: spacing.md,
    gap: 12,
    marginBottom: spacing.sm,
  },
  activeTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  activeName: { fontFamily: fontFamilies.poppinsBold, fontSize: 17, color: colors.textPrimary },
  activeSub: {
    fontFamily: fontFamilies.poppinsRegular,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  codeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
  },
  codeText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    letterSpacing: 1.6,
    color: colors.brandDeep,
  },
  quickRow: { flexDirection: 'row', gap: 8 },
  quickAction: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
    paddingVertical: 11,
    borderRadius: radius.md,
    backgroundColor: colors.cream,
  },
  quickLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12, color: colors.textPrimary },

  feedCard: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' },
  feedDivider: { height: 1, backgroundColor: colors.border, marginLeft: 52 },
  feedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  feedIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  feedName: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13.5, color: colors.textPrimary },
  feedBody: {
    fontFamily: fontFamilies.poppinsRegular,
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  feedAgo: { fontFamily: fontFamilies.poppinsMedium, fontSize: 11.5, color: colors.textMuted },
  zonesValue: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12.5,
    color: colors.textSecondary,
  },

  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  joinBtnText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13.5,
    color: colors.brandDeep,
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
    fontSize: 13,
    color: colors.textMuted,
    letterSpacing: 0.1,
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
