import React, { useCallback, useEffect, useRef } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SOSButton } from './components/SOSButton';
import { ScreenContainer } from '@/components/common';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import {
  helpersNearbyUpdated,
  locationErrored,
  locationPermissionChanged,
  locationUpdated,
} from '@/redux/slices/sosSlice';
import {
  getCurrentLocation,
  getCurrentPermission,
  requestPermission,
} from '@/services/location';
import { countHelpersNearby } from '@/services/helpers';
import type { AppStackParamList } from '@/navigation/types';

const HELPER_REFRESH_MS = 30_000;

type Nav = NativeStackNavigationProp<AppStackParamList>;

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);
  const { locationPermission } = useAppSelector((s) => s.sos);

  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadLocationAndHelpers = useCallback(async () => {
    try {
      const point = await getCurrentLocation();
      dispatch(locationUpdated(point));
      const count = await countHelpersNearby(point);
      dispatch(helpersNearbyUpdated(count));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not read location.';
      dispatch(locationErrored(message));
    }
  }, [dispatch]);

  const bootstrapPermission = useCallback(async () => {
    const existing = await getCurrentPermission();
    if (existing === 'granted') {
      dispatch(locationPermissionChanged('granted'));
      await loadLocationAndHelpers();
      return;
    }
    const next = await requestPermission();
    dispatch(locationPermissionChanged(next));
    if (next === 'granted') {
      await loadLocationAndHelpers();
    }
  }, [dispatch, loadLocationAndHelpers]);

  useEffect(() => {
    bootstrapPermission();
  }, [bootstrapPermission]);

  useEffect(() => {
    if (locationPermission !== 'granted') return;
    refreshTimer.current = setInterval(() => {
      loadLocationAndHelpers();
    }, HELPER_REFRESH_MS);
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [locationPermission, loadLocationAndHelpers]);

  const handleSOSPress = () => {
    if (locationPermission !== 'granted') {
      Alert.alert(
        'Enable location',
        'ORBII needs your location to dispatch helpers during an emergency.',
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Open settings',
            onPress: () => Linking.openSettings().catch(() => undefined),
          },
        ],
      );
      return;
    }
    navigation.navigate('SOSCountdown');
  };

  const initial = (profile?.name ?? '').trim().charAt(0).toUpperCase();

  return (
    <ScreenContainer padded={false}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <View style={styles.brandDot} />
          <Text style={styles.brandText}>ORBII</Text>
        </View>
        <View style={styles.headerRight}>
          <Pressable
            style={styles.iconChip}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            hitSlop={8}
            onPress={() => navigation.navigate('Tabs', { screen: 'Settings' })}
          >
            <Ionicons
              name="notifications-outline"
              size={18}
              color={colors.textPrimary}
            />
          </Pressable>
          <Pressable
            style={styles.avatarRing}
            accessibilityRole="button"
            accessibilityLabel="Open profile"
            hitSlop={8}
            onPress={() => navigation.navigate('Tabs', { screen: 'Profile' })}
          >
            <View style={styles.avatar}>
              {profile?.photoUri ? (
                <Image
                  source={{ uri: profile.photoUri }}
                  style={styles.avatarImage}
                />
              ) : initial ? (
                <Text style={styles.avatarInitial}>{initial}</Text>
              ) : (
                <Ionicons name="person" size={18} color={colors.textMuted} />
              )}
            </View>
          </Pressable>
        </View>
      </View>

      <View style={styles.content}>
        <View style={styles.listeningBlock}>
          <AudioWave />
          <Text style={styles.listeningTitle}>AI LISTENING FOR KEYWORDS</Text>
          <Text style={styles.keywordsLine}>
            <Text style={styles.keyword}>"Help"</Text>
            <Text style={styles.keywordSep}>, </Text>
            <Text style={styles.keyword}>"Bachao"</Text>
            <Text style={styles.keywordSep}>, </Text>
            <Text style={styles.keyword}>"Help Me"</Text>
          </Text>
        </View>

        {locationPermission !== 'granted' ? (
          <Pressable
            onPress={bootstrapPermission}
            style={styles.permissionBanner}
            accessibilityRole="button"
          >
            <Ionicons name="location-outline" size={18} color={colors.primary} />
            <Text style={styles.permissionText}>
              Enable location so we can find helpers around you.
            </Text>
          </Pressable>
        ) : null}

        <View style={styles.sosWrap}>
          <SOSButton onPress={handleSOSPress} />
          <Text style={styles.holdHint}>Hold 3 seconds to trigger</Text>
        </View>

        <View style={styles.cardRow}>
          <View style={styles.featureCard}>
            <View style={styles.featureTop}>
              <Ionicons
                name="eye-off-outline"
                size={18}
                color={colors.textSecondary}
              />
              <View style={styles.toggle}>
                <View style={styles.toggleThumb} />
              </View>
            </View>
            <Text style={styles.featureTitle}>Silent SOS</Text>
            <Text style={styles.featureMeta}>DISCREET ALERT</Text>
          </View>

          <View style={[styles.featureCard, styles.featureCardActive]}>
            <View style={styles.activeStripe} />
            <View style={styles.featureTop}>
              <Ionicons
                name="shield-checkmark"
                size={18}
                color={colors.accent}
              />
            </View>
            <Text style={styles.featureTitle}>Safe Mode</Text>
            <Text style={styles.featureMetaActive}>STATUS: ACTIVE</Text>
          </View>
        </View>
      </View>
    </ScreenContainer>
  );
}

function AudioWave() {
  const bars = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0.4))).current;

  useEffect(() => {
    const loops = bars.map((bar, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(bar, {
            toValue: 1,
            duration: 380 + i * 90,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(bar, {
            toValue: 0.3,
            duration: 380 + i * 70,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [bars]);

  return (
    <View style={waveStyles.row}>
      {bars.map((v, i) => (
        <Animated.View
          key={i}
          style={[
            waveStyles.bar,
            {
              height: v.interpolate({
                inputRange: [0, 1],
                outputRange: [5, 18],
              }),
            },
          ]}
        />
      ))}
    </View>
  );
}

const waveStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 22,
    marginBottom: spacing.sm,
  },
  bar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.textSecondary,
  },
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandDot: {
    width: 14,
    height: 14,
    borderRadius: 4,
    backgroundColor: colors.primary,
    transform: [{ rotate: '45deg' }],
  },
  brandText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    letterSpacing: 1.5,
    color: colors.primary,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconChip: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarRing: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitial: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14,
    color: colors.primary,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  listeningBlock: {
    alignItems: 'center',
    marginTop: spacing.md,
  },
  listeningTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13,
    letterSpacing: 1.8,
    color: colors.textPrimary,
    marginTop: 4,
  },
  keywordsLine: {
    marginTop: 6,
    textAlign: 'center',
  },
  keyword: {
    ...typography.label,
    color: colors.primary,
    fontFamily: fontFamilies.interMedium,
  },
  keywordSep: {
    ...typography.label,
    color: colors.textMuted,
  },
  permissionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: '#FFF4F4',
    borderWidth: 1,
    borderColor: '#FFD3D3',
  },
  permissionText: {
    ...typography.label,
    color: colors.textPrimary,
    flex: 1,
  },
  sosWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    gap: spacing.md,
  },
  holdHint: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 13,
  },
  cardRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  featureCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 10,
    minHeight: 92,
  },
  featureCardActive: {
    overflow: 'hidden',
  },
  activeStripe: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: colors.accent,
  },
  featureTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggle: {
    width: 28,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#D8D8D8',
    padding: 2,
    justifyContent: 'center',
  },
  toggleThumb: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.background,
  },
  featureTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  featureMeta: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.textMuted,
  },
  featureMetaActive: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.accent,
  },
});
