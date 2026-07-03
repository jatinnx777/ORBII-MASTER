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
  Switch,
  Text,
  View,
  ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { appAlert, OrbiBee, Mascot } from '@/components/common';
import { fontFamilies, radius, spacing } from '@/theme';
import { useAppDispatch } from '@/redux/store';
import { onboardingCompleted } from '@/redux/slices/appSlice';
import { trackEvent } from '@/services/analytics';
import {
  downloadHindiPack,
  getVoiceLang,
  HINDI_PACK,
  hindiPackSupported,
  isHindiReady,
  removeHindiPack,
  setVoiceLang,
} from '@/services/voice-language';

const { width, height } = Dimensions.get('window');

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
type SlideKind = 'intro' | 'voice' | 'people';

type Slide = {
  id: string;
  kind: SlideKind;
  pose: 'wave' | 'shield' | 'headset';
  glow: string; // ambient glow colour behind Orbi for this screen
  headline: string;
  subcopy: string;
};

// Fable concept — "a friend meets you at the door": one idea per screen, Orbi
// persists above the pager and morphs pose, and the ambient glow shifts
// temperature as you swipe (peach → coral → sage). No feature-lists.
const SLIDES: Slide[] = [
  {
    id: 'intro',
    kind: 'intro',
    pose: 'wave',
    glow: '#F3C7A6',
    headline: "Hi, I'm Orbi.",
    subcopy:
      "Think of me as the friend who's always one word away — on the bus, on a late walk, anywhere.",
  },
  {
    id: 'voice',
    kind: 'voice',
    pose: 'shield',
    glow: '#F4A98C',
    headline: 'One phrase. That’s all it takes.',
    subcopy:
      'Say your secret phrase and ORBII alerts your people instantly — even if your phone is locked, even with no internet.',
  },
  {
    id: 'people',
    kind: 'people',
    pose: 'headset',
    glow: '#BFE0C4',
    headline: 'Your people, in your pocket.',
    subcopy:
      'Your family circle sees your live location the moment you need them — and verified responders nearby can reach you fast.',
  },
];

export function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<Slide>>(null);
  const dispatch = useAppDispatch();
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<'intro' | 'language'>('intro');
  const scrollX = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;

  // Squash-and-stretch pop + light haptic whenever Orbi changes pose (per slide).
  useEffect(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    pop.setValue(0.9);
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 90, useNativeDriver: true }).start();
  }, [index, pop]);

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && typeof viewableItems[0].index === 'number') {
      setIndex(viewableItems[0].index);
    }
  }).current;

  const finish = (skipped = false) => {
    trackEvent('onboarding_completed', skipped ? { skipped: true } : undefined);
    dispatch(onboardingCompleted());
  };
  // The intro slides flow INTO the Voice SOS language setup as a final step.
  const next = () => {
    if (index < SLIDES.length - 1) listRef.current?.scrollToIndex({ index: index + 1, animated: true });
    else setPhase('language');
  };

  if (phase === 'language') {
    return <VoiceLanguageSetup onDone={() => finish()} />;
  }
  const back = () => {
    if (index > 0) listRef.current?.scrollToIndex({ index: index - 1, animated: true });
  };

  // Ambient glow colour interpolates across screens (peach → coral → sage).
  const glowColor = scrollX.interpolate({
    inputRange: SLIDES.map((_, i) => i * width),
    outputRange: SLIDES.map((s) => s.glow),
  });
  // Coral "listening" rings only fade in around the Voice screen.
  const ringsOpacity = scrollX.interpolate({
    inputRange: [0, width * 0.5, width, width * 1.5, width * 2],
    outputRange: [0, 0, 1, 0, 0],
    extrapolate: 'clamp',
  });
  const isLast = index === SLIDES.length - 1;

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.xs }]}>
      {/* Persistent ambient glow behind Orbi */}
      <View pointerEvents="none" style={[styles.glowWrap, { top: height * 0.05 }]}>
        <Animated.View style={[styles.glowCircle, { backgroundColor: glowColor }]} />
      </View>

      {/* Persistent Orbi — floats above the pager and morphs pose per screen */}
      <Animated.View
        pointerEvents="none"
        style={[styles.orbiLayer, { top: height * 0.1, transform: [{ scale: pop }] }]}
      >
        <Animated.View style={[styles.rings, { opacity: ringsOpacity }]}>
          <PulseRing delay={0} />
          <PulseRing delay={900} />
        </Animated.View>
        <Mascot pose={SLIDES[index].pose} size={184} />
      </Animated.View>

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
        <Pressable
          onPress={next}
          style={({ pressed }) => [isLast ? styles.ctaPill : styles.fab, pressed && { transform: [{ scale: 0.96 }] }]}
        >
          {isLast ? (
            <Text style={styles.ctaText}>Get started</Text>
          ) : (
            <Ionicons name="arrow-forward" size={26} color="#FFFFFF" />
          )}
        </Pressable>
      </View>
    </View>
  );
}

// Final onboarding step — pick the languages ORBII listens for. English is
// always on (bundled in the app); Hindi is an optional pack downloaded here.
function VoiceLanguageSetup({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const supported = hindiPackSupported();
  const [hindiOn, setHindiOn] = useState(false);
  const [ready, setReady] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    (async () => {
      const [r, pref] = await Promise.all([isHindiReady(), getVoiceLang()]);
      setReady(r);
      setHindiOn(r || pref.hindi);
    })();
  }, []);

  const toggleHindi = (v: boolean) => {
    if (!supported) {
      appAlert('Not available', 'Hindi voice detection runs on the installed Android app.');
      return;
    }
    setHindiOn(v);
  };

  const startDownload = async () => {
    setDownloading(true);
    setProgress(0);
    const ok = await downloadHindiPack(setProgress);
    setDownloading(false);
    if (ok) {
      setReady(true);
    } else {
      appAlert(
        'Download failed',
        'Could not download the Hindi pack. Check your connection and try again — you can also add it later in Settings.',
      );
    }
  };

  const handleContinue = async () => {
    // Toggled off after a previous install → free the storage.
    if (!hindiOn && ready) {
      await removeHindiPack();
    } else {
      await setVoiceLang({ hindi: hindiOn && ready });
    }
    onDone();
  };

  return (
    <View style={[lstyles.root, { paddingTop: insets.top + spacing.lg }]}>
      <ScrollView contentContainerStyle={lstyles.scroll} showsVerticalScrollIndicator={false}>
        <View style={lstyles.iconWrap}>
          <Ionicons name="mic" size={26} color={C.green} />
        </View>
        <Text style={lstyles.h1}>Which language should{'\n'}ORBII listen for?</Text>
        <Text style={lstyles.sub}>
          ORBII listens on your device for your safe words. Nothing is ever recorded or sent anywhere.
        </Text>

        {/* English — always on, bundled in the app */}
        <View style={[lstyles.langCard, lstyles.langCardOn]}>
          <View style={lstyles.langHead}>
            <Text style={lstyles.langTitle}>English</Text>
            <View style={lstyles.onPill}>
              <Ionicons name="checkmark" size={11} color="#fff" />
              <Text style={lstyles.onPillText}>On</Text>
            </View>
          </View>
          <Text style={lstyles.exLabel}>EXAMPLES</Text>
          <View style={lstyles.chips}>
            {['Help me', 'Save me', 'Emergency'].map((w) => (
              <LangChip key={w} text={w} />
            ))}
          </View>
        </View>

        {/* Hindi — optional, downloaded on demand */}
        <View style={lstyles.langCard}>
          <View style={lstyles.langHead}>
            <View style={{ flex: 1 }}>
              <Text style={lstyles.langTitle}>Also detect Hindi</Text>
              <Text style={lstyles.langHint}>Optional language pack</Text>
            </View>
            <Switch
              value={hindiOn}
              onValueChange={toggleHindi}
              trackColor={{ false: C.dotOff, true: C.greenSoft }}
              thumbColor={hindiOn ? C.green : '#FFFFFF'}
            />
          </View>

          {hindiOn ? (
            <>
              <Text style={lstyles.exLabel}>EXAMPLES</Text>
              <View style={lstyles.chips}>
                {['Bachao', 'बचाओ', 'Madad', 'मदद'].map((w) => (
                  <LangChip key={w} text={w} />
                ))}
              </View>

              {ready ? (
                <View style={lstyles.readyRow}>
                  <Ionicons name="checkmark-circle" size={16} color={C.green} />
                  <Text style={lstyles.readyText}>Hindi pack installed</Text>
                </View>
              ) : downloading ? (
                <View style={lstyles.dlBox}>
                  <View style={lstyles.barTrack}>
                    <View style={[lstyles.barFill, { width: `${Math.max(progress, 4)}%` }]} />
                  </View>
                  <Text style={lstyles.dlText}>Downloading… {progress}%</Text>
                </View>
              ) : (
                <>
                  <Text style={lstyles.packInfo}>
                    Hindi voice detection requires an additional language pack ·{' '}
                    {HINDI_PACK.downloadMb} MB download · {HINDI_PACK.storageMb} MB storage
                  </Text>
                  <Pressable onPress={startDownload} style={({ pressed }) => [lstyles.dlBtn, pressed && { opacity: 0.9 }]}>
                    <Ionicons name="cloud-download" size={16} color="#fff" />
                    <Text style={lstyles.dlBtnText}>Download Hindi pack</Text>
                  </Pressable>
                </>
              )}
            </>
          ) : null}
        </View>

        <Text style={lstyles.note}>You can change this anytime in Settings → Voice SOS.</Text>
      </ScrollView>

      <View style={[lstyles.bottom, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable
          onPress={handleContinue}
          disabled={downloading}
          style={({ pressed }) => [lstyles.cta, downloading && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.98 }] }]}
        >
          <Text style={lstyles.ctaText}>{downloading ? 'Downloading…' : 'Continue'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function LangChip({ text }: { text: string }) {
  return (
    <View style={lstyles.chip}>
      <Text style={lstyles.chipText}>{text}</Text>
    </View>
  );
}

const lstyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, paddingHorizontal: spacing.lg },
  scroll: { paddingBottom: spacing.xl, gap: spacing.md },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  h1: { fontFamily: fontFamilies.poppinsBold, fontSize: 26, lineHeight: 32, color: C.ink, letterSpacing: -0.5 },
  sub: { fontFamily: fontFamilies.interRegular, fontSize: 14, lineHeight: 20, color: C.sub, marginBottom: spacing.sm },
  langCard: {
    backgroundColor: C.card,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1.5,
    borderColor: '#EFE7D2',
  },
  langCardOn: { borderColor: C.green },
  langHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  langTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 17, color: C.ink },
  langHint: { fontFamily: fontFamilies.interRegular, fontSize: 12.5, color: C.sub, marginTop: 1 },
  onPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: C.green,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  onPillText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 11, color: '#fff' },
  exLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 10, letterSpacing: 0.8, color: C.sub, marginTop: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.sm },
  chip: { backgroundColor: C.greenSoft, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill },
  chipText: { fontFamily: fontFamilies.interMedium, fontSize: 13, color: C.green },
  packInfo: { fontFamily: fontFamilies.interRegular, fontSize: 12.5, lineHeight: 18, color: C.sub, marginTop: spacing.md },
  dlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.green,
    borderRadius: radius.lg,
    paddingVertical: 13,
    marginTop: spacing.md,
  },
  dlBtnText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14.5, color: '#fff' },
  dlBox: { marginTop: spacing.md, gap: spacing.sm },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: C.greenSoft, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4, backgroundColor: C.green },
  dlText: { fontFamily: fontFamilies.interMedium, fontSize: 12.5, color: C.sub },
  readyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },
  readyText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13.5, color: C.green },
  note: { fontFamily: fontFamilies.interRegular, fontSize: 12, color: C.sub, textAlign: 'center', marginTop: spacing.sm },
  bottom: { paddingTop: spacing.sm },
  cta: {
    backgroundColor: C.green,
    borderRadius: radius.pill,
    paddingVertical: 16,
    alignItems: 'center',
  },
  ctaText: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: '#fff' },
});

function SlideView({ slide, index, scrollX }: { slide: Slide; index: number; scrollX: Animated.Value }) {
  const inputRange = [(index - 1) * width, index * width, (index + 1) * width];
  // Text drifts at full speed while Orbi + glow persist behind (parallax depth).
  const translateX = scrollX.interpolate({ inputRange, outputRange: [width * 0.14, 0, -width * 0.14], extrapolate: 'clamp' });
  const opacity = scrollX.interpolate({ inputRange, outputRange: [0, 1, 0], extrapolate: 'clamp' });

  return (
    <View style={styles.slideRoot}>
      <View style={styles.orbiSpacer} />
      <Animated.View style={[styles.slideBody, { opacity, transform: [{ translateX }] }]}>
        {slide.kind === 'voice' ? (
          <View style={styles.bubble}>
            <Ionicons name="mic" size={14} color={C.coral} />
            <Text style={styles.bubbleText}>“Orbi, help me”</Text>
          </View>
        ) : null}

        {slide.kind === 'people' ? (
          <View style={styles.chipsRow}>
            <AvatarChip icon="heart" label="Maa" bg={C.yellowSoft} fg={C.yellow} />
            <AvatarChip icon="people" label="Circle" bg={C.greenSoft} fg={C.greenMid} />
            <AvatarChip icon="shield-checkmark" label="Verified" bg={C.greenSoft} fg={C.green} />
          </View>
        ) : null}

        <Text style={styles.headline}>{slide.headline}</Text>
        <Text style={styles.subcopy}>{slide.subcopy}</Text>

        {slide.kind === 'voice' ? (
          <View style={styles.offlinePill}>
            <Ionicons name="cloud-offline" size={13} color={C.green} />
            <Text style={styles.offlineText}>Works offline · Works on lock screen</Text>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

function AvatarChip({ icon, label, bg, fg }: { icon: IconName; label: string; bg: string; fg: string }) {
  return (
    <View style={styles.chipWrap}>
      <View style={[styles.chip, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={20} color={fg} />
      </View>
      <Text style={styles.chipLabel}>{label}</Text>
    </View>
  );
}

// Expanding "listening" ring around Orbi on the Voice screen.
function PulseRing({ delay }: { delay: number }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(a, { toValue: 1, duration: 2000, delay, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [a, delay]);
  const scale = a.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.7] });
  const opacity = a.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0] });
  return <Animated.View style={[styles.ring, { transform: [{ scale }], opacity }]} />;
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
  ctaPill: {
    paddingHorizontal: 26,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: C.green,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  ctaText: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: '#FFFFFF' },

  // ── Fable onboarding: persistent glow + Orbi + one-idea slides ──
  glowWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 0 },
  glowCircle: {
    width: width * 0.92,
    height: width * 0.92,
    borderRadius: (width * 0.92) / 2,
    opacity: 0.5,
  },
  orbiLayer: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 3 },
  rings: { position: 'absolute', top: -8, alignSelf: 'center', width: 200, height: 200 },
  ring: {
    position: 'absolute',
    top: 5,
    left: 5,
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 2,
    borderColor: C.coral,
  },
  slideRoot: { width, flex: 1, paddingHorizontal: spacing.lg },
  orbiSpacer: { height: height * 0.4 },
  slideBody: { flex: 1, alignItems: 'center' },
  headline: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 30,
    lineHeight: 38,
    color: C.ink,
    textAlign: 'center',
    letterSpacing: -0.6,
    marginTop: spacing.md,
  },
  subcopy: {
    fontFamily: fontFamilies.poppinsRegular,
    fontSize: 15.5,
    lineHeight: 23,
    color: C.sub,
    textAlign: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  bubbleText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: C.ink },
  offlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.greenSoft,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
    marginTop: spacing.md,
  },
  offlineText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12, color: C.green },
  chipsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  chipWrap: { alignItems: 'center', gap: 5 },
  chip: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  chipLabel: { fontFamily: fontFamilies.poppinsRegular, fontSize: 12, color: C.sub },
});
