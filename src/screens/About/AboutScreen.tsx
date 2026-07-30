import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { ScreenContainer } from '@/components/common';
import {
  colors,
  fontFamilies,
  spacing,
  typography,
} from '@/theme';
import { APP_VERSION, COPYRIGHT_LINE } from '@/services/app-info';

export function AboutScreen() {
  return (
    <ScreenContainer padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={[colors.brandSoft, colors.background]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.logoOrbit}>
            <View style={styles.logoCore}>
              <Text style={styles.logoChar}>O</Text>
            </View>
          </View>
          <Text style={styles.brand}>ORBII</Text>
          <Text style={styles.tagline}>Your everyday safety net.</Text>
        </LinearGradient>

        <View style={styles.body}>
          <Text style={styles.sectionTitle}>What we do</Text>
          <Text style={styles.paragraph}>
            ORBII is a community-first safety app for women in India. One tap
            sends an SOS to nearby verified helpers, your circle of trusted
            friends, and your emergency contacts within seconds.
          </Text>

          <Text style={styles.sectionTitle}>How it works</Text>
          <Bullet text="Press SOS and your live location is shared with helpers within 2 km." />
          <Bullet text={'Voice triggers ("help", "bachao", "madad") fire SOS hands-free.'} />
          <Bullet text="Friends in your circle are notified first, no matter the distance." />
          <Bullet text="Helpers are Aadhaar-verified and rated after each response." />

          <Text style={styles.sectionTitle}>Our promise</Text>
          <Bullet text="We never sell your data. Ever." />
          <Bullet text="Your location is shared only during an active SOS or with people you've added to your circle." />
          <Bullet text="Free tier covers everything that saves a life. Paid tiers add insights and faster response." />

          <Text style={styles.sectionTitle}>Reach us</Text>
          <Pressable
            onPress={() =>
              Linking.openURL('mailto:orbiisafety@gmail.com').catch(() => undefined)
            }
            style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
          >
            <Ionicons name="mail" size={18} color={colors.brandDeep} />
            <Text style={styles.linkText}>orbiisafety@gmail.com</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              Linking.openURL('https://orbii.in/privacy-policy').catch(() => undefined)
            }
            style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
          >
            <Ionicons name="document-text" size={18} color={colors.brandDeep} />
            <Text style={styles.linkText}>Privacy policy</Text>
          </Pressable>
          <Pressable
            onPress={() =>
              Linking.openURL('https://orbii.in/terms-of-service').catch(() => undefined)
            }
            style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
          >
            <Ionicons name="shield-checkmark" size={18} color={colors.brandDeep} />
            <Text style={styles.linkText}>Terms of service</Text>
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={styles.versionText}>Version {APP_VERSION}</Text>
          <Text style={styles.copyrightText}>{COPYRIGHT_LINE}</Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: 120,
  },
  hero: {
    alignItems: 'center',
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  logoOrbit: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.brandDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.20,
    shadowRadius: 14,
    elevation: 6,
  },
  logoCore: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.brandDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoChar: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 32,
    color: colors.textInverse,
    letterSpacing: -1,
  },
  brand: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 28,
    color: colors.textPrimary,
    marginTop: spacing.md,
    letterSpacing: 4,
  },
  tagline: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 4,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: 8,
  },
  sectionTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 15,
    color: colors.textPrimary,
    marginTop: spacing.md,
    marginBottom: 4,
  },
  paragraph: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 4,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.brandDeep,
    marginTop: 8,
  },
  bulletText: {
    flex: 1,
    fontFamily: fontFamilies.interMedium,
    fontSize: 13.5,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    marginTop: 6,
  },
  linkText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  footer: {
    alignItems: 'center',
    marginTop: spacing.xl,
    gap: 4,
  },
  versionText: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 12,
    color: colors.textMuted,
  },
  copyrightText: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 11,
    color: colors.textMuted,
  },
});
