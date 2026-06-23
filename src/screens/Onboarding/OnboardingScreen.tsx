import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Image,
  type ImageSourcePropType,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fontFamilies, radius, spacing } from '@/theme';
import { useAppDispatch } from '@/redux/store';
import { onboardingCompleted } from '@/redux/slices/appSlice';
import { trackEvent } from '@/services/analytics';

const { width } = Dimensions.get('window');

// Warm cream + forest-green palette matching the reference designs.
const C = {
  bg: '#FCF7EA',
  ink: '#20302A',
  green: '#2E7D32',
  greenMid: '#43A047',
  greenSoft: '#E7F2E7',
  yellow: '#E8A92E',
  yellowSoft: '#FBEFCF',
  coral: '#E8553F',
  coralSoft: '#FCE5DF',
  sub: '#6B776F',
  card: '#FFFFFF',
  dotOff: '#E3DCC9',
};

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type Feature = { icon: IconName; tone: 'green' | 'yellow' | 'coral'; title: string; body: string };

type Slide = {
  id: string;
  line1: string;
  line2: string;
  subtitle: string;
  heroIcon: IconName;
  // Drop the Orbi artwork for each screen here to match the designs exactly.
  // Until then the animated icon hero is shown.
  heroImage?: ImageSourcePropType;
  orbit: IconName[];
  layout: 'row' | 'list';
  cardHeading?: string;
  features: Feature[];
  footer?: { title: string; body: string };
};

// Orbi artwork per screen. Once you drop the PNGs in assets/onboarding/,
// uncomment these and they'll render in place of the icon hero.
const ORBI: Record<string, ImageSourcePropType | undefined> = {
  companion: undefined, // require('../../../assets/onboarding/orbi-1.png'),
  voice: undefined, // require('../../../assets/onboarding/orbi-2.png'),
  realtime: undefined, // require('../../../assets/onboarding/orbi-3.png'),
  emergency: undefined, // require('../../../assets/onboarding/orbi-4.png'),
};

const SLIDES: Slide[] = [
  {
    id: 'companion',
    line1: 'Your safety.',
    line2: 'Always with you.',
    subtitle: 'ORBII is your AI companion that helps you feel safe, stay connected and get help when you need it most.',
    heroIcon: 'shield-checkmark',
    orbit: ['shield-checkmark', 'notifications', 'location', 'people'],
    layout: 'row',
    features: [
      { icon: 'shield-checkmark', tone: 'green', title: 'Be Protected', body: 'Smart protection when you need it.' },
      { icon: 'location', tone: 'green', title: 'Stay Connected', body: 'Share live location with trusted people.' },
      { icon: 'flash', tone: 'green', title: 'Get Help Fast', body: 'Instant alerts to your circle in emergencies.' },
    ],
  },
  {
    id: 'voice',
    line1: 'AI that listens.',
    line2: 'Protection that acts.',
    subtitle: 'ORBII is always listening for you, so help reaches you faster in any situation.',
    heroIcon: 'mic',
    orbit: ['mic', 'notifications', 'location', 'people'],
    layout: 'list',
    features: [
      { icon: 'mic', tone: 'green', title: 'Voice Trigger', body: 'Say your safe word and ORBII activates help instantly.' },
      { icon: 'notifications', tone: 'yellow', title: 'Smart Alerts', body: 'Instantly notify your trusted circle with your location.' },
      { icon: 'people', tone: 'green', title: 'Live Protection', body: 'Share live location and stay connected with people who matter.' },
    ],
  },
  {
    id: 'realtime',
    line1: 'Real-time protection.',
    line2: 'Every step of the way.',
    subtitle: 'ORBII stays by your side with live location, safe walk and instant updates.',
    heroIcon: 'navigate',
    orbit: ['location', 'walk', 'shield-checkmark', 'notifications'],
    layout: 'list',
    features: [
      { icon: 'location', tone: 'green', title: 'Live Location Sharing', body: 'Share your real-time location with trusted people you choose.' },
      { icon: 'walk', tone: 'yellow', title: 'Safe Walk', body: 'Start a Safe Walk and ORBII will monitor your journey.' },
      { icon: 'notifications', tone: 'green', title: 'Instant Updates', body: 'Get notified instantly if something looks off or you need help.' },
    ],
  },
  {
    id: 'emergency',
    line1: 'Help when',
    line2: 'you need it most.',
    subtitle: 'In an emergency, ORBII alerts your trusted contacts and shares your location instantly. Help is just one tap away.',
    heroIcon: 'alert-circle',
    orbit: ['notifications', 'location', 'shield-checkmark', 'people'],
    layout: 'list',
    cardHeading: 'In an emergency, ORBII will:',
    features: [
      { icon: 'notifications', tone: 'coral', title: 'Send SOS Alerts', body: 'Instantly alert your trusted contacts with your live location.' },
      { icon: 'location', tone: 'yellow', title: 'Share Live Location', body: 'Share your real-time location so they can reach you quickly.' },
      { icon: 'shield-checkmark', tone: 'green', title: 'Get Help Fast', body: 'Your trusted circle can respond and help you faster.' },
    ],
    footer: { title: 'Your safety, our priority.', body: 'ORBII is here to protect you, always.' },
  },
];

const TONE: Record<Feature['tone'], { bg: string; fg: string }> = {
  green: { bg: C.greenSoft, fg: C.greenMid },
  yellow: { bg: C.yellowSoft, fg: C.yellow },
  coral: { bg: C.coralSoft, fg: C.coral },
};

export function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<Slide>>(null);
  const dispatch = useAppDispatch();
  const [index, setIndex] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && typeof viewableItems[0].index === 'number') {
      setIndex(viewableItems[0].index);
    }
  }).current;

  const finish = (skipped = false) => {
    trackEvent('onboarding_completed', skipped ? { skipped: true } : undefined);
    dispatch(onboardingCompleted());
  };
  const next = () => {
    if (index < SLIDES.length - 1) listRef.current?.scrollToIndex({ index: index + 1, animated: true });
    else finish();
  };
  const back = () => {
    if (index > 0) listRef.current?.scrollToIndex({ index: index - 1, animated: true });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.xs }]}>
      <View style={styles.topBar}>
        {index > 0 ? (
          <Pressable onPress={back} hitSlop={10} style={styles.circleBtn}>
            <Ionicons name="chevron-back" size={20} color={C.ink} />
          </Pressable>
        ) : (
          <View style={styles.circleBtn} />
        )}
        <Pressable onPress={() => finish(true)} hitSlop={10} style={styles.skipPill}>
          <Text style={styles.skipText}>Skip</Text>
          <Ionicons name="chevron-forward" size={14} color={C.green} />
        </Pressable>
      </View>

      <Animated.FlatList
        ref={listRef as never}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(s: Slide) => s.id}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: false })}
        scrollEventThrottle={16}
        renderItem={({ item, index: i }: { item: Slide; index: number }) => (
          <SlideView slide={item} index={i} scrollX={scrollX} />
        )}
      />

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.sm }]}>
        <Dots count={SLIDES.length} scrollX={scrollX} />
        <Pressable onPress={next} style={({ pressed }) => [styles.fab, pressed && { transform: [{ scale: 0.94 }] }]}>
          <Ionicons name="arrow-forward" size={26} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}

function SlideView({ slide, index, scrollX }: { slide: Slide; index: number; scrollX: Animated.Value }) {
  const inputRange = [(index - 1) * width, index * width, (index + 1) * width];
  // Card-deck swipe: the whole slide shrinks + fades + drifts as it leaves,
  // and the incoming one settles forward — so paging feels like swiping cards.
  const scale = scrollX.interpolate({ inputRange, outputRange: [0.9, 1, 0.9], extrapolate: 'clamp' });
  const opacity = scrollX.interpolate({ inputRange, outputRange: [0.35, 1, 0.35], extrapolate: 'clamp' });
  const translateX = scrollX.interpolate({ inputRange, outputRange: [width * 0.16, 0, -width * 0.16], extrapolate: 'clamp' });

  return (
    <Animated.View style={{ width, opacity, transform: [{ perspective: 1000 }, { scale }, { translateX }] }}>
      <ScrollView contentContainerStyle={styles.slide} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>
          {slide.line1}
          {'\n'}
          <Text style={{ color: C.green }}>{slide.line2}</Text>
        </Text>
        <Text style={styles.subtitle}>{slide.subtitle}</Text>

        <Hero icon={slide.heroIcon} orbit={slide.orbit} image={ORBI[slide.id]} />

        {slide.layout === 'row' ? (
          <View style={styles.rowCard}>
            {slide.features.map((f, i) => (
              <View key={f.title} style={[styles.rowCell, i < slide.features.length - 1 && styles.rowDivider]}>
                <View style={[styles.badge, { backgroundColor: TONE[f.tone].bg }]}>
                  <Ionicons name={f.icon} size={22} color={TONE[f.tone].fg} />
                </View>
                <Text style={styles.rowTitle}>{f.title}</Text>
                <Text style={styles.rowBody}>{f.body}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.listCard}>
            {slide.cardHeading ? <Text style={styles.cardHeading}>{slide.cardHeading}</Text> : null}
            {slide.features.map((f, i) => (
              <View key={f.title} style={[styles.listRow, i < slide.features.length - 1 && styles.listDivider]}>
                <View style={[styles.badge, { backgroundColor: TONE[f.tone].bg }]}>
                  <Ionicons name={f.icon} size={22} color={TONE[f.tone].fg} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.listTitle}>{f.title}</Text>
                  <Text style={styles.listBody}>{f.body}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={C.greenMid} />
              </View>
            ))}
          </View>
        )}

        {slide.footer ? (
          <View style={styles.footerCard}>
            <View style={[styles.badge, { backgroundColor: C.greenSoft, width: 40, height: 40, borderRadius: 20 }]}>
              <Ionicons name="shield-checkmark" size={20} color={C.greenMid} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.footerTitle}>{slide.footer.title}</Text>
              <Text style={styles.footerBody}>{slide.footer.body}</Text>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </Animated.View>
  );
}

function Hero({ icon, orbit, image }: { icon: IconName; orbit: IconName[]; image?: ImageSourcePropType }) {
  const glow = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = (v: Animated.Value, d: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: d, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: d, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      );
    const a = loop(glow, 2000);
    const b = loop(float, 2600);
    a.start();
    b.start();
    return () => {
      a.stop();
      b.stop();
    };
  }, [glow, float]);

  const floatY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.42] });
  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.25] });
  const pos = [
    { top: 4, right: 28 },
    { top: 70, left: 8 },
    { bottom: 16, right: 12 },
    { bottom: 30, left: 30 },
  ];

  return (
    <View style={styles.heroWrap}>
      <Animated.View style={[styles.heroGlow, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />
      {image ? (
        <Animated.View style={{ transform: [{ translateY: floatY }] }}>
          <Image source={image} style={styles.heroImage} resizeMode="contain" />
        </Animated.View>
      ) : (
        <Animated.View style={[styles.heroCore, { transform: [{ translateY: floatY }] }]}>
          <Ionicons name={icon} size={56} color={C.yellow} />
        </Animated.View>
      )}
      {orbit.slice(0, 4).map((o, i) => (
        <View key={i} style={[styles.orbitBadge, pos[i]]}>
          <Ionicons name={o} size={18} color={C.greenMid} />
        </View>
      ))}
    </View>
  );
}

function Dots({ count, scrollX }: { count: number; scrollX: Animated.Value }) {
  return (
    <View style={styles.dots}>
      {Array.from({ length: count }).map((_, i) => {
        const inputRange = [(i - 1) * width, i * width, (i + 1) * width];
        const w = scrollX.interpolate({ inputRange, outputRange: [8, 26, 8], extrapolate: 'clamp' });
        const bg = scrollX.interpolate({ inputRange, outputRange: [C.dotOff, C.green, C.dotOff], extrapolate: 'clamp' });
        return <Animated.View key={i} style={[styles.dot, { width: w, backgroundColor: bg }]} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    height: 48,
  },
  circleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  skipPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  skipText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: C.green },
  slide: { alignItems: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 30,
    lineHeight: 38,
    color: C.ink,
    textAlign: 'center',
    letterSpacing: -0.6,
    marginTop: spacing.sm,
  },
  subtitle: {
    fontFamily: fontFamilies.poppinsRegular,
    fontSize: 15,
    lineHeight: 22,
    color: C.sub,
    textAlign: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  heroWrap: { width: 230, height: 230, alignItems: 'center', justifyContent: 'center', marginVertical: spacing.md },
  heroImage: { width: 210, height: 210 },
  heroGlow: { position: 'absolute', width: 170, height: 170, borderRadius: 85, backgroundColor: C.yellow },
  heroCore: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
    shadowColor: '#C9A24B',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  orbitBadge: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  rowCard: {
    flexDirection: 'row',
    backgroundColor: C.card,
    borderRadius: radius.xxl,
    paddingVertical: spacing.lg,
    marginTop: spacing.sm,
    width: '100%',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  rowCell: { flex: 1, alignItems: 'center', paddingHorizontal: 10 },
  rowDivider: { borderRightWidth: 1, borderRightColor: '#EFEAD9' },
  badge: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: C.green, marginTop: spacing.sm, textAlign: 'center' },
  rowBody: { fontFamily: fontFamilies.poppinsRegular, fontSize: 12, lineHeight: 17, color: C.sub, marginTop: 4, textAlign: 'center' },
  listCard: {
    backgroundColor: C.card,
    borderRadius: radius.xxl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginTop: spacing.sm,
    width: '100%',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  cardHeading: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: C.green, textAlign: 'center', paddingTop: spacing.md, paddingBottom: spacing.xs },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  listDivider: { borderBottomWidth: 1, borderBottomColor: '#F1ECDD' },
  listTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15.5, color: C.ink },
  listBody: { fontFamily: fontFamilies.poppinsRegular, fontSize: 13, lineHeight: 18, color: C.sub, marginTop: 2 },
  footerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: C.greenSoft,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginTop: spacing.md,
    width: '100%',
  },
  footerTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14.5, color: C.green },
  footerBody: { fontFamily: fontFamilies.poppinsRegular, fontSize: 12.5, color: C.sub, marginTop: 1 },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { height: 8, borderRadius: 4 },
  fab: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.green,
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
});
