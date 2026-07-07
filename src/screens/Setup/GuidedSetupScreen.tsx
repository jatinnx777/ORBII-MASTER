import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { appAlert } from '@/components/common';
// The real illustrated Orbi (from the brand artwork).
const ORBI_HERO = require('../../../assets/onboarding/orbi-hero.png');
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { contactAdded } from '@/redux/slices/userSlice';
import { upsertEmergencyContact } from '@/services/emergency-contacts';
import { addPhrase, PHRASE_EXAMPLES } from '@/services/voice-phrases';
import { startListening } from '@/services/voice-detection';
import { requestBatteryExemption } from '@/services/background-voice';
import { getCurrentPermission } from '@/services/location';
import { trackEvent } from '@/services/analytics';

// First-run guided setup, shown once after sign-in (per the reference design):
//   1. Build Your Safety Circle  — add the people ORBII reaches in an emergency
//   2. Choose Your Secret Phrase — her own phrase + activate voice protection
//   3. You're Protected          — an HONEST checklist (rows only turn green
//      when the underlying signal is actually true), then enter the app.

type StepId = 'circle' | 'phrase' | 'done';

const ROLES = [
  { key: 'Parent', icon: 'person' as const },
  { key: 'Guardian', icon: 'shield-half' as const },
  { key: 'Friend', icon: 'people' as const },
  { key: 'Partner', icon: 'heart' as const },
];

export function GuidedSetupScreen({ onDone }: { onDone: () => void }) {
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);
  const contacts = profile?.emergencyContacts ?? [];

  const [step, setStep] = useState<StepId>('circle');
  const [openRole, setOpenRole] = useState<string | null>(null);
  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [phrase, setPhrase] = useState('');
  const [activating, setActivating] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [locationOn, setLocationOn] = useState(false);

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

  // Real signals for the final checklist.
  useEffect(() => {
    if (step !== 'done') return;
    getCurrentPermission()
      .then((p) => setLocationOn(p === 'granted'))
      .catch(() => undefined);
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

  const activateProtection = async () => {
    if (activating) return;
    setActivating(true);
    try {
      const p = phrase.trim();
      if (p.length >= 3) await addPhrase(p).catch(() => undefined);
      const res = await startListening();
      setVoiceOn(res.ok);
      // OEM killer fix: ask the system to keep ORBII alive in the background.
      // On Xiaomi/Oppo/Vivo the voice service is killed otherwise, silently
      // breaking protection. Baking this into setup makes it hard to skip.
      if (res.ok) await requestBatteryExemption().catch(() => undefined);
      trackEvent('setup_protection_activated', { ok: res.ok, customPhrase: p.length >= 3 });
    } finally {
      setActivating(false);
      setStep('done');
    }
  };

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [18, 0] });

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {/* ORBII lockup header */}
        <View style={styles.brandRow}>
          <Ionicons name="shield-checkmark" size={16} color={colors.peachDeep} />
          <Text style={styles.brand}>ORBII</Text>
        </View>

        <Animated.View style={{ flex: 1, opacity: enter, transform: [{ translateY }] }}>
          {step === 'circle' ? (
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              <View style={styles.heroWrap}>
                <View style={styles.bubble}>
                  <Text style={styles.bubbleText}>The more trusted people{'\n'}around you, the safer you are.</Text>
                </View>
                <Image source={ORBI_HERO} style={styles.heroImg} resizeMode="contain" />
              </View>
              <Text style={styles.title}>Build Your Safety Circle</Text>
              <Text style={styles.sub}>Add the people you'd want ORBII to reach in an emergency.</Text>

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
                onPress={() => setStep('phrase')}
                style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
              >
                <Text style={styles.ctaText}>Continue</Text>
              </Pressable>
              {contacts.length === 0 ? (
                <Text style={styles.skipNote}>You can add people later, but an SOS with no circle reaches no one.</Text>
              ) : null}
            </ScrollView>
          ) : null}

          {step === 'phrase' ? (
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              <View style={styles.heroWrap}>
                <Image source={ORBI_HERO} style={styles.heroImg} resizeMode="contain" />
              </View>
              <Text style={styles.title}>Choose Your Secret Phrase</Text>
              <Text style={styles.sub}>ORBII listens only for your emergency phrase.</Text>

              <View style={styles.fieldCard}>
                <Text style={styles.fieldLabel}>Emergency Phrase</Text>
                <TextInput
                  value={phrase}
                  onChangeText={setPhrase}
                  placeholder="Type your phrase"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={40}
                  style={styles.input}
                />
              </View>

              <Text style={styles.examplesLabel}>Examples</Text>
              <View style={styles.chipsRow}>
                {PHRASE_EXAMPLES.map((ex) => (
                  <Pressable
                    key={ex}
                    onPress={() => setPhrase(ex.toLowerCase())}
                    style={({ pressed }) => [styles.chip, pressed && { opacity: 0.85 }]}
                  >
                    <Text style={styles.chipText}>{ex}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.privacyCard}>
                <Ionicons name="shield-outline" size={18} color={colors.sageDeep} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.privacyTitle}>Privacy First</Text>
                  <Text style={styles.privacyBody}>
                    Listening happens on your phone. Your voice is never uploaded or stored.
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
                Built-in phrases like "help help" always work, even without a custom phrase.
              </Text>
            </ScrollView>
          ) : null}

          {step === 'done' ? (
            <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
              <View style={styles.heroWrap}>
                <View style={styles.bubble}>
                  <Text style={styles.bubbleText}>I'm always here{'\n'}when you need me.</Text>
                </View>
                <Image source={ORBI_HERO} style={styles.heroImgBig} resizeMode="contain" />
              </View>
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
                onPress={() => {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
                  trackEvent('setup_completed', {
                    contacts: contacts.length,
                    voice: voiceOn,
                    location: locationOn,
                  });
                  onDone();
                }}
                style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
              >
                <Text style={styles.ctaText}>Enter ORBII</Text>
              </Pressable>
            </ScrollView>
          ) : null}
        </Animated.View>
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
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, alignItems: 'stretch' },
  heroWrap: { alignItems: 'center', marginTop: spacing.xs, marginBottom: spacing.sm },
  heroImg: { width: 190, height: 152 },
  heroImgBig: { width: 225, height: 180 },
  bubble: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.xs,
    ...shadows.icon,
  },
  bubbleText: { ...typography.caption, fontSize: 12.5, lineHeight: 17, color: colors.textSecondary, textAlign: 'center' },
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
  fieldCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  fieldLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13.5, color: colors.textPrimary },
  examplesLabel: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.textSecondary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    ...shadows.icon,
  },
  chipText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.textSecondary },
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
