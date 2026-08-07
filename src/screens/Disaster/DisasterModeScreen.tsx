import React, { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenContainer, appAlert, PremiumLock } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { useEntitlement } from '@/services/entitlements';
import {
  broadcastDisasterStatus,
  openDisasterComposer,
  type DisasterStatus,
} from '@/services/disaster';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// Real, widely-published Indian emergency numbers. Tap to dial.
const HELPLINES: { label: string; number: string; icon: IconName; tint: string }[] = [
  { label: 'Emergency', number: '112', icon: 'alert-circle', tint: colors.coral },
  { label: 'Ambulance', number: '108', icon: 'medkit', tint: colors.sageDeep },
  { label: 'Fire', number: '101', icon: 'flame', tint: colors.coralDeep },
  { label: 'Police', number: '100', icon: 'shield', tint: colors.lavenderDeep },
  { label: 'Disaster (NDMA)', number: '1078', icon: 'warning', tint: colors.goldDeep },
  { label: 'Women', number: '1091', icon: 'woman', tint: colors.brandDeep },
  { label: 'Child', number: '1098', icon: 'happy', tint: colors.sageDeep },
  { label: 'Gas leak', number: '1906', icon: 'cloud', tint: colors.goldDeep },
];

const DISASTERS: {
  key: string;
  title: string;
  icon: IconName;
  tint: string;
  bg: string;
  tips: string[];
  number: string;
}[] = [
  {
    key: 'flood',
    title: 'Flood',
    icon: 'water',
    tint: colors.lavenderDeep,
    bg: colors.lavenderSoft,
    tips: ['Move to higher ground early.', 'Never walk or drive through moving water.', 'Switch off the mains power.'],
    number: '1078',
  },
  {
    key: 'quake',
    title: 'Earthquake',
    icon: 'earth',
    tint: colors.goldDeep,
    bg: colors.goldSoft,
    tips: ['Drop, cover, and hold on.', 'Stay away from windows and heavy objects.', 'Never use the lift.'],
    number: '1078',
  },
  {
    key: 'cyclone',
    title: 'Cyclone / storm',
    icon: 'thunderstorm',
    tint: colors.brandDeep,
    bg: colors.brandSoft,
    tips: ['Stay indoors, away from windows.', 'Keep water, food and a charged phone ready.', 'Follow official alerts only.'],
    number: '1078',
  },
  {
    key: 'landslide',
    title: 'Landslide',
    icon: 'trail-sign',
    tint: colors.sageDeep,
    bg: colors.sageSoft,
    tips: ['Move away from steep slopes.', 'Watch for cracks, tilting trees or sudden water.', 'Leave low-lying paths.'],
    number: '1078',
  },
  {
    key: 'fire',
    title: 'Fire',
    icon: 'flame',
    tint: colors.coralDeep,
    bg: colors.coralSoft,
    tips: ['Get out and stay out.', 'Stay low, under the smoke.', 'Never use the lift.'],
    number: '101',
  },
];

export function DisasterModeScreen() {
  const navigation = useNavigation();
  const profile = useAppSelector((s) => s.user.profile);
  const location = useAppSelector((s) => s.sos.currentLocation);
  const [busy, setBusy] = useState<DisasterStatus | null>(null);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const canUseDisaster = useEntitlement('disaster_mode');

  if (!canUseDisaster) {
    return (
      <PremiumLock
        feature="Disaster mode"
        icon="warning"
        blurb="Reach your people over SMS with no internet, every Indian emergency helpline in one place, and step-by-step tips for floods, quakes and more. Unlock it with ORBII Plus."
      />
    );
  }

  const dial = (num: string) => {
    Linking.openURL(`tel:${num}`).catch(() => undefined);
  };

  const send = async (status: DisasterStatus) => {
    if (!profile || busy) return;
    setBusy(status);
    try {
      const loc = location ? { latitude: location.latitude, longitude: location.longitude } : null;
      const res = await broadcastDisasterStatus(status, profile, loc);
      if (res.contacts === 0) {
        appAlert(
          'Add an emergency contact first',
          'Disaster mode texts the people you trust. Add at least one contact, then try again.',
        );
      } else if (res.sent) {
        appAlert(
          status === 'safe' ? 'Sent: you are safe' : 'Help request sent',
          `Texted ${res.contacts} ${res.contacts === 1 ? 'contact' : 'contacts'} over SMS. This works even with no internet.`,
        );
      } else {
        await openDisasterComposer(status, profile, loc);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScreenContainer padded={false} scroll={false} edges={['top', 'left', 'right']}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Disaster mode</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {/* Hero */}
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Ionicons name="warning" size={28} color={colors.textInverse} />
            </View>
            <Text style={styles.heroTitle}>When disaster strikes</Text>
            <Text style={styles.heroSub}>
              Reach the people you trust, find the right helpline, and stay calm. Built to work even
              when the internet is down.
            </Text>
          </View>

          {/* Primary actions */}
          <Text style={styles.sectionLabel}>REACH PEOPLE NOW</Text>
          <Pressable
            onPress={() => send('help')}
            disabled={!!busy}
            style={({ pressed }) => [
              styles.helpBtn,
              pressed && { opacity: 0.95, transform: [{ scale: 0.98 }] },
            ]}
          >
            <View style={styles.helpIcon}>
              <Ionicons name="hand-left" size={26} color="#FF6E40" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.helpTitle}>I need help</Text>
              <Text style={styles.helpSub}>Texts your contacts with your live location. Works offline.</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textInverse} />
          </Pressable>

          <View style={styles.pairRow}>
            <Pressable
              onPress={() => send('safe')}
              disabled={!!busy}
              style={({ pressed }) => [styles.miniCard, styles.safeCard, pressed && styles.pressed]}
            >
              <Ionicons name="checkmark-circle" size={24} color={colors.sageDeep} />
              <Text style={styles.miniTitle}>I'm safe</Text>
              <Text style={styles.miniSub}>Reassure your circle with one tap, over SMS</Text>
            </Pressable>
          </View>

          {/* Helplines */}
          <Text style={styles.sectionLabel}>EMERGENCY HELPLINES · TAP TO CALL</Text>
          <View style={styles.helpGrid}>
            {HELPLINES.map((h) => (
              <Pressable
                key={h.number}
                onPress={() => dial(h.number)}
                style={({ pressed }) => [styles.lineCard, pressed && styles.pressed]}
              >
                <View style={[styles.lineIcon, { backgroundColor: h.tint + '22' }]}>
                  <Ionicons name={h.icon} size={18} color={h.tint} />
                </View>
                <Text style={styles.lineNumber}>{h.number}</Text>
                <Text style={styles.lineLabel} numberOfLines={1}>{h.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Disaster types */}
          <Text style={styles.sectionLabel}>IF IT'S A...</Text>
          {DISASTERS.map((d) => {
            const open = openCard === d.key;
            return (
              <View key={d.key} style={styles.dCard}>
                <Pressable
                  onPress={() => setOpenCard(open ? null : d.key)}
                  style={({ pressed }) => [styles.dHead, pressed && styles.pressed]}
                >
                  <View style={[styles.dIcon, { backgroundColor: d.bg }]}>
                    <Ionicons name={d.icon} size={20} color={d.tint} />
                  </View>
                  <Text style={styles.dTitle}>{d.title}</Text>
                  <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
                </Pressable>
                {open ? (
                  <View style={styles.dBody}>
                    {d.tips.map((t, i) => (
                      <View key={i} style={styles.tipRow}>
                        <View style={[styles.tipDot, { backgroundColor: d.tint }]} />
                        <Text style={styles.tipText}>{t}</Text>
                      </View>
                    ))}
                    <Pressable onPress={() => dial(d.number)} style={styles.dCall}>
                      <Ionicons name="call" size={16} color={colors.textInverse} />
                      <Text style={styles.dCallText}>Call {d.number}</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })}

          <Text style={styles.footnote}>
            Help and safe alerts go out over SMS, so they work on plain cell signal even with mobile data
            off. Helplines are official Indian emergency numbers.
          </Text>
        </ScrollView>
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
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },

  hero: {
    alignItems: 'center',
    backgroundColor: colors.coralSoft,
    borderRadius: radius.xxl,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  heroIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    ...shadows.icon,
  },
  heroTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 22, color: colors.textPrimary },
  heroSub: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 320,
  },

  sectionLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 11,
    letterSpacing: 1.1,
    color: colors.textMuted,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },

  helpBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: '#FF6E40',
    borderRadius: radius.xl,
    padding: spacing.lg,
    shadowColor: '#FF6E40',
    shadowOpacity: 0.42,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 9,
  },
  helpIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helpTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: colors.textInverse },
  helpSub: { fontFamily: fontFamilies.poppinsMedium, fontSize: 12.5, color: colors.textInverse, opacity: 0.9, marginTop: 2 },

  pairRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  miniCard: {
    flex: 1,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: 6,
    borderWidth: 1.5,
    ...shadows.icon,
  },
  safeCard: { backgroundColor: colors.sageSoft, borderColor: colors.sage },
  chatCard: { backgroundColor: colors.lavenderSoft, borderColor: colors.lavender },
  miniTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: colors.textPrimary },
  miniSub: { fontFamily: fontFamilies.poppinsMedium, fontSize: 11.5, color: colors.textSecondary },
  betaBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor: colors.lavenderDeep,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  soonText: { fontFamily: fontFamilies.poppinsBold, fontSize: 9, letterSpacing: 0.5, color: colors.textInverse },

  helpGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  lineCard: {
    width: '31%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    gap: 4,
    ...shadows.icon,
  },
  lineIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  lineNumber: { fontFamily: fontFamilies.poppinsBold, fontSize: 20, color: colors.textPrimary, letterSpacing: -0.3 },
  lineLabel: { fontFamily: fontFamilies.poppinsMedium, fontSize: 10.5, color: colors.textSecondary, marginTop: 2, lineHeight: 14 },

  dCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginBottom: spacing.sm,
    ...shadows.icon,
    overflow: 'hidden',
  },
  dHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  dIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dTitle: { flex: 1, fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15.5, color: colors.textPrimary },
  dBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  tipDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  tipText: { flex: 1, fontFamily: fontFamilies.poppinsMedium, fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  dCall: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.textPrimary,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    marginTop: 4,
  },
  dCallText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textInverse },

  footnote: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 11.5,
    lineHeight: 18,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  pressed: { opacity: 0.85 },
});
