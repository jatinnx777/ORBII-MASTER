import React, { useState } from 'react';
import { appAlert } from '@/components/common';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { ScreenContainer } from '@/components/common';
import {
  colors,
  fontFamilies,
  radius,
  spacing,
  touchTarget,
  typography,
} from '@/theme';
import { useAppSelector } from '@/redux/store';
import { armDeadman } from '@/services/deadman';
import { requestNotificationPermission } from '@/services/notifications';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'DeadmanStart'>;

const PRESETS = [
  { label: '15 min', ms: 15 * 60_000 },
  { label: '30 min', ms: 30 * 60_000 },
  { label: '1 hour', ms: 60 * 60_000 },
  { label: '2 hours', ms: 2 * 60 * 60_000 },
];

export function DeadmanStartScreen() {
  const navigation = useNavigation<Nav>();
  const friends = useAppSelector((s) => s.user.profile?.friends ?? []);
  const active = useAppSelector((s) => s.safetyModes.deadman.active);

  const [durationMs, setDurationMs] = useState(30 * 60_000);
  const [shareLocation, setShareLocation] = useState(true);
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(friends.slice(0, Math.min(3, friends.length)).map((f) => f.username)),
  );
  const [submitting, setSubmitting] = useState(false);

  if (active) {
    // Already running, punt the user to the active screen.
    navigation.replace('DeadmanActive');
    return null;
  }

  const togglePicked = (username: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  };

  const handleArm = async () => {
    if (picked.size === 0) {
      appAlert(
        'Pick at least one person',
        'Your timer alerts the people in this list when it expires.',
      );
      return;
    }
    setSubmitting(true);
    try {
      await requestNotificationPermission();
      await armDeadman({
        durationMs,
        recipients: Array.from(picked),
        note: note.trim() || null,
        shareLocation,
      });
      navigation.replace('DeadmanActive');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenContainer padded={false} scroll={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Header onBack={() => navigation.goBack()} />

        <View style={styles.heroCard}>
          <LinearGradient
            colors={[colors.brandSoft, '#FFFFFF']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroGradient}
          >
            <View style={styles.heroIconWrap}>
              <Ionicons name="hourglass-outline" size={26} color={colors.brandDeep} />
            </View>
            <Text style={styles.heroTitle}>Deadman Timer</Text>
            <Text style={styles.heroSub}>
              Set a timer before a risky moment. Cancel it before it expires.
              If you don't, ORBII alerts your circle automatically.
            </Text>
          </LinearGradient>
        </View>

        <Section title="How long?" />
        <View style={styles.presetRow}>
          {PRESETS.map((p) => {
            const selected = durationMs === p.ms;
            return (
              <Pressable
                key={p.label}
                onPress={() => setDurationMs(p.ms)}
                style={({ pressed }) => [
                  styles.presetPill,
                  selected && styles.presetPillSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.presetLabel,
                    selected && styles.presetLabelSelected,
                  ]}
                >
                  {p.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Section title="Who gets notified?" />
        {friends.length === 0 ? (
          <View style={styles.emptyCircle}>
            <Ionicons name="people-outline" size={20} color={colors.textMuted} />
            <Text style={styles.emptyCircleText}>
              Add at least one friend to your circle first. Open Friends to
              invite someone.
            </Text>
          </View>
        ) : (
          <View style={styles.peoplePicker}>
            {friends.map((f) => {
              const selected = picked.has(f.username);
              return (
                <Pressable
                  key={f.username}
                  onPress={() => togglePicked(f.username)}
                  style={({ pressed }) => [
                    styles.personRow,
                    selected && styles.personRowSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.personAvatar}>
                    <Text style={styles.personAvatarText}>
                      {(f.name ?? f.username).charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.personName} numberOfLines={1}>
                      {f.name ?? `@${f.username}`}
                    </Text>
                    <Text style={styles.personHandle}>@{f.username}</Text>
                  </View>
                  <View
                    style={[
                      styles.personCheck,
                      selected && styles.personCheckOn,
                    ]}
                  >
                    {selected ? (
                      <Ionicons
                        name="checkmark"
                        size={14}
                        color={colors.textInverse}
                      />
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        <Section title="Optional details" />
        <View style={styles.noteWrap}>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Heading home from JNU campus"
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={140}
            style={styles.noteInput}
          />
        </View>

        <View style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Share live location</Text>
            <Text style={styles.toggleHint}>
              Recipients see your location only after the timer expires.
            </Text>
          </View>
          <Switch
            value={shareLocation}
            onValueChange={setShareLocation}
            trackColor={{ false: colors.border, true: colors.brandSoft }}
            thumbColor={shareLocation ? colors.brandDeep : colors.background}
          />
        </View>

        <View style={{ height: spacing.lg }} />
        <Pressable
          onPress={handleArm}
          disabled={submitting || picked.size === 0}
          style={({ pressed }) => [
            styles.armBtn,
            (pressed || submitting || picked.size === 0) && styles.pressed,
          ]}
        >
          <Ionicons name="hourglass" size={16} color={colors.textInverse} />
          <Text style={styles.armBtnText}>
            {submitting
              ? 'Arming…'
              : `Arm for ${PRESETS.find((p) => p.ms === durationMs)?.label ?? 'custom'}`}
          </Text>
        </Pressable>
        <Text style={styles.footnote}>
          Notifications need to stay on for the timer to escalate
          reliably.
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        hitSlop={12}
        style={styles.backBtn}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
      </Pressable>
      <Text style={styles.headerTitle}>Deadman Timer</Text>
      <View style={{ width: 38 }} />
    </View>
  );
}

function Section({ title }: { title: string }) {
  return <Text style={styles.section}>{title}</Text>;
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.md,
    paddingBottom: 100,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  heroCard: {
    borderRadius: 22,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  heroGradient: {
    padding: spacing.lg,
    gap: 8,
  },
  heroIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textPrimary,
    marginTop: 4,
  },
  heroSub: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  section: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetPill: {
    flex: 1,
    minWidth: '47%',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
  },
  presetPillSelected: {
    borderColor: colors.brandDeep,
    backgroundColor: colors.brandSoft,
  },
  presetLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  presetLabelSelected: {
    color: colors.brandDeep,
  },
  emptyCircle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
  },
  emptyCircleText: {
    flex: 1,
    fontFamily: fontFamilies.interMedium,
    fontSize: 12.5,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  peoplePicker: {
    gap: 8,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  personRowSelected: {
    borderColor: colors.brandDeep,
    backgroundColor: colors.brandSoft,
  },
  personAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personAvatarText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  personName: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13.5,
    color: colors.textPrimary,
  },
  personHandle: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 11,
    color: colors.textSecondary,
  },
  personCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personCheckOn: {
    backgroundColor: colors.brandDeep,
    borderColor: colors.brandDeep,
  },
  noteWrap: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noteInput: {
    minHeight: 60,
    fontFamily: fontFamilies.interMedium,
    fontSize: 14,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: spacing.md,
  },
  toggleLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  toggleHint: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 11.5,
    color: colors.textSecondary,
    marginTop: 2,
  },
  armBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: touchTarget.comfortable,
    borderRadius: radius.md,
    backgroundColor: colors.brandDeep,
    shadowColor: colors.brandDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.30,
    shadowRadius: 12,
    elevation: 6,
  },
  armBtnText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 15,
    color: colors.textInverse,
    letterSpacing: 0.3,
  },
  footnote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
});
