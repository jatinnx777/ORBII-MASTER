import React, { useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button, IconBadge, FeatureChip, Mascot } from '@/components/common';
import type { BadgeTint } from '@/components/common';
import type { MascotPose } from '@/components/common/Mascot';
import { colors, radius, shadows, spacing, typography } from '@/theme';
import { useAppDispatch } from '@/redux/store';
import { onboardingCompleted } from '@/redux/slices/appSlice';
import { trackEvent } from '@/services/analytics';

const { width } = Dimensions.get('window');

type SlideType = 'hero' | 'features' | 'steps';
type Slide = { id: string; type: SlideType };

const SLIDES: Slide[] = [
  { id: 'hero', type: 'hero' },
  { id: 'features', type: 'features' },
  { id: 'steps', type: 'steps' },
];

export function OnboardingScreen() {
  const insets = useSafeAreaInsets();
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

  const finish = (skipped = false) => {
    trackEvent('onboarding_completed', skipped ? { skipped: true } : undefined);
    dispatch(onboardingCompleted());
  };

  const handleNext = () => {
    if (index < SLIDES.length - 1) {
      listRef.current?.scrollToIndex({ index: index + 1, animated: true });
    } else {
      finish();
    }
  };

  const handleBack = () => {
    if (index > 0) listRef.current?.scrollToIndex({ index: index - 1, animated: true });
  };

  const isLast = index === SLIDES.length - 1;
  const showChrome = index > 0; // hero slide stays clean like screenshot 1
  const buttonLabel = index === 1 ? 'Next' : 'Get Started';

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      {/* top bar (back + skip) — hidden on the hero slide */}
      <View style={styles.topBar}>
        {showChrome ? (
          <Pressable style={styles.roundBtn} onPress={handleBack} hitSlop={10}>
            <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
          </Pressable>
        ) : (
          <View style={styles.roundBtn} />
        )}
        {showChrome ? (
          <Pressable style={styles.skipBtn} onPress={() => finish(true)} hitSlop={10}>
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        ) : null}
      </View>

      {showChrome ? <Dots count={SLIDES.length} index={index} scrollX={scrollX} /> : null}

      <Animated.FlatList
        ref={listRef as never}
        data={SLIDES}
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
        renderItem={({ item }: { item: Slide }) => (
          <View style={{ width }}>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.slideContent}
            >
              {item.type === 'hero' && <HeroSlide />}
              {item.type === 'features' && <FeaturesSlide />}
              {item.type === 'steps' && <StepsSlide />}
            </ScrollView>
          </View>
        )}
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          label={buttonLabel}
          onPress={handleNext}
          icon={<Ionicons name="arrow-forward" size={20} color={colors.textPrimary} />}
        />
        <View style={styles.secureRow}>
          <Ionicons name="shield-checkmark" size={14} color={colors.sage} />
          <Text style={styles.secureText}>
            {isLast ? 'You are in safe hands with ORBII' : '100% Secure • Privacy First'}
          </Text>
        </View>
      </View>
    </View>
  );
}

/* ── animated progress dots ─────────────────────────────── */
function Dots({
  count,
  index,
  scrollX,
}: {
  count: number;
  index: number;
  scrollX: Animated.Value;
}) {
  return (
    <View style={styles.dots}>
      {Array.from({ length: count }).map((_, i) => {
        const inputRange = [(i - 1) * width, i * width, (i + 1) * width];
        const dotWidth = scrollX.interpolate({
          inputRange,
          outputRange: [8, 26, 8],
          extrapolate: 'clamp',
        });
        return (
          <Animated.View
            key={i}
            style={[
              styles.dot,
              {
                width: dotWidth,
                backgroundColor: i <= index ? colors.peachDeep : colors.creamDeep,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

/* ── mascot with orbiting icon badges ───────────────────── */
function OrbitMascot({
  pose,
  badges,
  size = 180,
}: {
  pose: MascotPose;
  badges: { icon: keyof typeof Ionicons.glyphMap; tint: BadgeTint; pos: object }[];
  size?: number;
}) {
  return (
    <View style={[styles.orbitWrap, { height: size + 24 }]}>
      <Mascot pose={pose} size={size} />
      {badges.map((b, i) => (
        <IconBadge
          key={i}
          icon={b.icon}
          tint={b.tint}
          size={46}
          floating
          style={[styles.orbitBadge, b.pos]}
        />
      ))}
    </View>
  );
}

/* ── slide 1: hero (screenshot 1) ───────────────────────── */
function HeroSlide() {
  return (
    <View style={styles.hero}>
      <View style={styles.logoRow}>
        <IconBadge icon="shield-checkmark" tint="gold" size={40} />
        <View style={{ marginLeft: spacing.sm }}>
          <Text style={styles.logoTitle}>ORBII</Text>
          <Text style={styles.logoSub}>Your AI Guardian</Text>
        </View>
      </View>

      <Text style={styles.heroTitle}>
        Your Safety.{'\n'}Always<Text style={{ color: colors.peachDeep }}>.</Text>
      </Text>
      <Text style={styles.heroBody}>
        ORBII watches over you, alerts your loved ones, and brings help when you
        need it most.
      </Text>

      <OrbitMascot
        pose="neutral"
        size={180}
        badges={[
          { icon: 'shield-outline', tint: 'gold', pos: { top: 8, right: 24 } },
          { icon: 'location-outline', tint: 'sage', pos: { top: 70, left: 12 } },
          { icon: 'people-outline', tint: 'lavender', pos: { bottom: 24, right: 14 } },
        ]}
      />

      <View style={styles.featureCard}>
        <FeatureChip icon="shield-checkmark" tint="gold" label="AI-Powered Protection" />
        <FeatureChip icon="location" tint="sage" label="Live Location Sharing" />
        <FeatureChip icon="notifications" tint="coral" label="Instant Alerts" />
        <FeatureChip icon="people" tint="lavender" label="Trusted Network" />
      </View>
    </View>
  );
}

/* ── slide 2: features (screenshot 4) ───────────────────── */
const FEATURES: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: BadgeTint;
  title: string;
  body: string;
}[] = [
  {
    icon: 'location',
    tint: 'sage',
    title: 'Live Location Tracking',
    body: 'Share your real-time location with trusted people.',
  },
  {
    icon: 'notifications',
    tint: 'coral',
    title: 'Instant Alerts',
    body: 'Get help instantly with smart alerts and notifications.',
  },
  {
    icon: 'people',
    tint: 'lavender',
    title: 'Verified Helpers',
    body: 'Connect with verified people near you in an emergency.',
  },
  {
    icon: 'shield-checkmark',
    tint: 'gold',
    title: '24/7 AI Protection',
    body: "ORBII's AI is always active to keep you safe.",
  },
];

function FeaturesSlide() {
  return (
    <View style={styles.slidePad}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.slideTitle}>Always{'\n'}by your side</Text>
          <Text style={styles.slideBody}>
            ORBII keeps an eye on what matters and is always ready to protect you.
          </Text>
        </View>
        <Mascot pose="shield" size={120} />
      </View>

      <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
        {FEATURES.map((f) => (
          <View key={f.title} style={styles.rowCard}>
            <IconBadge icon={f.icon} tint={f.tint} size={48} />
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{f.title}</Text>
              <Text style={styles.rowBody}>{f.body}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </View>
        ))}
      </View>
    </View>
  );
}

/* ── slide 3: how it works (screenshot 3) ───────────────── */
const STEPS: {
  badge: keyof typeof Ionicons.glyphMap | 'SOS';
  tint: BadgeTint;
  title: string;
  body: string;
}[] = [
  {
    badge: 'SOS',
    tint: 'coral',
    title: '1. Trigger SOS',
    body: 'Press the SOS button or use voice command when you need help.',
  },
  {
    badge: 'notifications',
    tint: 'coral',
    title: '2. Instant Alert',
    body: 'ORBII instantly alerts your trusted contacts with your live location.',
  },
  {
    badge: 'people',
    tint: 'lavender',
    title: '3. Verified Help Arrives',
    body: 'Nearby verified helpers are notified and on their way to assist you.',
  },
  {
    badge: 'shield-checkmark',
    tint: 'sage',
    title: "4. You're Safe",
    body: 'We stay with you until you’re safe and everything is under control.',
  },
];

function StepsSlide() {
  return (
    <View style={styles.slidePad}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.slideTitle}>Help, When{'\n'}You Need It Most</Text>
          <Text style={styles.slideBody}>
            In an emergency, ORBII will alert your trusted circle and connect you
            with nearby verified helpers.
          </Text>
        </View>
        <Mascot pose="shield" size={120} />
      </View>

      <View style={styles.stepsCard}>
        <View style={styles.howChip}>
          <Ionicons name="shield-checkmark" size={15} color={colors.goldDeep} />
          <Text style={styles.howChipText}>Here’s how it works</Text>
        </View>

        {STEPS.map((s, i) => (
          <View key={s.title} style={styles.stepRow}>
            <View style={styles.stepBadgeCol}>
              {s.badge === 'SOS' ? (
                <View style={[styles.sosBadge]}>
                  <Text style={styles.sosBadgeText}>SOS</Text>
                </View>
              ) : (
                <IconBadge icon={s.badge} tint={s.tint} size={44} />
              )}
              {i < STEPS.length - 1 ? <View style={styles.stepConnector} /> : null}
            </View>
            <View style={styles.stepText}>
              <Text style={styles.rowTitle}>{s.title}</Text>
              <Text style={styles.rowBody}>{s.body}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    height: 44,
  },
  roundBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.icon,
  },
  skipBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    ...shadows.icon,
  },
  skipText: {
    ...typography.label,
    color: colors.textSecondary,
  },
  dots: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  slideContent: {
    paddingBottom: spacing.lg,
    flexGrow: 1,
  },
  /* hero */
  hero: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    alignItems: 'center',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  logoTitle: {
    ...typography.h1,
    fontSize: 26,
    color: colors.textPrimary,
  },
  logoSub: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textSecondary,
  },
  heroTitle: {
    ...typography.display,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  heroBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.md,
    maxWidth: 320,
  },
  orbitWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: spacing.lg,
  },
  orbitBadge: {
    position: 'absolute',
  },
  featureCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
    width: '100%',
    ...shadows.card,
  },
  /* shared slide */
  slidePad: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  slideTitle: {
    ...typography.displaySmall,
    color: colors.textPrimary,
  },
  slideBody: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    paddingRight: spacing.sm,
  },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  rowText: {
    flex: 1,
    marginLeft: spacing.md,
  },
  rowTitle: {
    ...typography.bodyMedium,
    fontFamily: 'Poppins_600SemiBold',
    color: colors.textPrimary,
  },
  rowBody: {
    ...typography.caption,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    marginTop: 2,
  },
  /* steps */
  stepsCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.lg,
    marginTop: spacing.lg,
    ...shadows.card,
  },
  howChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.goldSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    marginBottom: spacing.lg,
  },
  howChipText: {
    ...typography.label,
    color: colors.goldDeep,
  },
  stepRow: {
    flexDirection: 'row',
  },
  stepBadgeCol: {
    alignItems: 'center',
    width: 44,
  },
  stepConnector: {
    width: 2,
    flex: 1,
    minHeight: 18,
    marginVertical: 4,
    backgroundColor: colors.divider,
  },
  stepText: {
    flex: 1,
    marginLeft: spacing.md,
    paddingBottom: spacing.lg,
  },
  sosBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.coralSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosBadgeText: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 13,
    color: colors.coral,
  },
  /* footer */
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  secureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  secureText: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textSecondary,
  },
});
