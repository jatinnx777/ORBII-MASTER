import React from 'react';
import { Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useReadiness, READINESS_CAP } from '@/services/readiness';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

// Support — help, guidance and resources.
//
// Every row here goes somewhere real. Where ORBII genuinely can't help yet
// (counsellors, legal aid, shelters) we hand her the numbers that CAN, rather
// than a button that opens an empty screen.

// India's real, free, government-run helplines. These are the ones that answer.
const HELPLINES = [
  { label: 'Emergency (police, fire, ambulance)', number: '112' },
  { label: 'Women’s helpline', number: '1091' },
  { label: 'Domestic abuse helpline', number: '181' },
  { label: 'Mental health (Tele-MANAS)', number: '14416' },
];

export function SupportScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { pct } = useReadiness();
  const setupDone = pct >= READINESS_CAP;

  const call = (n: string) => Linking.openURL(`tel:${n}`).catch(() => undefined);

  const shareApp = async () => {
    try {
      await Share.share({
        message:
          'ORBII gets a woman help before she can even reach her phone. Download: https://orbii.in',
      });
    } catch {
      // user dismissed the sheet
    }
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 110 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.title}>Support</Text>
            <Text style={styles.sub}>Help, guidance and resources.</Text>
          </View>

          {/* ── Learn & grow ── */}
          <Text style={styles.sectionLabel}>LEARN &amp; GROW</Text>
          <Pressable
            onPress={() => navigation.navigate('SafetyReadiness')}
            style={({ pressed }) => [styles.learnCard, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Safety learning hub, ${pct} percent complete`}
          >
            <View style={styles.learnTop}>
              <View style={styles.learnIcon}>
                <Ionicons name="school" size={18} color={colors.textInverse} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.learnTitle}>Safety learning hub</Text>
                <Text style={styles.learnSub}>
                  {setupDone
                    ? "You've finished. You're fully set up."
                    : 'Learn how ORBII protects you, step by step.'}
                </Text>
              </View>
              <Text style={styles.learnPct}>{pct}%</Text>
            </View>
            <View style={styles.learnBarTrack}>
              <View style={[styles.learnBarFill, { width: `${Math.max(pct, 4)}%` }]} />
            </View>
          </Pressable>

          {/* ── Talk to someone ── */}
          <Text style={styles.sectionLabel}>TALK TO SOMEONE NOW</Text>
          <View style={styles.card}>
            {HELPLINES.map((h, i) => (
              <React.Fragment key={h.number}>
                {i > 0 ? <View style={styles.divider} /> : null}
                <Pressable
                  onPress={() => call(h.number)}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Call ${h.label} on ${h.number}`}
                >
                  <View style={styles.rowIcon}>
                    <Ionicons name="call" size={17} color={colors.brandDeep} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{h.label}</Text>
                    <Text style={styles.rowBody}>Free, 24/7</Text>
                  </View>
                  <Text style={styles.rowNumber}>{h.number}</Text>
                </Pressable>
              </React.Fragment>
            ))}
          </View>
          <Text style={styles.footnote}>
            These are India's official free helplines. ORBII does not staff them,
            it just gets you to them fast.
          </Text>

          {/* ── Community ── */}
          <Text style={styles.sectionLabel}>COMMUNITY</Text>
          <View style={styles.card}>
            <Row
              icon="people"
              title="People helping nearby"
              body="See active alerts around you and respond."
              onPress={() => navigation.navigate('CommunityAlerts')}
            />
            <View style={styles.divider} />
            <Row
              icon="shield-checkmark"
              title="Become an ORBII Responder"
              body="Get verified and reach people in danger near you."
              onPress={() => navigation.navigate('ResponderApplication')}
            />
          </View>

          {/* ── App help ── */}
          <Text style={styles.sectionLabel}>APP HELP</Text>
          <View style={styles.card}>
            <Row
              icon="battery-charging"
              title="Keep ORBII running"
              body="Stop your phone from killing background protection."
              onPress={() => navigation.navigate('OEMHelp')}
            />
            <View style={styles.divider} />
            <Row
              icon="information-circle"
              title="About ORBII"
              body="What ORBII does, and what it can't."
              onPress={() => navigation.navigate('About')}
            />
            <View style={styles.divider} />
            <Row
              icon="share-social"
              title="Share ORBII"
              body="The more people carry it, the safer everyone is."
              onPress={shareApp}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Row({
  icon,
  title,
  body,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={17} color={colors.brandDeep} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowBody}>{body}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  pressed: { opacity: 0.92 },
  header: { paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 24,
    color: colors.textPrimary,
    letterSpacing: -0.4,
  },
  sub: { ...typography.caption, fontSize: 12.5, color: colors.textSecondary, marginTop: 2 },

  sectionLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 1,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },

  learnCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  learnTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  learnIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  learnTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14.5,
    color: colors.textPrimary,
  },
  learnSub: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary, marginTop: 1 },
  learnPct: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: colors.brandDeep },
  learnBarTrack: {
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.creamDeep,
    overflow: 'hidden',
  },
  learnBarFill: { height: '100%', borderRadius: 4, backgroundColor: colors.brand },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    ...shadows.card,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  rowBody: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary, marginTop: 1 },
  rowNumber: { fontFamily: fontFamilies.poppinsBold, fontSize: 14, color: colors.brandDeep },
  divider: { height: 1, backgroundColor: colors.divider, marginLeft: 66 },
  footnote: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 15,
    paddingHorizontal: spacing.xs,
  },
});
