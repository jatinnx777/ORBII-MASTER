import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenContainer, appAlert } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import { useAppSelector } from '@/redux/store';
import {
  broadcastDisasterStatus,
  openDisasterComposer,
  type DisasterStatus,
} from '@/services/disaster';

// Phase 3: Disaster mode. Two actions, both work with no internet (over SMS):
// tell the people you trust that you need help, or that you're safe.
export function DisasterModeScreen() {
  const navigation = useNavigation();
  const profile = useAppSelector((s) => s.user.profile);
  const location = useAppSelector((s) => s.sos.currentLocation);
  const [busy, setBusy] = useState<DisasterStatus | null>(null);

  const send = async (status: DisasterStatus) => {
    if (!profile || busy) return;
    setBusy(status);
    try {
      const loc = location ? { latitude: location.latitude, longitude: location.longitude } : null;
      const res = await broadcastDisasterStatus(status, profile, loc);
      if (res.contacts === 0) {
        appAlert(
          'Add an emergency contact first',
          'Disaster mode texts the people you trust. Add at least one emergency contact, then try again.',
        );
      } else if (res.sent) {
        appAlert(
          status === 'safe' ? 'Sent: you are safe' : 'Help request sent',
          `Texted ${res.contacts} ${res.contacts === 1 ? 'contact' : 'contacts'} over SMS. This works even with no internet.`,
        );
      } else {
        // Hands-free SMS not granted: fall back to the one-tap composer.
        await openDisasterComposer(status, profile, loc);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScreenContainer padded={false} edges={['top', 'left', 'right']}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Disaster mode</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.body}>
          <Text style={styles.lead}>
            Floods, landslides, a network shutdown. Tell the people you trust, even with no internet. These
            go out as an SMS over cell signal.
          </Text>

          <Pressable
            onPress={() => send('help')}
            disabled={!!busy}
            style={({ pressed }) => [styles.card, styles.help, pressed && styles.pressed]}
          >
            <View style={styles.iconWrap}>
              <Ionicons name="alert" size={30} color={colors.textInverse} />
            </View>
            <Text style={styles.cardTitle}>I need help</Text>
            <Text style={styles.cardSub}>Texts your contacts with your live location.</Text>
          </Pressable>

          <Pressable
            onPress={() => send('safe')}
            disabled={!!busy}
            style={({ pressed }) => [styles.card, styles.safe, pressed && styles.pressed]}
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.sageDeep }]}>
              <Ionicons name="checkmark" size={30} color={colors.textInverse} />
            </View>
            <Text style={styles.cardTitle}>I'm safe</Text>
            <Text style={styles.cardSub}>Reassure your contacts that you're okay.</Text>
          </Pressable>

          <Text style={styles.note}>
            Works on plain cell signal, even 2G, with mobile data off. If a text can't send automatically,
            ORBII opens your messaging app pre-filled so you send it with one tap.
          </Text>
        </View>
      </SafeAreaView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: colors.textPrimary },
  body: { flex: 1, paddingHorizontal: spacing.lg, gap: spacing.lg },
  lead: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  card: {
    borderRadius: radius.xl,
    padding: spacing.lg,
    alignItems: 'center',
    gap: 6,
    ...shadows.card,
  },
  help: { backgroundColor: colors.coralSoft, borderWidth: 2, borderColor: colors.coral },
  safe: { backgroundColor: colors.sageSoft, borderWidth: 2, borderColor: colors.sage },
  pressed: { opacity: 0.85 },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  cardTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 20, color: colors.textPrimary },
  cardSub: { fontFamily: fontFamilies.poppinsMedium, fontSize: 13, color: colors.textSecondary, textAlign: 'center' },
  note: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 12.5,
    lineHeight: 19,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
