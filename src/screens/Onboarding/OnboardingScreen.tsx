import React, { useRef, useState } from 'react';
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useAppDispatch } from '@/redux/store';
import { onboardingCompleted } from '@/redux/slices/appSlice';

const { width } = Dimensions.get('window');

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type HowTo = { icon: IconName; text: string };
type Slide = {
  id: string;
  hero: IconName;
  orbit: IconName[];
  title: string;
  subtitle: string;
  how: HowTo[];
};

// Four intro screens that both sell ORBII and TEACH it: each one names the real
// feature and says, in one line, how she actually uses it. Icon-based, so there
// are no stock photos and nothing copied from anyone's design.
const SLIDES: Slide[] = [
  {
    id: 'welcome',
    hero: 'shield-checkmark',
    orbit: ['mic', 'location', 'people', 'notifications'],
    title: 'Feel safe, wherever you go',
    subtitle:
      'ORBII is a safety companion that stays with you quietly, and springs into action the moment you need help.',
    how: [
      { icon: 'flash', text: 'One tap, or your voice, sends for help.' },
      { icon: 'lock-closed', text: 'Everything runs on your phone. Private by design.' },
    ],
  },
  {
    id: 'voice',
    hero: 'mic',
    orbit: ['notifications', 'shield-checkmark', 'radio', 'ear'],
    title: 'Help before you can even reach your phone',
    subtitle:
      "Turn on Voice SOS and just shout “help, help”. ORBII hears you and fires an emergency, hands-free, even from your bag.",
    how: [
      { icon: 'mic', text: 'Emergency tab → Activate Voice SOS.' },
      { icon: 'hand-left', text: 'Or press the SOS button any time.' },
    ],
  },
  {
    id: 'circle',
    hero: 'people',
    orbit: ['location', 'navigate', 'call', 'heart'],
    title: 'Your circle, always close',
    subtitle:
      'Add the people you trust. When you need help, they get your live location instantly, and you can see each other on the map.',
    how: [
      { icon: 'share-social', text: 'Share your live location in one tap.' },
      { icon: 'locate', text: 'Set safe zones and know if a loved one leaves.' },
    ],
  },
  {
    id: 'beyond',
    hero: 'heart',
    orbit: ['call', 'medkit', 'school', 'folder-open'],
    title: 'More than emergencies',
    subtitle:
      'Real helplines, nearby safe places, your evidence recordings and a learning hub, all in one calm place.',
    how: [
      { icon: 'call', text: 'India’s free helplines, one tap away.' },
      { icon: 'folder-open', text: 'Your SOS recordings, saved only for you.' },
    ],
  },
];

export function OnboardingScreen() {
  const dispatch = useAppDispatch();
  const insets = useSafeAreaInsets();
  const scroller = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const goTo = (i: number) => {
    scroller.current?.scrollTo({ x: i * width, animated: true });
    setIndex(i);
    Haptics.selectionAsync().catch(() => undefined);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== index) setIndex(i);
  };

  const finish = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    dispatch(onboardingCompleted());
  };

  const last = index === SLIDES.length - 1;

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {/* top bar */}
        <View style={styles.topBar}>
          <View style={styles.brandRow}>
            <View style={styles.brandDot}>
              <Ionicons name="shield-checkmark" size={13} color={colors.textInverse} />
            </View>
            <Text style={styles.brand}>ORBII</Text>
          </View>
          {!last ? (
            <Pressable onPress={finish} hitSlop={10} accessibilityRole="button">
              <Text style={styles.skip}>Skip</Text>
            </Pressable>
          ) : (
            <View style={{ width: 34 }} />
          )}
        </View>

        <ScrollView
          ref={scroller}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          style={{ flex: 1 }}
        >
          {SLIDES.map((s) => (
            <View key={s.id} style={[styles.slide, { width }]}>
              {/* hero */}
              <View style={styles.heroWrap}>
                <View style={styles.orbitOuter}>
                  <View style={styles.orbitInner}>
                    <View style={styles.heroCircle}>
                      <Ionicons name={s.hero} size={54} color={colors.textInverse} />
                    </View>
                  </View>
                  {s.orbit.map((icon, i) => {
                    const angle = (i / s.orbit.length) * 2 * Math.PI - Math.PI / 2;
                    const r = 118;
                    return (
                      <View
                        key={icon + i}
                        style={[
                          styles.orbitChip,
                          {
                            transform: [
                              { translateX: Math.cos(angle) * r },
                              { translateY: Math.sin(angle) * r },
                            ],
                          },
                        ]}
                      >
                        <Ionicons name={icon} size={17} color={colors.brandDeep} />
                      </View>
                    );
                  })}
                </View>
              </View>

              <Text style={styles.title}>{s.title}</Text>
              <Text style={styles.subtitle}>{s.subtitle}</Text>

              <View style={styles.howCard}>
                {s.how.map((h, i) => (
                  <View key={i} style={[styles.howRow, i > 0 && styles.howDivider]}>
                    <View style={styles.howIcon}>
                      <Ionicons name={h.icon} size={16} color={colors.brandDeep} />
                    </View>
                    <Text style={styles.howText}>{h.text}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>

        {/* dots */}
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotOn]} />
          ))}
        </View>

        {/* cta */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
          <Pressable
            onPress={() => (last ? finish() : goTo(index + 1))}
            style={({ pressed }) => [styles.cta, pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] }]}
            accessibilityRole="button"
            accessibilityLabel={last ? 'Get started' : 'Next'}
          >
            <Text style={styles.ctaText}>{last ? 'Get started' : 'Next'}</Text>
            <Ionicons
              name={last ? 'arrow-forward' : 'chevron-forward'}
              size={18}
              color={colors.textInverse}
            />
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brandDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 15,
    letterSpacing: 2,
    color: colors.textPrimary,
  },
  skip: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textSecondary },

  slide: { paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  heroWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl },
  orbitOuter: {
    width: 280,
    height: 280,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbitInner: {
    width: 236,
    height: 236,
    borderRadius: 118,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCircle: {
    width: 118,
    height: 118,
    borderRadius: 59,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  orbitChip: {
    position: 'absolute',
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.icon,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 24,
    color: colors.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.4,
    lineHeight: 30,
  },
  subtitle: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: spacing.sm,
    maxWidth: 340,
  },
  howCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
    width: '100%',
    ...shadows.card,
  },
  howRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  howDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  howIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  howText: { flex: 1, fontFamily: fontFamilies.interMedium, fontSize: 13, color: colors.textPrimary },

  dots: { flexDirection: 'row', justifyContent: 'center', gap: 7, paddingVertical: spacing.md },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.creamDeep },
  dotOn: { width: 22, backgroundColor: colors.brand },

  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingVertical: 16,
    ...shadows.card,
  },
  ctaText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15.5, color: colors.textInverse },
});
