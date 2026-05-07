import React, { useRef, useState } from 'react';
import {
  Animated,
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
    body: 'Helpers are verified with Aadhaar and come to you. Nearby students, working women, and safety volunteers.',
  },
  {
    id: 'always',
    icon: 'shield-checkmark',
    title: 'Always-on protection',
    body: 'Voice triggers, lock-screen SOS shortcut, background location. Even if your phone is locked, ORBII has your back.',
  },
];

export function OnboardingScreen() {
  const listRef = useRef<FlatList<Slide>>(null);
  const dispatch = useAppDispatch();
  const [index, setIndex] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;

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

      <Animated.FlatList
        ref={listRef as never}
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(s: Slide) => s.id}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: true },
        )}
        scrollEventThrottle={16}
        renderItem={({ item, index: idx }: { item: Slide; index: number }) => (
          <Slide slide={item} index={idx} scrollX={scrollX} />
        )}
      />

      <View style={styles.dots}>
        {slides.map((_, i) => {
          const inputRange = [(i - 1) * width, i * width, (i + 1) * width];
          const dotWidth = scrollX.interpolate({
            inputRange,
            outputRange: [8, 28, 8],
            extrapolate: 'clamp',
          });
          const dotOpacity = scrollX.interpolate({
            inputRange,
            outputRange: [0.4, 1, 0.4],
            extrapolate: 'clamp',
          });
          return (
            <Animated.View
              key={i}
              style={[
                styles.dot,
                {
                  width: dotWidth,
                  opacity: dotOpacity,
                  backgroundColor: i === index ? colors.brandDeep : colors.border,
                },
              ]}
            />
          );
        })}
      </View>

      <View style={styles.footer}>
        <Button label={isLast ? 'Get started' : 'Next'} onPress={handleNext} />
      </View>
    </View>
  );
}

// Each slide animates as the user scrolls: icon halo scales + rotates a
// touch, the title slides in from below, the body fades. Native driver so
// the parallax stays at 60fps even with the gradient halo.
function Slide({
  slide,
  index,
  scrollX,
}: {
  slide: Slide;
  index: number;
  scrollX: Animated.Value;
}) {
  const inputRange = [(index - 1) * width, index * width, (index + 1) * width];
  const iconScale = scrollX.interpolate({
    inputRange,
    outputRange: [0.7, 1, 0.7],
    extrapolate: 'clamp',
  });
  const iconRotate = scrollX.interpolate({
    inputRange,
    outputRange: ['-12deg', '0deg', '12deg'],
    extrapolate: 'clamp',
  });
  const titleTranslateY = scrollX.interpolate({
    inputRange,
    outputRange: [40, 0, 40],
    extrapolate: 'clamp',
  });
  const titleOpacity = scrollX.interpolate({
    inputRange,
    outputRange: [0, 1, 0],
    extrapolate: 'clamp',
  });
  const bodyOpacity = scrollX.interpolate({
    inputRange,
    outputRange: [0, 1, 0],
    extrapolate: 'clamp',
  });
  const bodyTranslateY = scrollX.interpolate({
    inputRange,
    outputRange: [60, 0, 60],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.slide}>
      <Animated.View
        style={[
          styles.iconWrap,
          {
            transform: [{ scale: iconScale }, { rotate: iconRotate }],
          },
        ]}
      >
        <Ionicons name={slide.icon} size={72} color={colors.brandDeep} />
      </Animated.View>

      <Animated.Text
        style={[
          styles.title,
          {
            opacity: titleOpacity,
            transform: [{ translateY: titleTranslateY }],
          },
        ]}
      >
        {slide.title}
      </Animated.Text>

      <Animated.Text
        style={[
          styles.body,
          {
            opacity: bodyOpacity,
            transform: [{ translateY: bodyTranslateY }],
          },
        ]}
      >
        {slide.body}
      </Animated.Text>
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
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    backgroundColor: colors.surface,
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
    height: 8,
    borderRadius: 4,
  },
  footer: {
    padding: spacing.lg,
  },
});
