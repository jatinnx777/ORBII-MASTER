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
  TextInput,
  View,
  ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { appAlert, OrbiBee } from '@/components/common';
import { fontFamilies, radius, spacing } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { onboardingCompleted, accentSet } from '@/redux/slices/appSlice';
import { ACCENT_LIST, accentOf } from '@/theme/accents';
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
import { addPhrase } from '@/services/voice-phrases';

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
  // Speech bubble next to Orbi (per the reference designs).
  bubble?: string;
  // Extra hero prop: the red SOS button on the emergency screen.
  sosProp?: boolean;
  // ORBII wordmark lockup above the title (first screen only).
  showLogo?: boolean;
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
    showLogo: true,
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
    bubble: "I've got\nyour back!",
    features: [
      { icon: 'mic', tone: 'green', title: 'Voice Trigger', body: 'Say your safe word and ORBII will activate help instantly.' },
      { icon: 'notifications', tone: 'yellow', title: 'Smart Alerts', body: 'Instantly notify your trusted circle with your location.' },
      { icon: 'people', tone: 'green', title: 'Live Protection', body: 'Share live location and stay connected with the people who matter.' },
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
    bubble: "I'm right\nhere with you!",
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
    bubble: "I'll alert your\ntrusted circle\nright away!",
    sosProp: true,
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
  const [phase, setPhase] = useState<'intro' | 'language'>('intro');
  const scrollX = useRef(new Animated.Value(0)).current;

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && typeof viewableItems[0].index === 'number') {
      setIndex(viewableItems[0].index);
    }
  }).current;

  // Soft haptic tick as each page settles (premium iOS feel).
  useEffect(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, [index]);

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
        <View style={styles.segments}>
          {SLIDES.map((s, i) => (
            <View key={s.id} style={[styles.segment, i === index && styles.segmentActive]} />
          ))}
        </View>
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
        <View style={styles.dotsPill}>
          <Dots count={SLIDES.length} scrollX={scrollX} />
        </View>
        <View style={styles.fabWrap}>
          <View style={styles.fabGlow} />
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
              next();
            }}
            style={({ pressed }) => [styles.fab, pressed && { transform: [{ scale: 0.94 }] }]}
          >
            <Ionicons name="arrow-forward" size={26} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// Final onboarding step — pick the languages ORBII listens for. English is
// always on (bundled in the app); Hindi is an optional pack downloaded here.
function VoiceLanguageSetup({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const dispatch = useAppDispatch();
  const accent = accentOf(useAppSelector((s) => s.app.accent));
  const supported = hindiPackSupported();
  const [hindiOn, setHindiOn] = useState(false);
  const [ready, setReady] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phrase, setPhrase] = useState('');

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
        'Could not download the Hindi pack. Check your connection and try again. You can also add it later in Settings.',
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
    // IKEA effect + real security: a self-chosen secret phrase makes the
    // protection hers, and is safer than the public defaults.
    const p = phrase.trim();
    if (p.length >= 3) {
      await addPhrase(p).catch(() => undefined);
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

        {/* Pick your accent: personalisation before the app even opens */}
        <View style={lstyles.langCard}>
          <View style={lstyles.langHead}>
            <View style={{ flex: 1 }}>
              <Text style={lstyles.langTitle}>Pick your colour</Text>
              <Text style={lstyles.langHint}>Make ORBII feel like yours. Change it anytime.</Text>
            </View>
            <Ionicons name="color-palette" size={18} color={C.yellow} />
          </View>
          <View style={lstyles.accentRow}>
            {ACCENT_LIST.map((a) => {
              const selected = accent.id === a.id;
              return (
                <Pressable
                  key={a.id}
                  onPress={() => dispatch(accentSet(a.id))}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`${a.label} accent`}
                  style={[
                    lstyles.accentDot,
                    { backgroundColor: a.soft, borderColor: a.deep },
                    selected && lstyles.accentDotOn,
                  ]}
                >
                  {selected ? <Ionicons name="checkmark" size={15} color={a.deep} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Optional secret phrase: hers alone, on top of the built-in words */}
        <View style={lstyles.langCard}>
          <View style={lstyles.langHead}>
            <View style={{ flex: 1 }}>
              <Text style={lstyles.langTitle}>Your secret phrase</Text>
              <Text style={lstyles.langHint}>
                Optional. A phrase only you would say, so no one can guess it.
              </Text>
            </View>
            <Ionicons name="key" size={18} color={C.yellow} />
          </View>
          <TextInput
            value={phrase}
            onChangeText={setPhrase}
            placeholder='e.g. "call the stars"'
            placeholderTextColor={C.sub}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={40}
            style={lstyles.phraseInput}
          />
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
  accentRow: { flexDirection: 'row', gap: 12, marginTop: spacing.sm },
  accentDot: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accentDotOn: { borderWidth: 3 },
  phraseInput: {
    marginTop: spacing.sm,
    backgroundColor: C.bg,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: C.dotOff,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontFamily: fontFamilies.poppinsRegular,
    fontSize: 14.5,
    color: C.ink,
  },
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
  // Card-deck swipe: the whole slide shrinks + fades + drifts as it leaves,
  // and the incoming one settles forward — so paging feels like swiping cards.
  const scale = scrollX.interpolate({ inputRange, outputRange: [0.9, 1, 0.9], extrapolate: 'clamp' });
  const opacity = scrollX.interpolate({ inputRange, outputRange: [0.35, 1, 0.35], extrapolate: 'clamp' });
  const translateX = scrollX.interpolate({ inputRange, outputRange: [width * 0.16, 0, -width * 0.16], extrapolate: 'clamp' });

  return (
    <Animated.View style={{ width, opacity, transform: [{ perspective: 1000 }, { scale }, { translateX }] }}>
      <ScrollView contentContainerStyle={styles.slide} showsVerticalScrollIndicator={false}>
        {slide.showLogo ? (
          <View style={styles.logoLockup}>
            <Text style={styles.logoWord}>
              ORB<Text style={{ color: C.yellow }}>II</Text>
            </Text>
            <View style={styles.logoTagRow}>
              <View style={styles.logoTagLine} />
              <Text style={styles.logoTag}>YOUR AI SAFETY COMPANION</Text>
              <View style={styles.logoTagLine} />
            </View>
          </View>
        ) : null}
        <Text style={styles.title}>
          {slide.line1}
          {'\n'}
          <Text style={{ color: C.green }}>{slide.line2}</Text>
        </Text>
        <Text style={styles.subtitle}>{slide.subtitle}</Text>

        <Hero
          slideId={slide.id}
          orbit={slide.orbit}
          image={ORBI[slide.id]}
          bubble={slide.bubble}
          sosProp={slide.sosProp}
        />

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
                <View style={styles.chevCircle}>
                  <Ionicons name="chevron-forward" size={15} color={C.green} />
                </View>
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
            <Ionicons name="lock-closed" size={22} color="rgba(46,125,50,0.25)" />
          </View>
        ) : null}
      </ScrollView>
    </Animated.View>
  );
}

function Hero({
  slideId,
  orbit,
  image,
  bubble,
  sosProp,
}: {
  slideId: string;
  orbit: IconName[];
  image?: ImageSourcePropType;
  bubble?: string;
  sosProp?: boolean;
}) {
  const glow = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
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
    const c = loop(bob, 3200);
    a.start();
    b.start();
    c.start();
    return () => {
      a.stop();
      b.stop();
      c.stop();
    };
  }, [glow, float, bob]);

  const floatY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });
  const bobY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -6] });
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.42] });
  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.25] });
  const sosPulse = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  // Slides 1-2 show the floating feature badges; 3 has the phone card and 4
  // has the SOS button, matching the reference designs.
  const showBadges = slideId === 'companion' || slideId === 'voice';
  const showPhone = slideId === 'realtime';
  const pos = [
    { top: 6, right: 34 },
    { top: 64, left: 16 },
    { bottom: 26, right: 22 },
    { bottom: 40, left: 38 },
  ];

  return (
    <View style={styles.heroWrap}>
      {/* soft scenery: clouds, skyline, hills and trees behind Orbi */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={[styles.cloud, { top: 8, left: 14, width: 64 }]} />
        <View style={[styles.cloud, { top: 26, right: 20, width: 46 }]} />
        <View style={[styles.skyline, { left: 6, bottom: 78, width: 26, height: 54 }]} />
        <View style={[styles.skyline, { left: 36, bottom: 78, width: 18, height: 78 }]} />
        <View style={[styles.skyline, { right: 10, bottom: 78, width: 24, height: 64 }]} />
        <View style={[styles.skyline, { right: 40, bottom: 78, width: 16, height: 88 }]} />
        <View style={[styles.hill, { left: -60, bottom: -46, width: 240, height: 130 }]} />
        <View style={[styles.hill, { right: -60, bottom: -52, width: 260, height: 140 }]} />
        <Tree left={26} bottom={44} size={34} />
        <Tree left={64} bottom={34} size={24} />
        <Tree right={30} bottom={40} size={36} />
        <Tree right={70} bottom={30} size={22} />
      </View>

      <Animated.View style={[styles.heroGlow, { opacity: glowOpacity, transform: [{ scale: glowScale }] }]} />

      {showPhone ? (
        <View style={styles.phoneCard}>
          <Ionicons name="location" size={18} color={C.greenMid} style={{ alignSelf: 'flex-end', marginRight: 14 }} />
          <View style={[styles.routeSeg, { transform: [{ rotate: '24deg' }], alignSelf: 'flex-end', marginRight: 22 }]} />
          <View style={[styles.routeSeg, { transform: [{ rotate: '-30deg' }], alignSelf: 'center' }]} />
          <View style={[styles.routeSeg, { transform: [{ rotate: '18deg' }], alignSelf: 'flex-start', marginLeft: 16 }]} />
          <View style={styles.safePill}>
            <Ionicons name="shield-checkmark" size={9} color={C.green} />
            <Text style={styles.safePillText}>You're Safe</Text>
          </View>
        </View>
      ) : null}

      {image ? (
        <Animated.View style={{ transform: [{ translateY: floatY }] }}>
          <Image source={image} style={styles.heroImage} resizeMode="contain" />
        </Animated.View>
      ) : (
        <Animated.View style={{ transform: [{ translateY: floatY }] }}>
          <OrbiBee size={186} grounded />
        </Animated.View>
      )}

      {sosProp ? (
        <Animated.View style={[styles.sosWrap, { transform: [{ scale: sosPulse }] }]}>
          <View style={styles.sosRing} />
          <View style={styles.sosBtn}>
            <Text style={styles.sosText}>SOS</Text>
          </View>
        </Animated.View>
      ) : null}

      {bubble ? (
        <Animated.View
          style={[
            styles.speech,
            sosProp ? { top: 2, right: 8 } : { top: 8, left: 8 },
            { transform: [{ translateY: bobY }] },
          ]}
        >
          <Text style={styles.speechText}>{bubble}</Text>
          <Ionicons name="heart" size={12} color={C.yellow} style={{ marginTop: 3 }} />
          <View style={[styles.speechTail, sosProp ? { left: 18 } : { right: 18 }]} />
        </Animated.View>
      ) : null}

      {showBadges
        ? orbit.slice(0, 4).map((o, i) => (
            <Animated.View
              key={i}
              style={[styles.orbitBadge, pos[i], i % 2 === 0 ? { transform: [{ translateY: bobY }] } : null]}
            >
              <Ionicons name={o} size={18} color={C.greenMid} />
            </Animated.View>
          ))
        : null}
    </View>
  );
}

// A simple storybook tree: rounded crown + tiny trunk, used in the scenery.
function Tree({ left, right, bottom, size }: { left?: number; right?: number; bottom: number; size: number }) {
  return (
    <View style={{ position: 'absolute', left, right, bottom, alignItems: 'center' }}>
      <View style={{ width: size, height: size * 1.15, borderRadius: size * 0.5, backgroundColor: '#5DA46A', opacity: 0.55 }} />
      <View style={{ width: Math.max(3, size * 0.12), height: size * 0.28, backgroundColor: '#8A6B3F', borderRadius: 2, marginTop: -2, opacity: 0.5 }} />
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
  segments: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  segment: { width: 30, height: 6, borderRadius: 3, backgroundColor: C.dotOff },
  segmentActive: { backgroundColor: C.yellow },
  logoLockup: { alignItems: 'center', marginBottom: spacing.md },
  logoWord: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 34,
    letterSpacing: 1,
    color: C.ink,
  },
  logoTagRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  logoTagLine: { width: 26, height: 2, borderRadius: 1, backgroundColor: C.yellow },
  logoTag: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 10,
    letterSpacing: 2,
    color: C.ink,
  },
  chevCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: C.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotsPill: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: radius.pill,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  fabWrap: { alignItems: 'center', justifyContent: 'center' },
  fabGlow: {
    position: 'absolute',
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: C.greenMid,
    opacity: 0.22,
  },
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
  heroWrap: {
    width: '100%',
    height: 264,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: spacing.sm,
  },
  heroImage: { width: 220, height: 220 },
  heroGlow: { position: 'absolute', width: 170, height: 170, borderRadius: 85, backgroundColor: C.yellow },
  // scenery
  cloud: { position: 'absolute', height: 18, borderRadius: 12, backgroundColor: '#F3EAD0', opacity: 0.9 },
  skyline: { position: 'absolute', borderTopLeftRadius: 6, borderTopRightRadius: 6, backgroundColor: '#EBDDB8', opacity: 0.45 },
  hill: { position: 'absolute', borderRadius: 999, backgroundColor: '#E2F0D8', opacity: 0.9 },
  // slide 3 phone card
  phoneCard: {
    position: 'absolute',
    right: 12,
    top: 26,
    width: 104,
    height: 168,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: 1,
    borderColor: '#EFE8D4',
    paddingVertical: 14,
    justifyContent: 'space-between',
    transform: [{ rotate: '5deg' }],
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  routeSeg: { width: 34, height: 3, borderRadius: 2, backgroundColor: C.greenMid, opacity: 0.75 },
  safePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  safePillText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 8.5, color: C.ink },
  // slide 4 SOS button
  sosWrap: { position: 'absolute', left: 22, top: '38%', alignItems: 'center', justifyContent: 'center' },
  sosRing: {
    position: 'absolute',
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: C.coral,
    opacity: 0.18,
  },
  sosBtn: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#E23B2E',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#F8C0B4',
    shadowColor: '#E23B2E',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  sosText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: '#FFFFFF', letterSpacing: 0.5 },
  // speech bubble
  speech: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: 150,
    shadowColor: '#000',
    shadowOpacity: 0.09,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  speechText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13, lineHeight: 18, color: C.ink },
  speechTail: {
    position: 'absolute',
    bottom: -5,
    width: 12,
    height: 12,
    backgroundColor: '#FFFFFF',
    transform: [{ rotate: '45deg' }],
  },
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
