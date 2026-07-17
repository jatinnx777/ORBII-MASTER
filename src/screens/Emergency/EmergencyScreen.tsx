import React, { useEffect, useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
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
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { shakeSOSToggled } from '@/redux/slices/appSlice';
import {
  isListening,
  startListening,
  stopListening,
  subscribeStatus,
  type VoiceDetectionStatus,
} from '@/services/voice-detection';
import { useIsPremium } from '@/services/entitlements';
import { trackEvent } from '@/services/analytics';
import { comingSoon } from '@/services/coming-soon';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

// Emergency — everything that fires help, in one place.
//
// Only real, working triggers live here. No decorative buttons: on this screen
// a control that doesn't do what it says could get someone hurt.

export function EmergencyScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const dispatch = useAppDispatch();
  const shakeSOS = useAppSelector((s) => s.app.shakeSOS);
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
        >
          <View style={styles.header}>
            <Text style={styles.title}>Emergency</Text>
            <Text style={styles.sub}>Quick access to every way of getting help.</Text>
          </View>

          {/* ── SOS + helpline ── */}
          <View style={styles.topRow}>
            <Pressable
              onPress={() => {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
                  () => undefined,
                );
                navigation.navigate('SOSCountdown');
              }}
              style={({ pressed }) => [styles.sosCard, pressed && { transform: [{ scale: 0.98 }] }]}
              accessibilityRole="button"
              accessibilityLabel="Send SOS alert"
            >
              <View style={styles.sosBell}>
                <Ionicons name="notifications" size={22} color={colors.textInverse} />
              </View>
              <Text style={styles.sosTitle}>SOS</Text>
              <Text style={styles.sosSub}>Tap to send alert</Text>
            </Pressable>

            <View style={styles.topRight}>
              <Pressable
                onPress={dial112}
                style={({ pressed }) => [styles.miniCard, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Call emergency helpline 112"
              >
                <View style={styles.miniIcon}>
                  <Ionicons name="call" size={17} color={colors.brandDeep} />
                </View>
                <Text style={styles.miniLabel}>Emergency helpline</Text>
                <Text style={styles.miniHint}>Call 112</Text>
              </Pressable>

              <Pressable
                onPress={() => navigation.navigate('SOSCountdown', { test: true })}
                style={({ pressed }) => [styles.miniCard, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Run a practice SOS"
              >
                <View style={styles.miniIcon}>
                  <Ionicons name="shield-checkmark" size={17} color={colors.brandDeep} />
                </View>
                <Text style={styles.miniLabel}>Practice SOS</Text>
                <Text style={styles.miniHint}>Nobody is alerted</Text>
              </Pressable>
            </View>
          </View>

          {/* ── Triggers ── */}
          <Text style={styles.sectionLabel}>EMERGENCY TRIGGERS</Text>
          <View style={styles.card}>
            <ToggleRow
              icon="mic"
              title="Voice SOS"
              body='Shout "help, help" and ORBII fires, hands-free.'
              value={voiceOn}
              disabled={busy}
              onValueChange={toggleVoice}
            />
            <View style={styles.divider} />
            <ToggleRow
              icon="phone-portrait"
              title="Shake to alert"
              body="Shake your phone hard to start an SOS."
              value={shakeSOS}
              onValueChange={(v) => dispatch(shakeSOSToggled(v))}
            />
            <View style={styles.divider} />
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
              title="Safe zones"
              body="Get told when someone you love leaves a safe area."
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
              onPress={() => navigation.navigate('History')}
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

function ToggleRow({
  icon,
  title,
  body,
  value,
  disabled,
  onValueChange,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, value && styles.rowIconOn]}>
        <Ionicons name={icon} size={18} color={value ? colors.textInverse : colors.brandDeep} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowBody}>{body}</Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ true: colors.brandSoft, false: colors.border }}
        thumbColor={value ? colors.brand : colors.surface}
      />
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
      {!live ? <Text style={styles.recSoon}>Soon</Text> : null}
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
        <View style={styles.lockPill}>
          <Ionicons name="sparkles" size={11} color={colors.goldDeep} />
          <Text style={styles.lockText}>Plus</Text>
        </View>
      ) : soon ? (
        <View style={styles.soonPill}>
          <Text style={styles.soonText}>Soon</Text>
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

  topRow: { flexDirection: 'row', gap: spacing.md },
  sosCard: {
    flex: 1,
    backgroundColor: colors.coral,
    borderRadius: radius.xl,
    padding: spacing.lg,
    justifyContent: 'center',
    minHeight: 150,
    shadowColor: colors.coral,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  sosBell: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  sosTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 26,
    color: colors.textInverse,
    letterSpacing: 1,
  },
  sosSub: { ...typography.caption, fontSize: 11.5, color: colors.textInverse, opacity: 0.95 },
  topRight: { flex: 1, gap: spacing.md },
  miniCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    justifyContent: 'center',
    ...shadows.card,
  },
  miniIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  miniLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12.5,
    color: colors.textPrimary,
  },
  miniHint: { ...typography.caption, fontSize: 10.5, color: colors.textSecondary },

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
  lockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.goldSoft,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  lockText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 11, color: colors.goldDeep },

  soonPill: {
    backgroundColor: colors.creamDeep,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  soonText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 10.5, color: colors.textMuted },

  recRow: { flexDirection: 'row', gap: spacing.sm },
  recTile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: 6,
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
  recSoon: { ...typography.caption, fontSize: 9.5, color: colors.textMuted },

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
