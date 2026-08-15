import React, { useEffect, useState } from 'react';
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getItem, setItem, storageKeys } from '@/services/storage';
import { requestAllPermissions } from '@/services/permissions';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// One-time "prominent disclosure" shown on first launch, BEFORE ORBII asks for
// any sensitive permission, required by Google Play for location + microphone
// access. Plain-language, no dark patterns: it explains what we access and why,
// and that audio stays on the device.
const ROWS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'location',
    title: 'Location',
    body: 'Used while the app is open and during an SOS, to send help to you. ORBII never tracks your location in the background.',
  },
  {
    icon: 'mic',
    title: 'Microphone (optional)',
    body: 'Only for hands-free Voice SOS, if you turn it on. Listening happens on your device, and your audio is not uploaded, unless you choose to donate a clip to help train ORBII.',
  },
  {
    icon: 'notifications',
    title: 'Notifications',
    body: "So you're alerted the moment someone in your circle needs help.",
  },
  {
    icon: 'chatbubble-ellipses',
    title: 'Texting contacts',
    body: 'In an emergency you can text your emergency contacts your live location with one tap.',
  },
];

export function PermissionDisclosureModal() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    getItem<boolean>(storageKeys.disclosureAck).then((ack) => {
      if (!ack) setVisible(true);
    });
  }, []);

  const accept = async () => {
    await setItem(storageKeys.disclosureAck, true);
    setVisible(false);
    // Ask for everything now, back-to-back, so protection is ready before it's
    // ever needed instead of prompting mid-emergency.
    void requestAllPermissions();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="shield-checkmark" size={26} color={colors.sageDeep} />
          </View>
          <Text style={styles.title}>How ORBII uses your data</Text>
          <Text style={styles.sub}>
            So you know exactly what we access, and why, before you're asked.
          </Text>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {ROWS.map((r) => (
              <View key={r.title} style={styles.row}>
                <Ionicons name={r.icon} size={18} color={colors.peachDeep} style={styles.rowIcon} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{r.title}</Text>
                  <Text style={styles.rowBody}>{r.body}</Text>
                </View>
              </View>
            ))}
          </ScrollView>

          <Pressable
            onPress={() =>
              Linking.openURL('https://orbii.in/privacy-policy').catch(() => undefined)
            }
            hitSlop={8}
          >
            <Text style={styles.link}>Read our Privacy Policy</Text>
          </Pressable>

          <Pressable
            onPress={accept}
            style={({ pressed }) => [styles.cta, pressed && { opacity: 0.92 }]}
            accessibilityRole="button"
          >
            <Text style={styles.ctaText}>I understand</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.lg,
    ...shadows.sheet,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.sageSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: { ...typography.h2, color: colors.textPrimary },
  sub: {
    ...typography.body,
    fontSize: 13.5,
    color: colors.textSecondary,
    marginTop: 4,
    marginBottom: spacing.sm,
  },
  scroll: { maxHeight: 340 },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rowIcon: { marginTop: 1 },
  rowTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  rowBody: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.textSecondary,
    lineHeight: 17,
    marginTop: 1,
  },
  link: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13,
    color: colors.peachDeep,
    textAlign: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  cta: {
    backgroundColor: colors.sage,
    borderRadius: radius.lg,
    paddingVertical: 15,
    alignItems: 'center',
  },
  ctaText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textInverse,
  },
});
