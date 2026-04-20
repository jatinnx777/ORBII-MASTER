import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '@/theme';
import { Button } from './Button';

type Props = {
  visible: boolean;
  onAccept: () => void;
  onDecline: () => void;
};

export function PrivacyPolicyModal({ visible, onAccept, onDecline }: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDecline}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.iconWrap}>
              <Ionicons name="shield-checkmark" size={22} color={colors.primary} />
            </View>
            <Text style={styles.title}>Privacy & Terms</Text>
            <Text style={styles.subtitle}>
              Please review before creating your ORBII account.
            </Text>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator
          >
            <Text style={styles.sectionHeader}>What ORBII does</Text>
            <Text style={styles.body}>
              ORBII is a personal-safety app. When you trigger an SOS, the app
              shares your live location, phone number, and a brief incident
              record with nearby verified helpers and your emergency contacts
              so help can reach you as quickly as possible.
            </Text>

            <Text style={styles.sectionHeader}>Information we collect</Text>
            <Text style={styles.body}>
              • Your mobile number (for sign-in and to let helpers call you){'\n'}
              • Your name and optional profile photo{'\n'}
              • Your emergency-contact list (name + phone){'\n'}
              • Your precise location while an SOS or Safe-Mode journey is
                active{'\n'}
              • A timestamped record of each SOS you trigger (for your own
                history){'\n'}
              • Voice-detection runs on-device; the audio never leaves your
                phone
            </Text>

            <Text style={styles.sectionHeader}>How we use it</Text>
            <Text style={styles.body}>
              We use your information only to deliver the safety features you
              explicitly trigger: dispatching helpers, notifying your trusted
              contact, and showing you your own incident history. We do not
              sell your data. We do not profile you for ads.
            </Text>

            <Text style={styles.sectionHeader}>Who can see your data</Text>
            <Text style={styles.body}>
              • Helpers you accept an SOS from see your name, approximate
                location, and phone number for that incident only.{'\n'}
              • Your emergency contacts only see information you choose to
                share with them (e.g., a live-location link during Safe
                Mode).{'\n'}
              • ORBII staff may access anonymised incident logs for safety
                review.
            </Text>

            <Text style={styles.sectionHeader}>Your rights</Text>
            <Text style={styles.body}>
              You can delete your account from Profile → Settings at any time.
              Deletion removes your profile, contacts, and local history. You
              can also contact support@orbii.app to request export or
              erasure.
            </Text>

            <Text style={styles.sectionHeader}>Permissions we ask for</Text>
            <Text style={styles.body}>
              Location, microphone (voice-trigger only), notifications, and
              photo access for your profile picture. You can revoke any
              permission in your phone settings — some safety features will
              stop working without them.
            </Text>

            <Text style={styles.sectionHeader}>Terms of use</Text>
            <Text style={styles.body}>
              ORBII is an emergency-assistance tool, not a replacement for
              police, ambulance, or fire services. If your life is in
              immediate danger, call 112 (India). You agree to use the SOS
              feature only in genuine emergencies.
            </Text>

            <Text style={styles.footerText}>
              By tapping "I agree" you accept the Privacy Policy and Terms of
              Use. You can withdraw consent any time by deleting your
              account.
            </Text>
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              onPress={onDecline}
              style={({ pressed }) => [
                styles.declineBtn,
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
            >
              <Text style={styles.declineText}>Decline</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <Button label="I agree" onPress={onAccept} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10,10,10,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '92%',
    paddingTop: spacing.lg,
    ...shadows.sheet,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    alignItems: 'flex-start',
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFE5E5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 4,
  },
  scroll: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.lg,
  },
  sectionHeader: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13,
    color: colors.textPrimary,
    letterSpacing: 0.2,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  body: {
    ...typography.body,
    fontSize: 14,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  footerText: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.lg,
    fontStyle: 'italic',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  declineBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  declineText: {
    ...typography.button,
    color: colors.textSecondary,
    fontSize: 15,
  },
});
