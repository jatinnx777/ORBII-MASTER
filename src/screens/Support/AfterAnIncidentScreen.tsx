import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer } from '@/components/common';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

// What to do after something has happened.
//
// Most safety apps stop at "alert sent". The hours after are when people are
// told wrong things by whoever is standing nearby: that an FIR can only be
// filed where it happened, that a hospital can refuse until the police arrive,
// that a lawyer has to be paid for. None of those are true, and each one costs
// somebody their case.
//
// EVERYTHING ON THIS SCREEN IS GENERAL INFORMATION, NOT LEGAL ADVICE, and it
// says so at the bottom rather than implying otherwise. Every legal statement
// here is tied to a specific provision of the BNSS, which replaced the CrPC on
// 1 July 2024, so it can be checked and corrected rather than trusted.

type Step = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  /** Optional phone number to call, or a URL to open. */
  call?: string;
  link?: { label: string; url: string };
};

const NOW: Step[] = [
  {
    icon: 'call',
    title: 'Get to safety, then call 112',
    body:
      'One number for police, fire and ambulance, anywhere in India. If you are hurt or still in danger, this comes before everything else on this page.',
    call: '112',
  },
  {
    icon: 'medkit',
    title: 'Any hospital must treat you free of cost',
    body:
      'Under Section 397 of the BNSS, every hospital, government or private, must immediately give free first aid or medical treatment to victims of the offences it covers, and must inform the police. You do not need an FIR first, and you do not need to pay.',
  },
  {
    icon: 'person',
    title: 'Tell one person you trust',
    body:
      'Not for the case. For you. The first hours are when people decide alone that it was not serious enough to report, and that decision is easier to make badly on your own.',
  },
];

const EVIDENCE: Step[] = [
  {
    icon: 'document-text',
    title: 'Export your ORBII incident report',
    body:
      'If you raised an SOS, open it in History and tap Export incident report. You get a timestamped PDF with where it started, the location trail, which recordings exist, who was alerted and who responded, in India Standard Time. Attach it to a complaint.',
  },
  {
    icon: 'time',
    title: 'Write down the timeline while it is fresh',
    body:
      'Times, places, what was said, vehicle numbers, names, who else was there. Memory for detail fades within a day, and the detail is what a statement is made of.',
  },
  {
    icon: 'images',
    title: 'Do not delete anything, and do not clean up',
    body:
      'Keep messages, call logs, photos and screenshots, even the ones you would rather not keep. If there was physical contact, avoid washing or discarding the clothes you were wearing before a medical examination.',
  },
];

const FIR: Step[] = [
  {
    icon: 'business',
    title: 'You can file at any police station, not just the local one',
    body:
      'This is a Zero FIR, and Section 173(1) of the BNSS puts it in the law. Any station must register it regardless of where the offence happened. It is numbered zero and then transferred to the station that has jurisdiction, so refusing you on the grounds of area is not something they are entitled to do.',
  },
  {
    icon: 'woman',
    title: 'A woman officer records the statement',
    body:
      'For the offences against women that the law specifies, your statement is to be recorded by a woman police officer.',
  },
  {
    icon: 'home',
    title: 'You do not have to go to the police station',
    body:
      'Women, children under fifteen, people over sixty, and people with a disability or acute illness are not required to attend a police station. The statement can be taken where you are.',
  },
  {
    icon: 'copy',
    title: 'Your copy of the FIR is free, and immediate',
    body:
      'Section 173(2) of the BNSS says a copy must be given to the informant or victim forthwith, free of cost. Ask for it before you leave, and keep it.',
  },
  {
    icon: 'arrow-up-circle',
    title: 'If they refuse, go above them in writing',
    body:
      'Send your complaint in writing to the Superintendent of Police under Section 175 of the BNSS. An officer who refuses to register a case can face action for it. Keep a copy of what you sent and how you sent it.',
  },
];

const ONLINE: Step[] = [
  {
    icon: 'globe',
    title: 'Report it at cybercrime.gov.in, or call 1930',
    body:
      'The national portal has a track for crimes against women and children which allows an anonymous complaint, so you can report without your identity being in it. Report to the platform as well, because the platform is what actually removes the content.',
    link: { label: 'Open cybercrime.gov.in', url: 'https://cybercrime.gov.in' },
  },
];

const HELP: Step[] = [
  {
    icon: 'scale',
    title: 'A lawyer costs you nothing if you qualify',
    body:
      'Free legal aid is a statutory service through the legal services authorities, from the district level up to NALSA, and every woman is entitled to it. It covers a lawyer, filing costs and drafting.',
    link: { label: 'Open nalsa.gov.in', url: 'https://nalsa.gov.in' },
  },
  {
    icon: 'heart',
    title: 'Women’s helpline, 1091',
    body: 'Free, 24 hours.',
    call: '1091',
  },
  {
    icon: 'home',
    title: 'Domestic abuse helpline, 181',
    body: 'Free, 24 hours, including shelter and counselling referrals.',
    call: '181',
  },
  {
    icon: 'chatbubbles',
    title: 'Tele-MANAS, 14416',
    body: 'The government mental health line. Free, 24 hours, in several languages.',
    call: '14416',
  },
];

export function AfterAnIncidentScreen() {
  const navigation = useNavigation<Nav>();

  const call = (n: string) => Linking.openURL(`tel:${n}`).catch(() => undefined);
  const open = (u: string) => Linking.openURL(u).catch(() => undefined);

  const Section = ({ label, steps }: { label: string; steps: Step[] }) => (
    <>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.card}>
        {steps.map((s, i) => (
          <React.Fragment key={s.title}>
            {i > 0 ? <View style={styles.divider} /> : null}
            <View style={styles.row}>
              <View style={styles.rowIcon}>
                <Ionicons name={s.icon} size={17} color={colors.brandDeep} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{s.title}</Text>
                <Text style={styles.rowBody}>{s.body}</Text>
                {s.call ? (
                  <Pressable
                    onPress={() => call(s.call as string)}
                    style={({ pressed }) => [styles.action, pressed && { opacity: 0.85 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Call ${s.call}`}
                  >
                    <Ionicons name="call" size={14} color={colors.textInverse} />
                    <Text style={styles.actionText}>Call {s.call}</Text>
                  </Pressable>
                ) : null}
                {s.link ? (
                  <Pressable
                    onPress={() => open(s.link!.url)}
                    style={({ pressed }) => [styles.actionGhost, pressed && { opacity: 0.85 }]}
                    accessibilityRole="button"
                    accessibilityLabel={s.link.label}
                  >
                    <Ionicons name="open-outline" size={14} color={colors.textPrimary} />
                    <Text style={styles.actionGhostText}>{s.link.label}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </React.Fragment>
        ))}
      </View>
    </>
  );

  return (
    <ScreenContainer padded={false} scroll={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>SUPPORT</Text>
            <Text style={styles.title}>After an incident</Text>
          </View>
        </View>

        <Text style={styles.intro}>
          What you are entitled to in India, in the order it usually matters. Most of this is
          not widely known, and being told the wrong thing at a police station or a hospital is
          the common way people lose a case before it starts.
        </Text>

        <Section label="RIGHT NOW" steps={NOW} />
        <Section label="KEEP WHAT PROVES IT" steps={EVIDENCE} />
        <Section label="FILING AN FIR" steps={FIR} />
        <Section label="IF IT HAPPENED ONLINE" steps={ONLINE} />
        <Section label="FREE HELP" steps={HELP} />

        <Text style={styles.disclaimer}>
          This is general information, not legal advice, and ORBII is not a law firm or a police
          service. The provisions named here are from the Bharatiya Nagarik Suraksha Sanhita,
          which replaced the CrPC on 1 July 2024. Laws and procedures change, so for your own
          case, use the free legal aid above.
        </Text>
        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.primary,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 26,
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  intro: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.textMuted,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  divider: { height: 1, backgroundColor: colors.border },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    alignItems: 'flex-start',
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  rowTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  rowBody: {
    ...typography.caption,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.circle,
    backgroundColor: colors.textPrimary,
  },
  actionText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13,
    color: colors.textInverse,
  },
  actionGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.circle,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  actionGhostText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  disclaimer: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.lg,
    lineHeight: 18,
  },
});
