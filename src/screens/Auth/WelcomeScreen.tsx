import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { PrivacyPolicyModal } from '@/components/common';
import {
  colors,
  fontFamilies,
  radius,
  spacing,
  touchTarget,
  typography,
} from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import {
  signInFailed,
  signInStarted,
  signInSucceeded,
} from '@/redux/slices/userSlice';
import { historyHydrated } from '@/redux/slices/historySlice';
import { policyAccepted } from '@/redux/slices/appSlice';
import { signInWithGoogle, DEV_AUTH } from '@/services/auth';
import { SUPPORTED_LOCALES, currentLocale, setLocale, type Locale } from '@/i18n';
import type { AuthScreenProps } from '@/navigation/types';

// Welcome screen — first impression. Matches the reference design:
// layered illustration block (logo + halo rings + tiny avatar pings),
// stacked CTAs (phone-first, email-soon, google), inline language
// picker at the bottom, encrypted reassurance line, terms agreement.
//
// We don't auto-fire any auth on mount — the user has to tap a method.
export function WelcomeScreen({ navigation }: AuthScreenProps<'Welcome'>) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.user.status);
  const policyAcceptedAt = useAppSelector((s) => s.app.policyAcceptedAt);
  const isSigningIn = status === 'signing_in';

  const [policyOpen, setPolicyOpen] = useState(false);
  const [locale, setActiveLocale] = useState<Locale>(currentLocale());
  const policyOk = policyAcceptedAt !== null;

  // Page enter + soft breathing on the logo halo.
  const enter = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 2400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 2400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [enter, breathe]);

  const handleGoogle = async () => {
    if (!policyOk) {
      setPolicyOpen(true);
      return;
    }
    dispatch(signInStarted());
    try {
      const { profile, needsProfile, history } = await signInWithGoogle();
      dispatch(signInSucceeded({ profile, needsProfile }));
      dispatch(historyHydrated(history));
      if (needsProfile) {
        navigation.reset({ index: 0, routes: [{ name: 'ProfileSetup' }] });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Google sign-in failed.';
      dispatch(signInFailed({ error: message }));
      if (!/cancel/i.test(message)) {
        Alert.alert("Couldn't sign in", message);
      }
    }
  };

  const handlePhone = () => {
    if (!policyOk) {
      setPolicyOpen(true);
      return;
    }
    navigation.navigate('PhoneSignIn');
  };

  const handleEmail = () => {
    Alert.alert(
      'Email sign-in coming soon',
      "We're rolling this out shortly. For now, please continue with phone or Google.",
    );
  };

  const handleLocalePill = async (code: Locale) => {
    setActiveLocale(code);
    await setLocale(code);
  };

  const enterTranslate = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });
  const breatheScale = breathe.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.025],
  });
  const haloPulse = breathe.interpolate({
    inputRange: [0, 1],
    outputRange: [0.85, 1.06],
  });
  const haloOpacity = breathe.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 0.25],
  });

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[colors.brandSoft, '#FFFFFF']}
        start={{ x: 0.3, y: 0 }}
        end={{ x: 0.7, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            style={[
              styles.content,
              { opacity: enter, transform: [{ translateY: enterTranslate }] },
            ]}
          >
            {/* HERO — logo, halo rings, breathing pulse, tiny avatar dots
                  arranged on a circle around the centre. Matches the
                  layered illustration in the reference. */}
            <View style={styles.hero}>
              <Animated.View
                style={[
                  styles.halo,
                  {
                    opacity: haloOpacity,
                    transform: [{ scale: haloPulse }],
                  },
                ]}
              />
              <View style={styles.haloRing} />
              <View style={[styles.haloRing, styles.haloRingOuter]} />
              <AvatarChip top={-4} left="50%" translateX={-18} kind="shield" />
              <AvatarChip top={48} left="10%" kind="profile" />
              <AvatarChip top={48} left="90%" translateX={-32} kind="profile" />
              <AvatarChip top={132} left="6%" kind="pin" />
              <AvatarChip top={132} left="94%" translateX={-32} kind="bell" />
              <Animated.View
                style={[
                  styles.logoCard,
                  { transform: [{ scale: breatheScale }] },
                ]}
              >
                <Image
                  source={require('../../../assets/icon.png')}
                  style={styles.logoImg}
                  resizeMode="contain"
                />
              </Animated.View>
            </View>

            <Text style={styles.brand}>{t('welcome.brand')}</Text>
            <Text style={styles.tagline}>{t('welcome.tagline')}</Text>

            <Text style={styles.heading}>
              {t('welcome.headlineLine1')}
              {'\n'}
              <Text style={styles.headingAccent}>
                {t('welcome.headlineLine2')}
              </Text>
            </Text>
            <Text style={styles.sub}>{t('welcome.subtitle')}</Text>

            {/* CTA STACK */}
            <View style={styles.ctaStack}>
              <Pressable
                onPress={handlePhone}
                disabled={isSigningIn}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  pressed && styles.primaryBtnPressed,
                  isSigningIn && styles.primaryBtnDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('welcome.continueWithPhone')}
              >
                <Ionicons
                  name="call"
                  size={18}
                  color={colors.textInverse}
                />
                <Text style={styles.primaryBtnLabel}>
                  {t('welcome.continueWithPhone')}
                </Text>
              </Pressable>

              <Pressable
                onPress={handleEmail}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  pressed && styles.secondaryBtnPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('welcome.continueWithEmail')}
              >
                <Ionicons
                  name="mail-outline"
                  size={18}
                  color={colors.textPrimary}
                />
                <Text style={styles.secondaryBtnLabel}>
                  {t('welcome.continueWithEmail')}
                </Text>
              </Pressable>

              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>{t('welcome.or')}</Text>
                <View style={styles.dividerLine} />
              </View>

              <Pressable
                onPress={handleGoogle}
                disabled={isSigningIn}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  pressed && styles.secondaryBtnPressed,
                  isSigningIn && styles.primaryBtnDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel={t('welcome.continueWithGoogle')}
              >
                <View style={styles.googleMark}>
                  <Text style={styles.googleMarkText}>G</Text>
                </View>
                <Text style={styles.secondaryBtnLabel}>
                  {isSigningIn ? '…' : t('welcome.continueWithGoogle')}
                </Text>
              </Pressable>
            </View>

            <View style={styles.reassureRow}>
              <Ionicons name="lock-closed" size={12} color={colors.brandDeep} />
              <Text style={styles.reassureText}>{t('welcome.encrypted')}</Text>
            </View>

            {/* INLINE LANGUAGE PILL ROW */}
            <View style={styles.langCard}>
              <Text style={styles.langCardTitle}>
                {t('welcome.chooseLanguage')}
              </Text>
              <View style={styles.langRow}>
                {SUPPORTED_LOCALES.map((code) => {
                  const selected = code === locale;
                  return (
                    <Pressable
                      key={code}
                      onPress={() => handleLocalePill(code)}
                      style={({ pressed }) => [
                        styles.langPill,
                        selected && styles.langPillSelected,
                        pressed && styles.pressedSubtle,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text
                        style={[
                          styles.langPillText,
                          selected && styles.langPillTextSelected,
                        ]}
                      >
                        {t(`language.names.${code}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Pressable
              onPress={() => setPolicyOpen(true)}
              style={({ pressed }) => [
                styles.privacyRow,
                pressed && styles.pressedSubtle,
              ]}
              accessibilityRole="button"
            >
              <Ionicons
                name="shield-outline"
                size={14}
                color={colors.textSecondary}
              />
              <Text style={styles.privacyText}>
                {t('welcome.learnPrivacy')}
              </Text>
              <Ionicons
                name="chevron-forward"
                size={14}
                color={colors.textSecondary}
              />
            </Pressable>

            <Pressable
              onPress={() => setPolicyOpen(true)}
              style={styles.termsRow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: policyOk }}
            >
              <View style={[styles.checkbox, policyOk && styles.checkboxChecked]}>
                {policyOk ? (
                  <Ionicons
                    name="checkmark"
                    size={11}
                    color={colors.textInverse}
                  />
                ) : null}
              </View>
              <Text style={styles.termsText}>
                {t('welcome.agreementPrefix')}{' '}
                <Text style={styles.termsLink}>{t('welcome.terms')}</Text>{' '}
                {t('welcome.and')}{' '}
                <Text style={styles.termsLink}>{t('welcome.privacy')}</Text>.
              </Text>
            </Pressable>

            {DEV_AUTH.enabled ? (
              <Text style={styles.devHint}>
                Sign-in is off in this build.
              </Text>
            ) : null}
          </Animated.View>
        </ScrollView>
      </SafeAreaView>

      <PrivacyPolicyModal
        visible={policyOpen}
        onAccept={() => {
          dispatch(policyAccepted());
          setPolicyOpen(false);
        }}
        onDecline={() => setPolicyOpen(false)}
      />
    </View>
  );
}

// Floating tiny avatar chip used to decorate the hero. Position via
// absolute top/left/translateX so the parent can stack them on a circle
// around the logo without a heavy SVG.
function AvatarChip({
  top,
  left,
  translateX = 0,
  kind,
}: {
  top: number;
  left: number | string;
  translateX?: number;
  kind: 'profile' | 'pin' | 'bell' | 'shield';
}) {
  const icon: React.ComponentProps<typeof Ionicons>['name'] =
    kind === 'pin'
      ? 'location'
      : kind === 'bell'
        ? 'notifications'
        : kind === 'shield'
          ? 'shield-checkmark'
          : 'person';
  // The bell chip represents an emergency alert — wash it in the danger
  // token's soft halo so it reads as SOS-adjacent without using orange.
  const accent = kind === 'bell' ? 'rgba(255,77,77,0.16)' : colors.brandSoft;
  const accentIcon = kind === 'bell' ? colors.error : colors.brandDeep;
  return (
    <View
      style={[
        styles.chip,
        {
          top,
          left: left as never,
          transform: [{ translateX }],
          backgroundColor: accent,
        },
      ]}
    >
      <Ionicons name={icon} size={14} color={accentIcon} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  content: {
    flex: 1,
    alignItems: 'center',
  },
  hero: {
    width: '100%',
    height: 220,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  halo: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: colors.brandSoft,
  },
  haloRing: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 1,
    borderColor: 'rgba(86, 197, 150, 0.18)',
  },
  haloRingOuter: {
    width: 220,
    height: 220,
    borderRadius: 110,
    borderColor: 'rgba(86, 197, 150, 0.10)',
  },
  logoCard: {
    width: 92,
    height: 92,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: colors.brandDeep,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 22,
    elevation: 6,
  },
  logoImg: { width: '100%', height: '100%' },
  chip: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.brandDeep,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 3,
  },
  brand: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    color: colors.textPrimary,
    letterSpacing: 4,
    marginTop: 4,
  },
  tagline: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 12.5,
    color: colors.textSecondary,
    marginTop: 2,
  },
  heading: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 28,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.lg,
    letterSpacing: -0.4,
    lineHeight: 36,
  },
  headingAccent: {
    color: colors.brandDeep,
  },
  sub: {
    ...typography.body,
    fontSize: 13.5,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 20,
    paddingHorizontal: spacing.sm,
  },
  ctaStack: {
    alignSelf: 'stretch',
    gap: 12,
    marginTop: spacing.lg,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: touchTarget.comfortable,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.brandDeep,
    shadowColor: colors.brandDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 6,
  },
  primaryBtnPressed: { opacity: 0.94, transform: [{ scale: 0.98 }] },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 15,
    color: colors.textInverse,
    letterSpacing: 0.3,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: touchTarget.comfortable,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryBtnPressed: { opacity: 0.92, transform: [{ scale: 0.98 }] },
  secondaryBtnLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14.5,
    color: colors.textPrimary,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 12,
    color: colors.textMuted,
  },
  googleMark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  googleMarkText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: '#4285F4',
  },
  reassureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  reassureText: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 11.5,
    color: colors.textSecondary,
    textAlign: 'center',
    flexShrink: 1,
  },
  langCard: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
    backgroundColor: colors.background,
    borderRadius: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  langCardTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  langRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
  },
  langPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  langPillSelected: {
    backgroundColor: colors.background,
    borderColor: colors.brandDeep,
  },
  langPillText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  langPillTextSelected: {
    color: colors.brandDeep,
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'stretch',
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  privacyText: {
    flex: 1,
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12.5,
    color: colors.textPrimary,
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: spacing.md,
    paddingHorizontal: 4,
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.brandMid,
    backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: colors.brandDeep,
    borderColor: colors.brandDeep,
  },
  termsText: {
    flex: 1,
    fontFamily: fontFamilies.interRegular,
    fontSize: 11.5,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  termsLink: {
    fontFamily: fontFamilies.interMedium,
    color: colors.brandDeep,
  },
  devHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  pressedSubtle: {
    opacity: 0.85,
  },
});
