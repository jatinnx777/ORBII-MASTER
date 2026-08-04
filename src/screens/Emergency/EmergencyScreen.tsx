import React, { useEffect, useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { appAlert } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import {
  isListening,
  startListening,
  stopListening,
  subscribeStatus,
  type VoiceDetectionStatus,
} from '@/services/voice-detection';
import {
  startBackgroundVoice,
  stopBackgroundVoice,
  saveBgVoiceState,
  requestBatteryExemption,
} from '@/services/background-voice';
import { useIsPremium } from '@/services/entitlements';
import { trackEvent } from '@/services/analytics';
import { comingSoon } from '@/services/coming-soon';
import type { AppStackParamList } from '@/navigation/types';
import { useTabBarScroll } from '@/navigation/tabBarVisibility';

type Nav = NativeStackNavigationProp<AppStackParamList>;

// Emergency — everything that fires help, in one place.
//
// Only real, working triggers live here. No decorative buttons: on this screen
// a control that doesn't do what it says could get someone hurt.

export function EmergencyScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const onTabScroll = useTabBarScroll();
  const ghost = useAppSelector((s) => s.safetyModes.ghost);
  const deadman = useAppSelector((s) => s.safetyModes.deadman);
  const safeJourney = useAppSelector((s) => s.app.safeJourney);
  const isPremium = useIsPremium();

  const [voiceStatus, setVoiceStatus] = useState<VoiceDetectionStatus>(
    isListening() ? 'listening' : 'idle',
  );
  const [busy, setBusy] = useState(false);
  useEffect(() => subscribeStatus(setVoiceStatus), []);
  const voiceOn = voiceStatus === 'listening' || voiceStatus === 'starting';

  const toggleVoice = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (!next) {
        await stopBackgroundVoice();
        await saveBgVoiceState({ enabled: false, hours: 0 });
        await stopListening();
        return;
      }
      const res = await startListening();
      if (!res.ok) {
        appAlert(
          "Voice SOS couldn't start",
          res.reason === 'permission-denied'
            ? 'ORBII needs microphone access to hear you call for help.'
            : 'Voice SOS runs on the installed Android app.',
        );
        return;
      }
      // Also arm background protection (until turned off) so she stays covered
      // with the app closed, and ask Android not to kill it.
      await startBackgroundVoice([], 0).catch(() => undefined);
      await saveBgVoiceState({ enabled: true, hours: 0 });
      await requestBatteryExemption().catch(() => undefined);
      trackEvent('voice_sos_enabled', { from: 'emergency_tab' });
    } finally {
      setBusy(false);
    }
  };

  const dial112 = () => {
    Linking.openURL('tel:112').catch(() => undefined);
    trackEvent('sos_dialed_112', {});
  };

  const openGhost = () =>
    !isPremium
      ? navigation.navigate('PremiumUpgrade')
      : navigation.navigate(ghost?.active ? 'GhostActive' : 'GhostStart');
  const openDeadman = () =>
    !isPremium
      ? navigation.navigate('PremiumUpgrade')
      : navigation.navigate(deadman?.active ? 'DeadmanActive' : 'DeadmanStart');

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 110 }]}
          showsVerticalScrollIndicator={false}
          onScroll={onTabScroll}
          scrollEventThrottle={16}
        >
          <View style={styles.header}>
            <Text style={styles.title}>Emergency</Text>
            <Text style={styles.sub}>Quick access to every way of getting help.</Text>
          </View>

          {/* ── The big primary action: arm hands-free Voice SOS. It also turns
              on background protection, so once it's on she never has to touch
              the phone to get help. ── */}
          <Pressable
            onPress={() => toggleVoice(!voiceOn)}
            disabled={busy}
            style={({ pressed }) => [
              styles.voiceCard,
              voiceOn && styles.voiceCardOn,
              pressed && { transform: [{ scale: 0.98 }] },
            ]}
            accessibilityRole="switch"
            accessibilityState={{ checked: voiceOn }}
            accessibilityLabel="Activate Voice SOS"
          >
            <View style={styles.voiceBell}>
              <Ionicons name={voiceOn ? 'mic' : 'mic-outline'} size={30} color={colors.textInverse} />
            </View>
            <Text style={styles.voiceTitle}>{voiceOn ? 'Voice SOS is ON' : 'Activate Voice SOS'}</Text>
            <Text style={styles.voiceSub}>
              {voiceOn
                ? 'Listening for "help, help", even in the background.'
                : 'Tap to protect yourself hands-free.'}
            </Text>
          </Pressable>

          {/* ── Manual SOS + helpline ── */}
          <View style={styles.topRow}>
            <Pressable
              onPress={() => {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
                  () => undefined,
                );
                navigation.navigate('SOSCountdown');
              }}
              style={({ pressed }) => [styles.sosBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Send SOS alert now"
            >
              <View style={styles.sosBtnIcon}>
                <Ionicons name="notifications" size={18} color={colors.textInverse} />
              </View>
              <View>
                <Text style={styles.sosBtnLabel}>SOS</Text>
                <Text style={styles.sosBtnHint}>Tap to send alert</Text>
              </View>
            </Pressable>

            <Pressable
              onPress={dial112}
              style={({ pressed }) => [styles.callBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Call emergency helpline 112"
            >
              <View style={styles.callBtnIcon}>
                <Ionicons name="call" size={18} color={colors.brandDeep} />
              </View>
              <View>
                <Text style={styles.callBtnLabel}>Call 112</Text>
                <Text style={styles.callBtnHint}>Emergency line</Text>
              </View>
            </Pressable>
          </View>

          {/* ── Triggers ── */}
          <Text style={styles.sectionLabel}>MORE TRIGGERS</Text>
          <View style={styles.card}>
            <ModeRow
              icon="power"
              title="Button press"
              body="Press power or volume 3 times to fire an SOS."
              soon
              onPress={() => comingSoon('Button press trigger')}
            />
          </View>

          {/* ── Your circle ── */}
          <Text style={styles.sectionLabel}>YOUR CIRCLE</Text>
          <View style={styles.card}>
            <ModeRow
              icon="people"
              title="Trusted circle"
              body="The people ORBII reaches the instant you need help."
              onPress={() => navigation.navigate('Circles')}
            />
            <View style={styles.divider} />
            <ModeRow
              icon="call"
              title="Emergency contacts"
              body="Add or change who gets alerted."
              onPress={() => navigation.navigate('EmergencyContacts')}
            />
            <View style={styles.divider} />
            <ModeRow
              icon="locate"
              title="Geofencing"
              body="Draw an area on the map and get told if someone leaves it."
              onPress={() => navigation.navigate('Geofences')}
            />
          </View>

          {/* ── Safety modes ── */}
          <Text style={styles.sectionLabel}>SAFETY MODES</Text>
          <View style={styles.card}>
            <ModeRow
              icon="navigate"
              title="Safe journey"
              body="Live tracking. If you don't arrive, we alert your circle."
              onPress={() =>
                navigation.navigate(safeJourney ? 'SafeJourneyActive' : 'SafeJourneyStart')
              }
            />
            <View style={styles.divider} />
            <ModeRow
              icon="headset"
              title="Walk with me"
              body="Orbi keeps you company and checks in on the way."
              onPress={() => navigation.navigate('WalkWithMe')}
            />
            <View style={styles.divider} />
            <ModeRow
              icon="eye-off"
              title="Ghost mode"
              body="A silent trip your circle can watch without you touching the phone."
              locked={!isPremium}
              onPress={openGhost}
            />
            <View style={styles.divider} />
            <ModeRow
              icon="timer"
              title="Check-in timer"
              body="If you don't check in before it runs out, ORBII raises the alarm."
              locked={!isPremium}
              onPress={openDeadman}
            />
          </View>

          {/* ── Evidence ── */}
          <Text style={styles.sectionLabel}>EMERGENCY RECORDING</Text>
          <View style={styles.recRow}>
            <RecTile
              icon="mic"
              label="Audio record"
              live
              onPress={() => navigation.navigate('Recordings')}
            />
            <RecTile
              icon="videocam"
              label="Video record"
              onPress={() => comingSoon('Video recording')}
            />
            <RecTile
              icon="camera"
              label="Photo capture"
              onPress={() => comingSoon('Photo capture')}
            />
          </View>
          <View style={styles.noteCard}>
            <Ionicons name="recording" size={16} color={colors.brandDeep} />
            <Text style={styles.noteText}>
              Audio already records automatically during every SOS, including
              the 15 seconds before it fired. It's saved in your SOS history.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function RecTile({
  icon,
  label,
  live,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  live?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.recTile, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.recIcon}>
        <Ionicons name={icon} size={18} color={colors.brandDeep} />
      </View>
      <Text style={styles.recLabel} numberOfLines={1}>
        {label}
      </Text>
      {live ? (
        <View style={[styles.badge, styles.badgeLive]}>
          <Text style={[styles.badgeText, { color: colors.sageDeep }]}>Active</Text>
        </View>
      ) : (
        <View style={[styles.badge, styles.badgeSoon]}>
          <Text style={[styles.badgeText, { color: colors.textMuted }]}>Soon</Text>
        </View>
      )}
    </Pressable>
  );
}

function ModeRow({
  icon,
  title,
  body,
  locked,
  soon,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
  locked?: boolean;
  soon?: boolean;
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
        <Ionicons name={icon} size={18} color={colors.brandDeep} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowBody}>{body}</Text>
      </View>
      {locked ? (
        <View style={[styles.badge, styles.badgePlus]}>
          <Ionicons name="sparkles" size={10} color={colors.goldDeep} />
          <Text style={[styles.badgeText, { color: colors.goldDeep }]}>Plus</Text>
        </View>
      ) : soon ? (
        <View style={[styles.badge, styles.badgeSoon]}>
          <Text style={[styles.badgeText, { color: colors.textMuted }]}>Soon</Text>
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      )}
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

  voiceCard: {
    backgroundColor: colors.brand,
    borderRadius: radius.xxl,
    padding: spacing.lg,
    alignItems: 'center',
    gap: 6,
    shadowColor: colors.brand,
    shadowOpacity: 0.32,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 9,
  },
  voiceCardOn: { backgroundColor: colors.brandDeep },
  voiceBell: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  voiceTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    color: colors.textInverse,
    letterSpacing: 0.3,
  },
  voiceSub: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textInverse,
    opacity: 0.95,
    textAlign: 'center',
  },

  topRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'stretch' },
  sosBtn: {
    // The ultimate panic action: wider than Call 112 and glowing red so it
    // reads as the single most important button on the screen.
    flex: 1.35,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.coral,
    borderRadius: radius.xl,
    paddingVertical: 15,
    paddingHorizontal: spacing.md,
    shadowColor: colors.coral,
    shadowOpacity: 0.42,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  sosBtnIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosBtnLabel: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.textInverse },
  sosBtnHint: { ...typography.caption, fontSize: 10.5, color: colors.textInverse, opacity: 0.95 },
  callBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    ...shadows.card,
  },
  callBtnIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callBtnLabel: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: colors.textPrimary },
  callBtnHint: { ...typography.caption, fontSize: 10.5, color: colors.textSecondary },

  sectionLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 1,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    ...shadows.card,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconOn: { backgroundColor: colors.brand },
  rowTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14.5,
    color: colors.textPrimary,
  },
  rowBody: {
    ...typography.caption,
    fontSize: 11.5,
    color: colors.textSecondary,
    marginTop: 1,
    lineHeight: 16,
  },
  divider: { height: 1, backgroundColor: colors.divider, marginLeft: 66 },

  // One unified chip used for every status badge (Plus / Soon / Active).
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill },
  badgeText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 10.5 },
  badgePlus: { backgroundColor: colors.goldSoft },
  badgeSoon: { backgroundColor: colors.creamDeep },
  badgeLive: { backgroundColor: '#E6F4EC' },

  recRow: { flexDirection: 'row', gap: spacing.sm },
  recTile: {
    flex: 1,
    minHeight: 104,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    ...shadows.card,
  },
  recIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 11.5,
    color: colors.textPrimary,
  },

  noteCard: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.brandSoft,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  noteText: {
    flex: 1,
    ...typography.caption,
    fontSize: 11.5,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  historyBtn: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: spacing.xs,
    ...shadows.card,
  },
  historyBtnText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
});
