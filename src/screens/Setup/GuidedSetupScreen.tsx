import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { appAlert, Celebration } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { contactAdded } from '@/redux/slices/userSlice';
import { upsertEmergencyContact } from '@/services/emergency-contacts';
import { armVoiceSos } from '@/services/voice-detection';
import { VoiceDurationSheet } from '@/components/common';
import { runVoiceTest, cancelVoiceTest } from '@/services/voice-test';
import { requestBatteryExemption } from '@/services/background-voice';
import { getCurrentPermission } from '@/services/location';
import { trackEvent } from '@/services/analytics';

// First-run guided setup, shown once after sign-in (per the reference design):
//   1. Build Your Safety Circle, add the people ORBII reaches in an emergency
//   2. Turn on Voice SOS       , activate hands-free "help, help" protection
//   3. Try it once             , she actually SAYS "help, help" and feels the
//      engine hear her (routed to a callback, so nobody is alerted). This is the
//      aha moment: the core promise proven in her own voice before she needs it.
//   4. You're Protected        , an HONEST checklist (rows only turn green
//      when the underlying signal is actually true), then enter the app.

type StepId = 'intent' | 'circle' | 'voice' | 'practice' | 'done';
type DemoState = 'idle' | 'listening' | 'heard' | 'missed';

// Ordered so the progress bar always knows where we are. The founder note is a
// full-screen coda AFTER setup, so it deliberately sits outside this list.
const STEP_ORDER: StepId[] = ['intent', 'circle', 'voice', 'practice', 'done'];

const ROLES = [
  { key: 'Parent', icon: 'person' as const },
  { key: 'Guardian', icon: 'shield-half' as const },
  { key: 'Friend', icon: 'people' as const },
  { key: 'Partner', icon: 'heart' as const },
];

// Personalisation. Picking what's on her mind lets the whole setup speak to HER
// situation, and makes ORBII feel like it was set up for her, not everyone.
// Multi-select on purpose: most people carry more than one worry.
const INTENTS = [
  { key: 'night', label: 'Walking alone at night', icon: 'moon' as const, said: 'walking home at night' },
  { key: 'commute', label: 'My daily commute', icon: 'bus' as const, said: 'on your commute' },
  { key: 'travel', label: 'Travelling somewhere new', icon: 'airplane' as const, said: 'travelling' },
  { key: 'campus', label: 'On campus', icon: 'school' as const, said: 'on campus' },
  { key: 'cabs', label: 'Cabs and autos', icon: 'car' as const, said: 'in a cab' },
  { key: 'justcase', label: 'Just in case', icon: 'shield-checkmark' as const, said: 'the moment you need it' },
];

// Turn her picks into one warm, personalised line she sees echoed back.
function reflection(intents: string[]): string {
  const first = INTENTS.find((i) => i.key === intents[0]);
  if (!first) return 'ORBII will be ready the moment you need it.';
  return `ORBII will be ready when you're ${first.said}.`;
}

export function GuidedSetupScreen({ onDone }: { onDone: () => void }) {
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);
  const contacts = profile?.emergencyContacts ?? [];

  const [step, setStep] = useState<StepId>('intent');
  const [intents, setIntents] = useState<string[]>([]);
  const [openRole, setOpenRole] = useState<string | null>(null);
  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [activating, setActivating] = useState(false);
  const [durationOpen, setDurationOpen] = useState(false);
  const armedHoursRef = useRef(2);
  const [voiceOn, setVoiceOn] = useState(false);
  const [locationOn, setLocationOn] = useState(false);
  // Live "say help" demo. She speaks; the real on-device engine hears her and we
  // route that detection to a callback (runVoiceTest) instead of firing an SOS,
  // so nobody is alerted. It's the first time she experiences the core promise,
  // in her own voice, before she ever needs it.
  const [demo, setDemo] = useState<DemoState>('idle');
  const demoActiveRef = useRef(false);
  // Gift-moment celebration on the final "You're Protected" reveal.
  const [celebrate, setCelebrate] = useState(false);

  // Gentle slide-in per step.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: 360,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, [step, enter]);

  // Real signals for the final checklist. The reveal is a "gift" moment: a short
  // beat, then the confetti + success haptic land together.
  useEffect(() => {
    if (step !== 'done') return;
    getCurrentPermission()
      .then((p) => setLocationOn(p === 'granted'))
      .catch(() => undefined);
    const id = setTimeout(() => {
      setCelebrate(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }, 380);
    return () => clearTimeout(id);
  }, [step]);

  const saveContact = () => {
    const digits = cPhone.replace(/\D/g, '');
    if (!cName.trim() || digits.length < 10) return;
    // A guardian can't be you. Block your own number so an SOS never pings
    // a dead end.
    const ownDigits = (profile?.phone ?? '').replace(/\D/g, '').slice(-10);
    if (ownDigits && digits.slice(-10) === ownDigits) {
      appAlert(
        'That is your own number',
        'Your guardian has to be someone else who can reach you.',
      );
      return;
    }
    const contact = {
      id: `c_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      name: cName.trim(),
      relation: openRole ?? 'Family',
      phone: `+91${digits.slice(-10)}`,
    };
    dispatch(contactAdded(contact));
    trackEvent('contact_added');
    if (profile?.uid) upsertEmergencyContact(profile.uid, contact).catch(() => undefined);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    setOpenRole(null);
    setCName('');
    setCPhone('');
  };

  // Turning on protection always picks a duration first (max 8h), like every
  // other Voice SOS gate.
  const activateProtection = () => {
    if (activating) return;
    setDurationOpen(true);
  };

  const onPickDuration = async (hours: number) => {
    setDurationOpen(false);
    armedHoursRef.current = hours;
    setActivating(true);
    try {
      const res = await armVoiceSos(hours);
      setVoiceOn(res.ok);
      if (res.ok) await requestBatteryExemption().catch(() => undefined);
      trackEvent('setup_protection_activated', { ok: res.ok });
    } finally {
      setActivating(false);
      setStep('practice');
    }
  };

  // Pulsing mic ring while listening.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (demo !== 'listening') {
      pulse.stopAnimation();
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.16, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [demo, pulse]);

  // Stop the mic/engine if she leaves the demo (back out, unmount) mid-listen.
  useEffect(() => {
    return () => {
      if (demoActiveRef.current) {
        demoActiveRef.current = false;
        cancelVoiceTest();
      }
    };
  }, []);

  const startDemo = async () => {
    if (demo === 'listening' || demo === 'heard') return;
    setDemo('listening');
    demoActiveRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    const result = await runVoiceTest(20000);
    demoActiveRef.current = false;
    if (result === 'heard') {
      setDemo('heard');
      setCelebrate(true);
      trackEvent('onboarding_voice_demo', { result: 'heard' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      // The test consumed the fire and stopped the engine. Re-arm for the same
      // duration she chose, so protection carries on into the app.
      void armVoiceSos(armedHoursRef.current);
    } else {
      // Timeout, no mic, or a non-Android device: never trap her here. Let her
      // retry, and still allow her to move on.
      setDemo('missed');
      trackEvent('onboarding_voice_demo', { result });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    }
  };

  const leaveDemo = (next: StepId) => {
    if (demoActiveRef.current) {
      demoActiveRef.current = false;
      cancelVoiceTest();
    }
    setStep(next);
  };

  const toggleIntent = (key: string) => {
    Haptics.selectionAsync().catch(() => undefined);
    setIntents((cur) =>
      cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key],
    );
  };

  const stepIndex = STEP_ORDER.indexOf(step);
  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [18, 0] });

  const finishSetup = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    trackEvent('setup_completed', {
      contacts: contacts.length,
      voice: voiceOn,
      location: locationOn,
    });
    onDone();
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {/* ORBII lockup header */}
        <View style={styles.brandRow}>
          <Ionicons name="shield-checkmark" size={16} color={colors.peachDeep} />
          <Text style={styles.brand}>ORBII</Text>
        </View>

        {/* Step progress, a small "you're moving" signal all the way through. */}
        <View style={styles.progress}>
          {STEP_ORDER.map((s, i) => (
            <View
              key={s}
              style={[
                styles.progressSeg,
                i <= stepIndex ? styles.progressSegOn : styles.progressSegOff,
              ]}
            />
          ))}
        </View>

        <Animated.View style={{ flex: 1, opacity: enter, transform: [{ translateY }] }}>
          {step === 'intent' ? (
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              <StepHero icon="sparkles" accent={colors.brand} accentSoft={colors.brandSoft} />
              <Text style={styles.title}>When do you want ORBII ready?</Text>
              <Text style={styles.sub}>
                Pick whatever is on your mind. Choose as many as you like, we'll
                set ORBII up around them.
              </Text>

              <View style={styles.chipsWrap}>
                {INTENTS.map((it) => {
                  const on = intents.includes(it.key);
                  return (
                    <Pressable
                      key={it.key}
                      onPress={() => toggleIntent(it.key)}
                      style={[styles.chip, on && styles.chipOn]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                    >
                      <Ionicons
                        name={it.icon}
                        size={17}
                        color={on ? colors.textInverse : colors.peachDeep}
                      />
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{it.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                onPress={() => setStep('circle')}
                disabled={intents.length === 0}
                style={({ pressed }) => [
                  styles.cta,
                  intents.length === 0 && { opacity: 0.5 },
                  pressed && styles.ctaPressed,
                ]}
              >
                <Text style={styles.ctaText}>
                  {intents.length === 0 ? 'Pick at least one' : 'Continue'}
                </Text>
              </Pressable>
            </ScrollView>
          ) : null}

          {step === 'circle' ? (
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              <StepHero icon="people" accent={colors.peach} accentSoft={colors.peachSoft} />
              {/* Reflection: her own choice echoed back, so setup feels made for her. */}
              <View style={styles.reflect}>
                <Ionicons name="sparkles" size={13} color={colors.peachDeep} />
                <Text style={styles.reflectText}>{reflection(intents)}</Text>
              </View>

              <Text style={styles.title}>Who should ORBII reach?</Text>
              <Text style={styles.sub}>
                The instant you need help, these people get your live location.
                Add even one, an SOS with no circle reaches no one.
              </Text>

              {ROLES.map((r) => {
                const added = contacts.find((c) => c.relation === r.key);
                const open = openRole === r.key;
                return (
                  <View key={r.key} style={styles.roleCard}>
                    <Pressable
                      onPress={() => {
                        setOpenRole(open ? null : r.key);
                        setCName('');
                        setCPhone('');
                      }}
                      style={styles.roleRow}
                      accessibilityRole="button"
                    >
                      <View style={[styles.roleIcon, added && styles.roleIconDone]}>
                        <Ionicons
                          name={added ? 'checkmark' : r.icon}
                          size={18}
                          color={added ? colors.sageDeep : colors.peachDeep}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.roleLabel}>{r.key}</Text>
                        {added ? <Text style={styles.roleAdded}>{added.name} added</Text> : null}
                      </View>
                      <View style={styles.plusCircle}>
                        <Ionicons name={open ? 'remove' : 'add'} size={18} color={colors.peachDeep} />
                      </View>
                    </Pressable>
                    {open ? (
                      <View style={styles.miniForm}>
                        <TextInput
                          value={cName}
                          onChangeText={setCName}
                          placeholder="Name"
                          placeholderTextColor={colors.textMuted}
                          autoCapitalize="words"
                          style={styles.input}
                        />
                        <TextInput
                          value={cPhone}
                          onChangeText={(t) => setCPhone(t.replace(/\D/g, '').slice(0, 10))}
                          placeholder="Phone (10 digits)"
                          placeholderTextColor={colors.textMuted}
                          keyboardType="phone-pad"
                          style={styles.input}
                        />
                        <Pressable
                          onPress={saveContact}
                          disabled={!cName.trim() || cPhone.length < 10}
                          style={({ pressed }) => [
                            styles.miniSave,
                            (!cName.trim() || cPhone.length < 10) && { opacity: 0.5 },
                            pressed && { opacity: 0.9 },
                          ]}
                        >
                          <Text style={styles.miniSaveText}>Add to circle</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                );
              })}

              <Pressable
                onPress={() => setStep('voice')}
                style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
              >
                <Text style={styles.ctaText}>Continue</Text>
              </Pressable>
              {contacts.length === 0 ? (
                <Text style={styles.skipNote}>You can add people later, but an SOS with no circle reaches no one.</Text>
              ) : null}
            </ScrollView>
          ) : null}

          {step === 'voice' ? (
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              <StepHero icon="mic" accent={colors.coral} accentSoft={colors.coralSoft} />
              <Text style={styles.title}>Turn on Voice SOS</Text>
              <Text style={styles.sub}>
                If you can't reach your phone, just shout "help, help" and ORBII
                triggers an SOS on its own.
              </Text>

              <View style={styles.voiceCard}>
                <View style={styles.voiceBadge}>
                  <Ionicons name="mic" size={26} color={colors.coralDeep} />
                </View>
                <Text style={styles.voiceCue}>"Help, help!"</Text>
                <Text style={styles.voiceCueSub}>
                  That's it. Nothing to memorise, in English or Hindi.
                </Text>
              </View>

              <View style={styles.privacyCard}>
                <Ionicons name="shield-outline" size={18} color={colors.sageDeep} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.privacyTitle}>Privacy First</Text>
                  <Text style={styles.privacyBody}>
                    Listening happens on your phone. Your voice is not uploaded, unless you choose to donate a clip.
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={activateProtection}
                disabled={activating}
                style={({ pressed }) => [styles.cta, activating && { opacity: 0.6 }, pressed && styles.ctaPressed]}
              >
                <Text style={styles.ctaText}>{activating ? 'Activating…' : 'Activate Protection'}</Text>
              </Pressable>
              <Text style={styles.skipNote}>
                We'll ask for microphone access so ORBII can listen for you.
              </Text>
            </ScrollView>
          ) : null}

          {step === 'practice' ? (
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              <StepHero icon="ear" accent={colors.brand} accentSoft={colors.brandSoft} />
              <Text style={styles.title}>Now try it yourself</Text>
              <Text style={styles.sub}>
                {demo === 'heard'
                  ? 'ORBII heard you. That is exactly how it works in a real emergency, hands-free.'
                  : 'Say “help, help” out loud. ORBII will hear you, right now, so you know it works before you ever need it. Nobody is alerted.'}
              </Text>

              <View style={styles.practiceWrap}>
                <Pressable
                  onPress={startDemo}
                  disabled={demo === 'listening' || demo === 'heard'}
                  style={({ pressed }) => [
                    styles.demoOrb,
                    demo === 'heard' && styles.demoOrbHeard,
                    demo === 'listening' && styles.demoOrbListening,
                    pressed && demo === 'idle' && { transform: [{ scale: 0.97 }] },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={demo === 'heard' ? 'ORBII heard you' : 'Tap, then say help help'}
                >
                  {demo === 'heard' ? (
                    <Ionicons name="checkmark" size={52} color={colors.textInverse} />
                  ) : demo === 'listening' ? (
                    <Animated.View style={{ transform: [{ scale: pulse }] }}>
                      <Ionicons name="mic" size={48} color={colors.textInverse} />
                    </Animated.View>
                  ) : (
                    <Ionicons name="mic-outline" size={48} color={colors.textInverse} />
                  )}
                </Pressable>
                <Text style={styles.practiceHint}>
                  {demo === 'heard'
                    ? 'Heard you, loud and clear.'
                    : demo === 'listening'
                      ? 'Listening… say “help, help” now.'
                      : demo === 'missed'
                        ? "Didn't catch that. Move somewhere quieter and tap to try again."
                        : 'Tap the mic, then say “help, help”.'}
                </Text>
              </View>

              <Pressable
                onPress={() => leaveDemo('done')}
                disabled={demo !== 'heard'}
                style={({ pressed }) => [
                  styles.cta,
                  demo !== 'heard' && { opacity: 0.5 },
                  pressed && styles.ctaPressed,
                ]}
              >
                <Text style={styles.ctaText}>
                  {demo === 'heard' ? 'Continue' : 'Say “help, help” to continue'}
                </Text>
              </Pressable>
              {demo === 'missed' ? (
                <Pressable onPress={() => leaveDemo('done')} hitSlop={8}>
                  <Text style={styles.skipNote}>Skip for now, I'll try later</Text>
                </Pressable>
              ) : (
                <Text style={styles.skipNote}>
                  Your voice is heard on your phone, and only shared if you choose to donate a clip.
                </Text>
              )}
            </ScrollView>
          ) : null}

          {step === 'done' ? (
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              <StepHero icon="shield-checkmark" accent={colors.sage} accentSoft={colors.sageSoft} />
              <Text style={styles.title}>You're Protected</Text>
              <Text style={styles.sub}>ORBII is now ready to watch over you.</Text>

              <CheckRow ok={locationOn} label="Location enabled" fixHint="Enable from Home when asked" />
              <CheckRow ok={voiceOn} label="Voice trigger active" fixHint="Turn on from Home, Voice SOS card" />
              <CheckRow
                ok={contacts.length > 0}
                label="Safety circle created"
                fixHint="Add people from Profile, Emergency contacts"
              />

              <Pressable
                onPress={finishSetup}
                style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
              >
                <Text style={styles.ctaText}>Enter ORBII</Text>
              </Pressable>
            </ScrollView>
          ) : null}
        </Animated.View>

        {/* Positive gift-moment only, never shown for an SOS. */}
        <Celebration visible={celebrate} originY={0.34} onDone={() => setCelebrate(false)} />
        <VoiceDurationSheet
          visible={durationOpen}
          onConfirm={onPickDuration}
          onCancel={() => setDurationOpen(false)}
        />
      </SafeAreaView>
    </View>
  );
}

// Honest checklist row: green only when the signal is really true.
function CheckRow({ ok, label, fixHint }: { ok: boolean; label: string; fixHint: string }) {
  return (
    <View style={styles.checkRow}>
      <View style={[styles.checkIcon, ok ? styles.checkIconOn : styles.checkIconOff]}>
        <Ionicons name={ok ? 'checkmark' : 'ellipse-outline'} size={16} color={ok ? '#FFFFFF' : colors.textMuted} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.checkLabel}>{label}</Text>
        {!ok ? <Text style={styles.checkHint}>{fixHint}</Text> : null}
      </View>
    </View>
  );
}

// Clean icon-in-orb hero for each setup step (replaces the mascot artwork).
function StepHero({
  icon,
  accent,
  accentSoft,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  accent: string;
  accentSoft: string;
}) {
  return (
    <View style={styles.stepHero}>
      <View style={[styles.stepHeroOrb, { backgroundColor: accentSoft }]}>
        <View style={[styles.stepHeroInner, { backgroundColor: accent }]}>
          <Ionicons name={icon} size={36} color={colors.textInverse} />
        </View>
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
  },
  brand: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13,
    letterSpacing: 3,
    color: colors.textPrimary,
  },
  progress: {
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  progressSeg: { flex: 1, height: 4, borderRadius: 2 },
  progressSegOn: { backgroundColor: colors.peach },
  progressSegOff: { backgroundColor: colors.creamDeep },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    ...shadows.icon,
  },
  chipOn: { backgroundColor: colors.peach, borderColor: colors.peach },
  chipText: { fontFamily: fontFamilies.poppinsMedium, fontSize: 13.5, color: colors.textPrimary },
  chipTextOn: { color: colors.textInverse },
  reflect: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'center',
    backgroundColor: colors.peachSoft,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  reflectText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.peachDeep },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, alignItems: 'stretch' },
  stepHero: { alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.md },
  stepHeroOrb: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepHeroInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 26,
    color: colors.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  sub: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: spacing.lg,
  },
  roleCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    marginBottom: spacing.sm,
    ...shadows.card,
    overflow: 'hidden',
  },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  roleIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.peachSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleIconDone: { backgroundColor: colors.sageSoft },
  roleLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary },
  roleAdded: { ...typography.caption, fontSize: 12, color: colors.sageDeep, marginTop: 1 },
  plusCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.peachSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniForm: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  input: {
    backgroundColor: colors.cream,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontFamily: fontFamilies.interMedium,
    fontSize: 14.5,
    color: colors.textPrimary,
  },
  miniSave: {
    backgroundColor: colors.peach,
    borderRadius: radius.pill,
    paddingVertical: 11,
    alignItems: 'center',
  },
  miniSaveText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textPrimary },
  voiceCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
    ...shadows.card,
  },
  voiceBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.coralSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  voiceCue: { fontFamily: fontFamilies.poppinsBold, fontSize: 22, color: colors.textPrimary },
  voiceCueSub: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  privacyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.sageSoft,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  privacyTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textPrimary },
  privacyBody: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: 1, lineHeight: 16 },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.card,
  },
  checkIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkIconOn: { backgroundColor: colors.sage },
  checkIconOff: { backgroundColor: colors.creamDeep },
  checkLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14.5, color: colors.textPrimary },
  checkHint: { ...typography.caption, fontSize: 11.5, color: colors.textMuted, marginTop: 1 },
  // Full-page founder letter.
  noteRoot: { flex: 1, backgroundColor: colors.cream },
  noteGlow: { position: 'absolute', top: 0, left: 0, right: 0, height: 360 },
  noteScroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.xl },
  noteEyebrow: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 11,
    letterSpacing: 2.5,
    color: colors.brandDeep,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  paper: {
    backgroundColor: '#FFFDF7',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#ECE4D2',
    paddingHorizontal: spacing.lg + 4,
    paddingVertical: spacing.xl,
    ...shadows.card,
  },
  paperBody: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 16,
    lineHeight: 26,
    color: '#3A3540',
  },
  paperRule: {
    height: 1,
    backgroundColor: '#ECE4D2',
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  paperSign: {
    fontFamily: fontFamilies.handwriting,
    fontSize: 34,
    lineHeight: 38,
    color: colors.brandDeep,
  },
  paperSignRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  paperSignSub: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 11.5, letterSpacing: 0.4, color: colors.textMuted },
  noteFooter: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, paddingTop: spacing.sm },
  noteCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingVertical: 16,
    ...shadows.card,
  },
  noteCtaText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15.5, color: colors.textInverse },
  practiceWrap: { alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  demoOrb: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  demoOrbListening: { backgroundColor: colors.coral },
  demoOrbHeard: { backgroundColor: colors.sage },
  practiceHint: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 300,
  },
  cta: {
    backgroundColor: colors.peach,
    borderRadius: radius.pill,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: spacing.lg,
    ...shadows.card,
  },
  ctaPressed: { transform: [{ scale: 0.98 }], opacity: 0.95 },
  ctaText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15.5, color: colors.textPrimary },
  skipNote: {
    ...typography.caption,
    fontSize: 11.5,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
