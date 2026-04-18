import React, { useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewToken,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/common';
import { colors, fontFamilies, spacing, typography } from '@/theme';
import { useAppDispatch } from '@/redux/store';
import { onboardingCompleted } from '@/redux/slices/appSlice';
import { trackEvent } from '@/services/analytics';

const { width } = Dimensions.get('window');

type Slide = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
};

const slides: Slide[] = [
  {
    id: 'sos',
    icon: 'alert-circle',
    title: 'Press once. Help arrives.',
    body: 'One tap summons the nearest ORBII helpers, your emergency contacts, and police control within 2 minutes.',
  },
  {
    id: 'network',
    icon: 'people-circle',
    title: 'A verified network of women',
    body: 'Helpers are verified with Aadhaar and come to you — from nearby students, working women, and safety volunteers.',
  },
  {
    id: 'always',
    icon: 'shield-checkmark',
    title: 'Always-on protection',
    body: 'Voice triggers, silent alerts, background location — even if your phone is locked, ORBII has your back.',
  },
];

export function OnboardingScreen() {
  const listRef = useRef<FlatList<Slide>>(null);
  const dispatch = useAppDispatch();
  const [index, setIndex] = useState(0);

  const onViewable = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && typeof viewableItems[0].index === 'number') {
        setIndex(viewableItems[0].index);
      }
    },
  ).current;

  const handleNext = () => {
    if (index < slides.length - 1) {
      listRef.current?.scrollToIndex({ index: index + 1, animated: true });
    } else {
      trackEvent('onboarding_completed');
      dispatch(onboardingCompleted());
    }
  };

  const handleSkip = () => {
    trackEvent('onboarding_completed', { skipped: true });
    dispatch(onboardingCompleted());
  };

  const isLast = index === slides.length - 1;

  return (
    <View style={styles.container}>
      <View style={styles.skipWrap}>
        {!isLast ? (
          <Pressable onPress={handleSkip} hitSlop={12}>
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        ref={listRef}
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(s) => s.id}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        renderItem={({ item }) => (
          <View style={styles.slide}>
            <View style={styles.iconWrap}>
              <Ionicons name={item.icon} size={100} color={colors.primary} />
            </View>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.body}>{item.body}</Text>
          </View>
        )}
      />

      <View style={styles.dots}>
        {slides.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === index && styles.dotActive]}
          />
        ))}
      </View>

      <View style={styles.footer}>
        <Button
          label={isLast ? 'Get started' : 'Next'}
          onPress={handleNext}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: spacing.xxl,
  },
  skipWrap: {
    alignItems: 'flex-end',
    paddingHorizontal: spacing.lg,
    height: 24,
  },
  skipText: {
    ...typography.bodyMedium,
    color: colors.textMuted,
  },
  slide: {
    width,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
  },
  iconWrap: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 26,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 340,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
  },
  dotActive: {
    width: 24,
    backgroundColor: colors.primary,
  },
  footer: {
    padding: spacing.lg,
  },
});
