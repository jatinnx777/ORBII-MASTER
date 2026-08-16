import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { appAlert } from '@/components/common';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { createCircle, CirclesNotInstalledError, type CircleKind } from '@/services/circles';
import { circleAdded } from '@/redux/slices/circlesSlice';
import { setActiveCircle } from '@/services/circles-bootstrap';
import { updateProfile } from '@/services/auth';
import { profileUpdated } from '@/redux/slices/userSlice';
import { playTick } from '@/services/ui-sound';
import { colors, fontFamilies, radius, spacing } from '@/theme';
import type { AppScreenProps } from '@/navigation/types';

// Building a circle, one question per screen.
//
// The old version was a single scrolling form: name, emoji, kind and a default
// switch all at once. It worked and nobody enjoyed it. This is the same data,
// asked one thing at a time on the ink ground the website uses for its editorial
// bands, because setting up the people who come for you when something goes
// wrong deserves to feel like more than filling in a form.
//
// Two deliberate departures from the family-tracker apps this resembles:
//
//   1. The role question is gone. "Are you Mom or Dad?" builds a family graph.
//      We ask what the circle is FOR instead, which already drives the icon and
//      colour, so the answer does real work.
//   2. The privacy line says what actually happens. The app that inspired this
//      layout uses that same slot to disclose that location data goes to third
//      parties for advertising. Ours is the opposite promise, and it belongs on
//      screen at the moment someone decides to trust us, not buried in a policy.

const STEPS = ['hero', 'name', 'kind', 'photo'] as const;
type Step = (typeof STEPS)[number];

// The same four colours the circle map assigns to members, so this preview is
// literally what they are about to see rather than generic marketing art.
const MEMBER_COLORS = ['#6C5CE7', '#00B894', '#E8804A', '#D6467F'] as const;

const KIND_OPTIONS: Array<{
  kind: CircleKind;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  hint: string;
  color: string;
}> = [
  { kind: 'family', icon: 'home', label: 'Family', hint: 'Parents, siblings, partner', color: colors.brandDeep },
  { kind: 'friends', icon: 'people', label: 'Friends', hint: 'Your closest few', color: colors.brand },
  { kind: 'college', icon: 'school', label: 'College', hint: 'Hostel, classmates, batchmates', color: colors.brandDeep },
  { kind: 'women', icon: 'female', label: 'Women only', hint: 'A women-only safety circle', color: colors.brandDeep },
  { kind: 'trip', icon: 'airplane', label: 'A trip', hint: 'One journey, then done', color: colors.brand },
  { kind: 'emergency', icon: 'alert-circle', label: 'Emergency', hint: 'Who to wake at 3am', color: colors.primary },
];

export function CircleCreateScreen({ navigation }: AppScreenProps<'CircleCreate'>) {
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);
  const firstName = (profile?.name ?? '').trim().split(' ')[0] || null;

  const [index, setIndex] = useState(0);
  const step: Step = STEPS[index];
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CircleKind | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(profile?.photoUri ?? null);
  const [submitting, setSubmitting] = useState(false);

  // One shared enter animation, restarted per step. Content slides up and fades
  // in; the CTA never moves, so the thumb has a fixed target the whole way.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [index, enter]);

  const contentStyle = {
    opacity: enter,
    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
  };

  const go = useCallback((delta: number) => {
    playTick();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIndex((i) => Math.min(STEPS.length - 1, Math.max(0, i + delta)));
  }, []);

  const back = () => {
    if (index === 0) {
      navigation.goBack();
      return;
    }
    go(-1);
  };

  const pickImage = async () => {
    // Android system photo picker, so no media permission is needed.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      void Haptics.selectionAsync();
      setPhotoUri(result.assets[0].uri);
    }
  };

  const finish = async () => {
    if (submitting) return;
    const chosen = KIND_OPTIONS.find((k) => k.kind === kind) ?? KIND_OPTIONS[0];
    setSubmitting(true);
    try {
      // Save the photo first if it changed, so members see a face on the map the
      // moment they join. A failure here must not cost them the circle.
      if (profile && photoUri && photoUri !== profile.photoUri) {
        try {
          const updated = await updateProfile(profile, {
            name: profile.name ?? '',
            photoUri,
          });
          dispatch(profileUpdated(updated));
        } catch {
          /* non-fatal, they can add it later from Profile */
        }
      }
      const circle = await createCircle({
        name: name.trim() || 'My circle',
        kind: chosen.kind,
        color: chosen.color,
        emoji: null,
        isDefault: true,
      });
      dispatch(circleAdded(circle));
      await setActiveCircle(circle.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      navigation.replace('CircleInvite', { circleId: circle.id });
    } catch (err) {
      if (err instanceof CirclesNotInstalledError) {
        appAlert(
          'Backend setup needed',
          'The circles tables are not installed on your Supabase project yet. Open Supabase, go to SQL Editor, paste the contents of sql/09_circles.sql and run it. Then try again.',
        );
      } else {
        appAlert("Couldn't create the circle", 'Check your connection and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const canAdvance = step === 'name' ? name.trim().length >= 2 : step === 'kind' ? kind !== null : true;

  const ctaLabel =
    step === 'photo' ? (submitting ? 'Creating…' : 'Create circle') : step === 'hero' ? 'Get started' : 'Continue';

  const onCta = () => {
    if (!canAdvance || submitting) return;
    if (step === 'photo') {
      void finish();
      return;
    }
    go(1);
  };

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['#201F27', '#17161C', '#100F14']}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Soft light bloom behind the content, so the ground has depth instead of
          reading as one flat block of colour. */}
      <View style={styles.bloom} pointerEvents="none" />

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <Pressable onPress={back} hitSlop={12} style={styles.backBtn} accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={24} color={colors.textOnInk} />
          </Pressable>
          <View style={styles.progress}>
            {STEPS.map((s, i) => (
              <View key={s} style={[styles.progressSeg, i <= index && styles.progressSegOn]} />
            ))}
          </View>
          <View style={styles.backBtn} />
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Animated.View style={[styles.body, contentStyle]}>
            {step === 'hero' ? (
              <>
                <Text style={styles.h1}>
                  {firstName ? `${firstName}, who comes\nwhen you call?` : 'Who comes\nwhen you call?'}
                </Text>
                <CirclePreview photoUri={photoUri} />
                <Text style={styles.lead}>
                  A circle is up to four people who see you on a map when you want them to, and get
                  your location the instant you fire an SOS.
                </Text>
              </>
            ) : null}

            {step === 'name' ? (
              <>
                <Text style={styles.h1}>Name your circle</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Family"
                  placeholderTextColor="rgba(243,240,228,0.32)"
                  style={styles.bigInput}
                  maxLength={28}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={onCta}
                />
                <Text style={styles.lead}>
                  You can have more than one. Home, hostel, the group you travel with.
                </Text>
              </>
            ) : null}

            {step === 'kind' ? (
              <>
                <Text style={styles.h1}>What is it for?</Text>
                <ScrollView
                  style={styles.kindScroll}
                  contentContainerStyle={styles.kindList}
                  showsVerticalScrollIndicator={false}
                >
                  {KIND_OPTIONS.map((k) => {
                    const on = kind === k.kind;
                    return (
                      <Pressable
                        key={k.kind}
                        onPress={() => {
                          playTick();
                          void Haptics.selectionAsync();
                          setKind(k.kind);
                        }}
                        style={[styles.kindPill, on && styles.kindPillOn]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                      >
                        <View style={[styles.kindIcon, on && styles.kindIconOn]}>
                          <Ionicons
                            name={k.icon}
                            size={17}
                            color={on ? colors.brandDeep : colors.textOnInk}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.kindLabel, on && styles.kindLabelOn]}>{k.label}</Text>
                          <Text style={[styles.kindHint, on && styles.kindHintOn]}>{k.hint}</Text>
                        </View>
                        {on ? <Ionicons name="checkmark-circle" size={20} color={colors.brandDeep} /> : null}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </>
            ) : null}

            {step === 'photo' ? (
              <>
                <Text style={styles.h1}>Put a face on the map</Text>
                <Text style={styles.lead}>
                  Your circle sees your photo in your colour, so at a glance they know it is you and
                  not a dot.
                </Text>
                <Pressable onPress={pickImage} style={styles.photoWrap} accessibilityLabel="Add your photo">
                  <View style={[styles.photoRing, { borderColor: MEMBER_COLORS[0] }]}>
                    {photoUri ? (
                      <Image source={{ uri: photoUri }} style={styles.photoImg} />
                    ) : (
                      <View style={styles.photoEmpty}>
                        <Ionicons name="camera" size={26} color={colors.textInverse} />
                      </View>
                    )}
                  </View>
                  <Text style={styles.photoCta}>{photoUri ? 'Change photo' : 'Add your photo'}</Text>
                </Pressable>
              </>
            ) : null}
          </Animated.View>

          {/* Fixed footer. The button sits in the same place on every step. */}
          <View style={styles.footer}>
            {step === 'hero' ? (
              <Text style={styles.promise}>
                Only your circle sees you. Never sold, never given to a college, and today's route is
                deleted at midnight.
              </Text>
            ) : null}
            <Pressable
              onPress={onCta}
              disabled={!canAdvance || submitting}
              style={[styles.cta, (!canAdvance || submitting) && styles.ctaOff]}
              accessibilityRole="button"
            >
              <Text style={styles.ctaText}>{ctaLabel}</Text>
            </Pressable>
            {step === 'photo' ? (
              <Pressable onPress={() => void finish()} style={styles.skip} accessibilityRole="button">
                <Text style={styles.skipText}>Skip for now</Text>
              </Pressable>
            ) : (
              <View style={styles.skip} />
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

/**
 * The hero illustration: a soft disc suggesting a map, with four pins in the
 * exact colours the circle map uses. Drawn rather than shipped as an image, so
 * it always matches the product and costs nothing in the bundle.
 */
function CirclePreview({ photoUri }: { photoUri: string | null }) {
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [float]);

  const pins = useMemo(
    () => [
      { color: MEMBER_COLORS[0], top: 18, left: 14, delay: 0, me: true },
      { color: MEMBER_COLORS[1], top: 78, left: 96, delay: 1, me: false },
      { color: MEMBER_COLORS[2], top: 34, left: 158, delay: 2, me: false },
      { color: MEMBER_COLORS[3], top: 124, left: 58, delay: 3, me: false },
    ],
    [],
  );

  return (
    <View style={styles.preview}>
      <View style={styles.previewDisc}>
        {/* Suggested streets. Deliberately abstract, not a fake city. */}
        <View style={[styles.road, { top: 62, left: 0, right: 0, height: 9 }]} />
        <View style={[styles.road, { top: 128, left: 0, right: 0, height: 6 }]} />
        <View style={[styles.road, { left: 74, top: 0, bottom: 0, width: 9 }]} />
        <View style={[styles.road, { left: 168, top: 0, bottom: 0, width: 6 }]} />
        <View style={styles.park} />
      </View>
      {pins.map((p, i) => (
        <Animated.View
          key={i}
          style={[
            styles.pin,
            {
              top: p.top,
              left: p.left,
              borderColor: p.color,
              transform: [
                {
                  translateY: float.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, i % 2 === 0 ? -5 : 4],
                  }),
                },
              ],
            },
          ]}
        >
          {p.me && photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.pinImg} />
          ) : (
            <View style={[styles.pinFill, { backgroundColor: p.color }]}>
              <Ionicons name="person" size={16} color={colors.textInverse} />
            </View>
          )}
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.dark },
  bloom: {
    position: 'absolute',
    top: -110,
    right: -90,
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: 'rgba(134,114,206,0.20)',
  },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  progress: { flex: 1, flexDirection: 'row', gap: 5 },
  progressSeg: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(243,240,228,0.20)',
  },
  progressSegOn: { backgroundColor: colors.brand },

  body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
  h1: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 30,
    lineHeight: 38,
    color: colors.textOnInk,
    letterSpacing: -0.5,
  },
  lead: {
    fontFamily: fontFamilies.poppinsRegular,
    fontSize: 14.5,
    lineHeight: 22,
    color: 'rgba(243,240,228,0.72)',
    marginTop: spacing.md,
  },

  bigInput: {
    marginTop: spacing.xl,
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 34,
    color: colors.textOnInk,
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(243,240,228,0.26)',
    paddingBottom: spacing.sm,
  },

  kindScroll: { marginTop: spacing.lg, marginHorizontal: -4 },
  kindList: { gap: 9, paddingHorizontal: 4, paddingBottom: spacing.md },
  kindPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: radius.xl,
    backgroundColor: 'rgba(243,240,228,0.10)',
  },
  kindPillOn: { backgroundColor: colors.cream },
  kindIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(243,240,228,0.12)',
  },
  kindIconOn: { backgroundColor: colors.brandSoft },
  kindLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15.5, color: colors.textOnInk },
  kindLabelOn: { color: colors.textPrimary },
  kindHint: {
    fontFamily: fontFamilies.poppinsRegular,
    fontSize: 12.5,
    color: 'rgba(243,240,228,0.55)',
    marginTop: 1,
  },
  kindHintOn: { color: colors.textSecondary },

  preview: { height: 210, marginTop: spacing.xl, alignSelf: 'center', width: 232 },
  previewDisc: {
    position: 'absolute',
    left: 8,
    top: 6,
    width: 200,
    height: 190,
    borderRadius: 100,
    backgroundColor: colors.cream,
    overflow: 'hidden',
  },
  road: { position: 'absolute', backgroundColor: '#E9E2CF' },
  park: {
    position: 'absolute',
    right: 8,
    top: 10,
    width: 58,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#E6F1EC',
  },
  pin: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 3,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pinImg: { width: '100%', height: '100%' },
  pinFill: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },

  photoWrap: { alignItems: 'center', marginTop: spacing.xl },
  photoRing: {
    width: 132,
    height: 132,
    borderRadius: 66,
    borderWidth: 4,
    backgroundColor: 'rgba(243,240,228,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoImg: { width: '100%', height: '100%' },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },
  photoCta: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14.5,
    color: colors.textOnInk,
    marginTop: spacing.md,
  },

  footer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  promise: {
    fontFamily: fontFamilies.poppinsRegular,
    fontSize: 12,
    lineHeight: 18,
    color: 'rgba(243,240,228,0.5)',
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  cta: {
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingVertical: 17,
    alignItems: 'center',
  },
  ctaOff: { opacity: 0.42 },
  ctaText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 16, color: colors.textInverse },
  skip: { height: 40, alignItems: 'center', justifyContent: 'center' },
  skipText: { fontFamily: fontFamilies.poppinsRegular, fontSize: 14, color: 'rgba(243,240,228,0.7)' },
});
