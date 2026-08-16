import React, { useCallback, useEffect, useRef, useState } from 'react';
import { appAlert } from '@/components/common';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer } from '@/components/common';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import {
  alertReceived,
  alertsLoadFailed,
  alertsLoadStarted,
  alertsLoaded,
  respondingStarted,
  alertDismissed,
} from '@/redux/slices/communitySlice';
import {
  alertFromBroadcast,
  listNearbyAlerts,
  respondToAlert,
  subscribeToAlerts,
} from '@/services/community';
import { getCurrentLocation } from '@/services/location';
import { trackEvent } from '@/services/analytics';
import { formatDistance, formatEta } from '@/utils/geo';
import type { AppStackParamList } from '@/navigation/types';
import type { CommunityAlert } from '@/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

const REFRESH_INTERVAL_MS = 20_000;

export function CommunityAlertsScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);
  const { alerts, isLoading, error } = useAppSelector((s) => s.community);
  const [refreshing, setRefreshing] = useState(false);

  const viewerRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const profileRef = useRef(profile);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  const load = useCallback(async () => {
    try {
      dispatch(alertsLoadStarted());
      const point = await getCurrentLocation();
      viewerRef.current = point;
      const list = await listNearbyAlerts(point, 2, profile?.uid ?? null);
      dispatch(alertsLoaded(list));
      trackEvent('community_alerts_viewed', { count: list.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not load alerts.';
      dispatch(alertsLoadFailed(msg));
    } finally {
      setRefreshing(false);
    }
  }, [dispatch, profile?.uid]);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Realtime fan-in so this screen reflects brand-new alerts the moment
  // they're broadcast, without waiting for the 20s poll. The vibration is
  // handled globally in App.tsx so we don't double-buzz.
  const knownIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const sub = subscribeToAlerts({
      onAlert: (broadcast) => {
        const me = profileRef.current?.uid ?? null;
        // Premium gate: a free user's SOS (circleOnly) is for their circle
        // only, never list it for nearby strangers.
        const isFriend =
          !!me &&
          Array.isArray(broadcast.friendUids) &&
          broadcast.friendUids.includes(me);
        if (broadcast.circleOnly && !isFriend) return;
        const alert = alertFromBroadcast(broadcast, viewerRef.current, me);
        if (!alert) return;
        // Early access: show every alert here regardless of distance, so testers
        // and the first users actually see each other. A distance filter returns
        // once there are enough users for it to matter.
        dispatch(alertReceived(alert));
        if (!knownIdsRef.current.has(alert.id)) {
          knownIdsRef.current.add(alert.id);
        }
      },
    });
    return () => sub.unsubscribe();
  }, [dispatch]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const handleRespond = (alertItem: CommunityAlert) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
      () => undefined,
    );
    appAlert(
      "You're about to help",
      `Navigate to ${alertItem.victim.name}? We'll share your live ETA so the person in need knows help is on the way.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: "I'll help",
          style: 'default',
          onPress: async () => {
            if (!profile) return;
            dispatch(respondingStarted(alertItem.id));
            await respondToAlert(alertItem.id, {
              userId: profile.uid,
              name: profile.name ?? 'Responder',
              photoUri: profile.photoUri,
            });
            trackEvent('community_responded', {
              alertId: alertItem.id,
              distanceMeters: Math.round(alertItem.distanceMeters),
            });
            navigation.goBack();
          },
        },
      ],
    );
  };

  return (
    <ScreenContainer padded={false} scroll={false}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={styles.backBtn}
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>COMMUNITY SOS</Text>
          <Text style={styles.title}>People who need help</Text>
        </View>
      </View>

      <View style={styles.bannerWrap}>
        <View style={styles.banner}>
          <Ionicons name="heart" size={18} color={colors.primary} />
          <Text style={styles.bannerText}>
            These are real people nearby. Respond only if you can safely reach
            them.
          </Text>
        </View>
      </View>

      {isLoading && alerts.length === 0 ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>Looking for alerts nearby…</Text>
        </View>
      ) : error && alerts.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="cloud-offline-outline" size={36} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Couldn't load alerts</Text>
          <Text style={styles.emptyMeta}>{error}</Text>
          <Pressable onPress={load} style={styles.retryBtn}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : alerts.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons name="shield-checkmark" size={28} color={colors.success} />
          </View>
          <Text style={styles.emptyTitle}>All quiet nearby</Text>
          <Text style={styles.emptyMeta}>
            No one within 2km is asking for help right now. You'll be notified
            if that changes.
          </Text>
        </View>
      ) : (
        <FlatList
          data={alerts}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          renderItem={({ item }) => (
            <AlertCard
              alert={item}
              onRespond={() => handleRespond(item)}
              onDismiss={() => dispatch(alertDismissed(item.id))}
            />
          )}
        />
      )}
    </ScreenContainer>
  );
}

function AlertCard({
  alert: item,
  onRespond,
  onDismiss,
}: {
  alert: CommunityAlert;
  onRespond: () => void;
  onDismiss: () => void;
}) {
  const [pulse] = useState(new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const ageSeconds = Math.floor((Date.now() - item.createdAt) / 1000);
  const ageText =
    ageSeconds < 60
      ? `${ageSeconds}s ago`
      : `${Math.floor(ageSeconds / 60)} min ago`;

  return (
    <View style={cardStyles.card}>
      <View style={cardStyles.topRow}>
        <View style={cardStyles.avatar}>
          <Text style={cardStyles.avatarInitial}>
            {item.victim.name.charAt(0).toUpperCase()}
          </Text>
          <Animated.View
            pointerEvents="none"
            style={[
              cardStyles.avatarPulse,
              {
                opacity: pulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.55, 0],
                }),
                transform: [
                  {
                    scale: pulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.7],
                    }),
                  },
                ],
              },
            ]}
          />
        </View>
        <View style={{ flex: 1 }}>
          <View style={cardStyles.nameRow}>
            <Text style={cardStyles.name}>{item.victim.name}</Text>
            <View style={cardStyles.liveDot} />
          </View>
          <Text style={cardStyles.address} numberOfLines={1}>
            {item.location.address ?? 'Location shared'}
          </Text>
        </View>
      </View>

      <View style={cardStyles.statsRow}>
        <View style={cardStyles.statCell}>
          <Ionicons name="walk" size={14} color={colors.textSecondary} />
          <Text style={cardStyles.statText}>
            {formatDistance(item.distanceMeters)}
          </Text>
        </View>
        <View style={cardStyles.statDivider} />
        <View style={cardStyles.statCell}>
          <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
          <Text style={cardStyles.statText}>{formatEta(item.etaSeconds)}</Text>
        </View>
        <View style={cardStyles.statDivider} />
        <View style={cardStyles.statCell}>
          <Ionicons name="people-outline" size={14} color={colors.textSecondary} />
          <Text style={cardStyles.statText}>
            {item.respondersCount} on way
          </Text>
        </View>
      </View>

      <View style={cardStyles.footerRow}>
        <Pressable onPress={onDismiss} style={cardStyles.dismissBtn} hitSlop={8}>
          <Text style={cardStyles.dismissText}>Not available</Text>
        </Pressable>
        <Pressable onPress={onRespond} style={cardStyles.respondBtn}>
          <Ionicons name="arrow-forward" size={16} color={colors.textInverse} />
          <Text style={cardStyles.respondText}>I'll help</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.primary,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textPrimary,
    letterSpacing: -0.4,
  },
  bannerWrap: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255, 77, 77, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 77, 77, 0.22)',
  },
  bannerText: {
    ...typography.caption,
    color: colors.textPrimary,
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  emptyMeta: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    fontSize: 14,
  },
  retryBtn: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.circle,
    backgroundColor: colors.textPrimary,
  },
  retryText: {
    ...typography.button,
    color: colors.textInverse,
    fontSize: 14,
  },
});

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.background,
    padding: spacing.md,
    borderRadius: radius.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,77,77,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  avatarInitial: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    color: colors.primary,
  },
  avatarPulse: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  address: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  statCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  statDivider: {
    width: 1,
    height: 16,
    backgroundColor: colors.border,
  },
  statText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontSize: 12,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ageText: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 12,
  },
  dismissBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  dismissText: {
    ...typography.button,
    fontSize: 13,
    color: colors.textSecondary,
  },
  respondBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.circle,
    backgroundColor: colors.primary,
  },
  respondText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: colors.textInverse,
    letterSpacing: 0.3,
  },
});
