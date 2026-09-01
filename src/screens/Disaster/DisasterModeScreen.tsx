import React, { useEffect, useState } from 'react';
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
  openRollCall,
  getRollCall,
  answerRollCall,
  myOpenRollCalls,
  type DisasterStatus,
  type RollCallEntry,
} from '@/services/disaster';
import { isSurvivalModeOn, setSurvivalMode } from '@/services/disaster-power';

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
  const circles = useAppSelector((s) => s.circles.circles);
  const [busy, setBusy] = useState<DisasterStatus | null>(null);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [survival, setSurvival] = useState(isSurvivalModeOn());
  const [rollId, setRollId] = useState<string | null>(null);
  const [roll, setRoll] = useState<RollCallEntry[]>([]);
  const [rollBusy, setRollBusy] = useState(false);

  // An open roll call somebody else started is the thing she most needs to see
  // when she opens this screen: her family is already asking.
  useEffect(() => {
    void myOpenRollCalls().then(async (list) => {
      const first = list[0];
      if (!first) return;
      setRollId(first.id);
      setRoll(await getRollCall(first.id));
    });
  }, []);

  const refreshRoll = async (id: string) => {
    setRoll(await getRollCall(id));
  };

  const startRollCall = async () => {
    const circleId = circles[0]?.id;
    if (!circleId) {
      appAlert(
        'You need a circle first',
        'A roll call asks the people in your circle whether they are safe. Add someone from the Circle tab.',
      );
      return;
    }
    setRollBusy(true);
    try {
      const id = await openRollCall(circleId);
      if (!id) {
        appAlert('Could not start it', 'Check your connection and try again.');
        return;
      }
      setRollId(id);
      await refreshRoll(id);
    } finally {
      setRollBusy(false);
    }
  };

  const reply = async (status: DisasterStatus) => {
    if (!rollId) return;
    setRollBusy(true);
    try {
      await answerRollCall(rollId, status, null, null);
      await refreshRoll(rollId);
    } finally {
      setRollBusy(false);
    }
  };
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

          <Pressable
            onPress={() => send('safe')}
            disabled={!!busy}
            style={({ pressed }) => [styles.rowCard, pressed && styles.pressed]}
          >
            <View style={[styles.rowIcon, { backgroundColor: colors.sageSoft }]}>
              <Ionicons name="checkmark-circle" size={22} color={colors.sageDeep} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>I am safe</Text>
              <Text style={styles.rowSub}>Reassure your circle with one tap, over SMS.</Text>
            </View>
          </Pressable>

          {/* Roll call.
              The list deliberately leads with whoever has NOT answered. In a
              disaster the replies are reassuring and the silences are the
              information, so the screen is built around the silences. */}
          <Text style={styles.sectionLabel}>IS EVERYONE OK</Text>
          {rollId ? (
            <View style={styles.rollBox}>
              {roll.map((r) => (
                <View key={r.user_id} style={styles.rollRow}>
                  <Ionicons
                    name={
                      r.status === 'safe'
                        ? 'checkmark-circle'
                        : r.status === 'help'
                          ? 'alert-circle'
                          : 'ellipse-outline'
                    }
                    size={18}
                    color={
                      r.status === 'safe'
                        ? colors.sageDeep
                        : r.status === 'help'
                          ? colors.coralDeep
                          : colors.textMuted
                    }
                  />
                  <Text style={styles.rollName}>{r.name}</Text>
                  <Text
                    style={[
                      styles.rollState,
                      r.status === 'help' && { color: colors.coralDeep },
                      !r.status && { color: colors.textMuted },
                    ]}
                  >
                    {r.status === 'safe'
                      ? 'Safe'
                      : r.status === 'help'
                        ? 'Needs help'
                        : 'No answer yet'}
                  </Text>
                </View>
              ))}
              <View style={styles.rollActions}>
                <Pressable
                  style={[styles.rollBtn, styles.rollSafe]}
                  disabled={rollBusy}
                  onPress={() => void reply('safe')}
                >
                  <Text style={styles.rollBtnText}>I am safe</Text>
                </Pressable>
                <Pressable
                  style={[styles.rollBtn, styles.rollHelp]}
                  disabled={rollBusy}
                  onPress={() => void reply('help')}
                >
                  <Text style={styles.rollBtnText}>I need help</Text>
                </Pressable>
              </View>
              <Pressable onPress={() => void refreshRoll(rollId)} hitSlop={8}>
                <Text style={styles.rollRefresh}>Check for new answers</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.rowCard, pressed && styles.pressed]}
              disabled={rollBusy}
              onPress={() => void startRollCall()}
            >
              <View style={[styles.rowIcon, { backgroundColor: colors.lavenderSoft }]}>
                <Ionicons name="people" size={22} color={colors.lavenderDeep} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Ask everyone if they are safe</Text>
                <Text style={styles.rowSub}>
                  One tap asks your circle. You will see who has not answered.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          )}

          {/* Survival battery mode. */}
          <Text style={styles.sectionLabel}>MAKE THE PHONE LAST</Text>
          <Pressable
            style={({ pressed }) => [
              styles.rowCard,
              survival && styles.rowCardOn,
              pressed && styles.pressed,
            ]}
            accessibilityRole="switch"
            accessibilityState={{ checked: survival }}
            onPress={() => {
              const next = !survival;
              setSurvival(next);
              void setSurvivalMode(next);
            }}
          >
            <View
              style={[
                styles.rowIcon,
                { backgroundColor: survival ? colors.sageSoft : colors.goldSoft },
              ]}
            >
              <Ionicons
                name={survival ? 'battery-charging' : 'battery-half'}
                size={22}
                color={survival ? colors.sageDeep : colors.goldDeep}
              />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>
                {survival ? 'Survival mode is on' : 'Turn on survival mode'}
              </Text>
              <Text style={styles.rowSub}>
                {survival
                  ? 'Everything except being found is stopped. Voice SOS and the offline mesh keep running.'
                  : 'Stops location history and background work. Voice SOS and the offline mesh are never switched off.'}
              </Text>
            </View>
            {/* State you can see from across a room, not just read. */}
            <View style={[styles.pill, survival ? styles.pillOn : styles.pillOff]}>
              <Text style={[styles.pillText, survival && styles.pillTextOn]}>
                {survival ? 'ON' : 'OFF'}
              </Text>
            </View>
          </Pressable>

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

  // Belongs to what is BELOW it. The old spacing was symmetrical, which is why
  // the screen read as one undifferentiated column of cards.
  sectionLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 11,
    letterSpacing: 1.1,
    color: colors.textMuted,
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
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

  // ONE loud thing per screen. helpBtn above is coral with a heavy glow and it
  // belongs to "I need help" alone. Everything else that is a tappable row uses
  // this: same height, same icon badge, same two lines of text, so the eye can
  // scan the column instead of re-reading four competing buttons.
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.sm,
    ...shadows.icon,
  },
  rowCardOn: { borderColor: colors.sage, backgroundColor: colors.sageSoft },

  // A View, never a style handed to <Ionicons>. A glyph is text: giving it
  // width, height and flex centring leaves the icon parked in the corner of its
  // own badge, which is exactly how these rows were misaligned.
  rowIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary },
  rowSub: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },

  pill: { borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  pillOn: { backgroundColor: colors.sageDeep },
  pillOff: { backgroundColor: colors.creamDeep },
  pillText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 10,
    letterSpacing: 0.6,
    color: colors.textSecondary,
  },
  pillTextOn: { color: colors.textInverse },

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

  rollBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  rollRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rollName: { flex: 1, fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textPrimary },
  rollState: { fontFamily: fontFamilies.interRegular, fontSize: 12, color: colors.sageDeep },
  rollActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  rollBtn: { flex: 1, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  rollSafe: { backgroundColor: colors.sageDeep },
  rollHelp: { backgroundColor: colors.coralDeep },
  rollBtnText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textInverse },
  rollRefresh: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 12,
    color: colors.brandDeep,
    textAlign: 'center',
    paddingTop: spacing.xs,
  },
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
