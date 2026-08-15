import React, { useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  colors,
  fontFamilies,
  radius,
  spacing,
  touchTarget,
  typography,
} from '@/theme';
import { sendPhoneOtp } from '@/services/auth';
import { isValidIndianPhone } from '@/utils/validation';
import type { AuthScreenProps } from '@/navigation/types';

// Phone number entry. Currently India-only (+91 fixed). Once we add
// more markets the country code picker becomes a proper sheet.
export function PhoneSignInScreen({ navigation }: AuthScreenProps<'PhoneSignIn'>) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const enter = useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 480,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter]);

  const digits = phone.replace(/\D/g, '').slice(0, 10);
  const valid = isValidIndianPhone(digits);

  const onSend = async () => {
    if (!valid || sending) return;
    setSending(true);
    setError(null);
    try {
      const e164 = await sendPhoneOtp(digits);
      navigation.navigate('PhoneVerify', { phone: e164 });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('phone.invalidNumber'));
    } finally {
      setSending(false);
    }
  };

  const translateY = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
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
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.headerRow}>
            <Pressable
              onPress={() => navigation.goBack()}
              hitSlop={12}
              style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
            >
              <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
            </Pressable>
          </View>

          <Animated.View
            style={[
              styles.body,
              { opacity: enter, transform: [{ translateY }] },
            ]}
          >
            <View style={styles.logoCard}>
              <Image
                source={require('../../../assets/icon-small.png')}
                style={styles.logoImg}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.brand}>{t('welcome.brand')}</Text>

            <Text style={styles.title}>{t('phone.title')}</Text>
            <Text style={styles.subtitle}>{t('phone.subtitle')}</Text>

            <View style={styles.inputRow}>
              <View style={styles.countryPill}>
                <Text style={styles.countryFlag}>🇮🇳</Text>
                <Text style={styles.countryCode}>+91</Text>
              </View>
              <View style={styles.phoneField}>
                <TextInput
                  value={digits}
                  onChangeText={(v) => {
                    setPhone(v.replace(/\D/g, '').slice(0, 10));
                    if (error) setError(null);
                  }}
                  placeholder={t('phone.placeholder')}
                  placeholderTextColor={colors.textMuted}
                  keyboardType="phone-pad"
                  maxLength={10}
                  style={styles.phoneInput}
                />
              </View>
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Pressable
              onPress={onSend}
              disabled={!valid || sending}
              style={({ pressed }) => [
                styles.primaryBtn,
                (!valid || sending) && styles.primaryBtnDisabled,
                pressed && valid && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('phone.sendOtp')}
            >
              <Text style={styles.primaryBtnLabel}>
                {sending ? t('phone.sending') : t('phone.sendOtp')}
              </Text>
            </Pressable>

            <View style={styles.reassureRow}>
              <Ionicons name="lock-closed" size={12} color={colors.brandDeep} />
              <Text style={styles.reassureText}>{t('phone.neverShare')}</Text>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  safe: { flex: 1, paddingHorizontal: spacing.lg },
  headerRow: {
    flexDirection: 'row',
    paddingTop: spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    paddingTop: spacing.lg,
  },
  logoCard: {
    width: 96,
    height: 96,
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
  logoImg: { width: 84, height: 84 },
  brand: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: colors.brandDeep,
    letterSpacing: 6,
    marginTop: spacing.sm,
  },
  title: {
    ...typography.h2,
    color: colors.textPrimary,
    marginTop: spacing.lg,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: spacing.md,
    lineHeight: 20,
  },
  inputRow: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    marginTop: spacing.xl,
    gap: 10,
  },
  countryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: touchTarget.comfortable,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  countryFlag: { fontSize: 18 },
  countryCode: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  phoneField: {
    flex: 1,
    height: touchTarget.comfortable,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  phoneInput: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 16,
    color: colors.textPrimary,
    letterSpacing: 0.5,
  },
  errorText: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 12.5,
    color: colors.error,
    alignSelf: 'stretch',
    marginTop: 6,
  },
  primaryBtn: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: touchTarget.comfortable,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.brandDeep,
    marginTop: spacing.lg,
    shadowColor: colors.brandDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.30,
    shadowRadius: 12,
    elevation: 6,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 15,
    color: colors.textInverse,
    letterSpacing: 0.3,
  },
  reassureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
  },
  reassureText: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 11.5,
    color: colors.textSecondary,
  },
  pressed: {
    opacity: 0.92,
    transform: [{ scale: 0.98 }],
  },
});
