import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import type { AppScreenProps } from '@/navigation/types';

// The safety PIN is collected once, at registration, and is write-once by
// design (see services/safety-pin.ts). There is deliberately no "change" and no
// "remove" here: a PIN that an attacker holding the phone could change or
// delete would not protect anyone. So this screen only explains it.

export function SafetyPinScreen({ navigation }: AppScreenProps<'SafetyPin'>) {
  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={styles.backBtn}
            accessibilityRole="button"
          >
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.title}>Safety PIN</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.body}>
          <View style={styles.statusCard}>
            <View style={styles.lockCircle}>
              <Ionicons name="lock-closed" size={26} color={colors.sageDeep} />
            </View>
            <Text style={styles.statusTitle}>Your PIN is set</Text>
            <Text style={styles.statusSub}>
              It's stored only on this phone, as a hash. Nobody at ORBII can see
              it, and it is never sent anywhere.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>What it protects</Text>
            <Text style={styles.cardBody}>
              If ORBII hears your emergency phrase, a 5-second countdown starts.
              Your PIN is what someone must enter to cancel it — so a person who
              has taken your phone cannot silence your SOS.
            </Text>
          </View>

          <View style={styles.warnCard}>
            <Ionicons name="alert-circle" size={18} color={colors.coralDeep} />
            <Text style={styles.warnText}>
              Your PIN <Text style={styles.warnBold}>cannot be changed</Text>.
              A PIN an attacker could change would protect no one. Never share it.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.icon,
  },
  title: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: colors.textPrimary },
  body: { padding: spacing.lg, gap: spacing.md },

  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.xs,
    ...shadows.card,
  },
  lockCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.sageSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  statusTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 19, color: colors.textPrimary },
  statusSub: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.lg,
    gap: 6,
    ...shadows.card,
  },
  cardTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 15.5, color: colors.textPrimary },
  cardBody: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.textSecondary,
  },

  warnCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.coralSoft,
    borderRadius: radius.xl,
    padding: spacing.md,
  },
  warnText: {
    flex: 1,
    fontFamily: fontFamilies.interMedium,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textPrimary,
  },
  warnBold: { fontFamily: fontFamilies.poppinsBold },
});
