import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenContainer } from '@/components/common';
import { useAppSelector } from '@/redux/store';
import { requestPermission } from '@/services/location';
import { requestNotificationPermission } from '@/services/notifications';
import { setItem, storageKeys } from '@/services/storage';
import { READINESS_CAP, SAFETY_DISCLAIMER, useReadiness } from '@/services/readiness';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { accentOf } from '@/theme/accents';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

type ItemId =
  | 'account'
  | 'contact'
  | 'voice'
  | 'notifications'
  | 'location'
  | 'test';

type ChecklistItem = {
  id: ItemId;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
  done: boolean;
};

export function SafetyReadinessScreen() {
  const navigation = useNavigation<Nav>();
  const { signals, doneCount, total, pct, reload } = useReadiness();
  const accent = accentOf(useAppSelector((s) => s.app.accent));

  const [simOpen, setSimOpen] = useState(false);
  const [busy, setBusy] = useState<ItemId | null>(null);

  const load = reload;

  const items: ChecklistItem[] = [
    { id: 'account', icon: 'person-circle', title: 'Create your account', body: 'You’re signed in and ready.', done: signals.account },
    { id: 'contact', icon: 'people', title: 'Add an emergency contact', body: 'Someone we alert the moment you need help.', done: signals.contact },
    { id: 'voice', icon: 'mic', title: 'Enable Voice SOS', body: 'Shout "help, help" to get help hands-free.', done: signals.voice },
    { id: 'notifications', icon: 'notifications', title: 'Turn on notifications', body: 'So you never miss an alert.', done: signals.notifications },
    { id: 'location', icon: 'location', title: 'Share your location', body: 'So help can reach the right place fast.', done: signals.location },
    { id: 'test', icon: 'shield-checkmark', title: 'Run a safety test', body: 'See ORBII spring into action, safely.', done: signals.test },
  ];

  // animated progress bar + headline number
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(progress, { toValue: pct / 100, useNativeDriver: false, friction: 7 }).start();
  }, [pct, progress]);

  const handleItem = async (item: ChecklistItem) => {
    if (item.done || busy) return;
    Haptics.selectionAsync().catch(() => undefined);
    setBusy(item.id);
    try {
      switch (item.id) {
        case 'contact':
          navigation.navigate('EmergencyContacts');
          break;
        case 'voice':
          if (Platform.OS === 'android') {
            await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
          }
          break;
        case 'notifications':
          await requestNotificationPermission();
          break;
        case 'location':
          await requestPermission();
          break;
        case 'test':
          setSimOpen(true);
          break;
      }
    } finally {
      setBusy(null);
      load();
    }
  };

  // Loss-framed when the most critical gap (no contacts) is open: state what
  // is missing, factually, instead of vague encouragement.
  const headline =
    pct >= READINESS_CAP
      ? "You're fully protected."
      : !signals.contact
        ? 'Your SOS has no one to reach yet. Add a contact.'
        : pct >= 60
          ? "Almost there. You're well protected."
          : pct >= 30
            ? 'Nice start. Let’s lock in your safety.'
            : 'Let’s get you set up in a minute.';

  return (
    <ScreenContainer padded={false} edges={['top', 'left', 'right']}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Safety Readiness</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* big % + progress */}
          <View style={[styles.heroCard, { backgroundColor: accent.soft + '55' }]}>
            <Text style={[styles.pct, { color: accent.deep }]}>{pct}%</Text>
            <Text style={styles.headline}>{headline}</Text>
            <View style={styles.barTrack}>
              <Animated.View
                style={[
                  styles.barFill,
                  {
                    width: progress.interpolate({ inputRange: [0, 1], outputRange: ['4%', '100%'] }),
                    backgroundColor: pct >= READINESS_CAP ? colors.sage : accent.deep,
                  },
                ]}
              />
            </View>
            <Text style={styles.barCaption}>{doneCount} of {items.length} done</Text>
            {pct >= READINESS_CAP ? (
              <Text style={styles.capNote}>
                We cap protection at {READINESS_CAP}%. No safety system can ever
                promise 100%.
              </Text>
            ) : null}
          </View>

          {items.map((item, i) => (
            <ChecklistRow key={item.id} item={item} index={i} onPress={() => handleItem(item)} loading={busy === item.id} />
          ))}

          <Text style={styles.disclaimer}>{SAFETY_DISCLAIMER}</Text>
        </ScrollView>
      </SafeAreaView>

      <SafetyTestModal
        visible={simOpen}
        onDone={async () => {
          await setItem(storageKeys.safetyTest, true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
          setSimOpen(false);
          load();
        }}
      />
    </ScreenContainer>
  );
}

function ChecklistRow({
  item,
  index,
  onPress,
  loading,
}: {
  item: ChecklistItem;
  index: number;
  onPress: () => void;
  loading: boolean;
}) {
  const enter = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(item.done ? 1 : 0)).current;
  const prevDone = useRef(item.done);

  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 320, delay: index * 70, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [enter, index]);

  useEffect(() => {
    if (item.done && !prevDone.current) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      pop.setValue(0);
      Animated.spring(pop, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }).start();
    }
    prevDone.current = item.done;
  }, [item.done, pop]);

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  const checkScale = pop.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.4, 1.25, 1] });

  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY }] }}>
      <Pressable
        onPress={onPress}
        disabled={item.done || loading}
        style={({ pressed }) => [styles.row, item.done && styles.rowDone, pressed && styles.rowPressed]}
        accessibilityRole="button"
      >
        <View style={[styles.rowIcon, item.done && styles.rowIconDone]}>
          <Ionicons name={item.icon} size={20} color={item.done ? colors.sageDeep : colors.peachDeep} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{item.title}</Text>
          <Text style={styles.rowBody}>{item.body}</Text>
        </View>
        {item.done ? (
          <Animated.View style={[styles.checkCircle, { transform: [{ scale: checkScale }] }]}>
            <Ionicons name="checkmark" size={16} color={colors.textInverse} />
          </Animated.View>
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        )}
      </Pressable>
    </Animated.View>
  );
}

const SIM_STEPS = [
  { icon: 'mic', label: 'Voice detected' },
  { icon: 'location', label: 'Location ready' },
  { icon: 'people', label: 'Emergency contacts ready' },
  { icon: 'shield-checkmark', label: 'Protection active' },
] as const;

function SafetyTestModal({ visible, onDone }: { visible: boolean; onDone: () => void }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!visible) {
      setStep(0);
      return;
    }
    const timers = SIM_STEPS.map((_, i) =>
      setTimeout(() => {
        setStep(i + 1);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      }, (i + 1) * 700),
    );
    return () => timers.forEach(clearTimeout);
  }, [visible]);

  const complete = step >= SIM_STEPS.length;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.simBackdrop}>
        <View style={styles.simCard}>
          <Text style={styles.simTitle}>{complete ? "You're protected" : 'Running safety test…'}</Text>
          <Text style={styles.simSub}>This is only a test. No real alerts are sent.</Text>
          <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
            {SIM_STEPS.map((s, i) => {
              const on = step > i;
              return (
                <View key={s.label} style={[styles.simRow, on && styles.simRowOn]}>
                  <View style={[styles.simIcon, on && styles.simIconOn]}>
                    <Ionicons name={on ? 'checkmark' : s.icon} size={16} color={on ? colors.textInverse : colors.textMuted} />
                  </View>
                  <Text style={[styles.simLabel, on && styles.simLabelOn]}>{s.label}</Text>
                </View>
              );
            })}
          </View>
          {complete ? (
            <Pressable onPress={onDone} style={styles.simBtn}>
              <Text style={styles.simBtnText}>Done</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
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
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    ...shadows.icon,
  },
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  scroll: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    ...shadows.card,
  },
  pct: { fontFamily: fontFamilies.poppinsBold, fontSize: 44, color: colors.peachDeep, letterSpacing: -1 },
  headline: { ...typography.bodyMedium, color: colors.textPrimary, marginTop: 2, marginBottom: spacing.md },
  barTrack: { height: 12, borderRadius: 6, backgroundColor: colors.creamDeep, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 6 },
  barCaption: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  capNote: { ...typography.caption, fontSize: 11, color: colors.textMuted, marginTop: spacing.xs },
  disclaimer: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 9.5,
    lineHeight: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    ...shadows.card,
  },
  rowDone: { backgroundColor: colors.sageSoft },
  rowPressed: { transform: [{ scale: 0.985 }], opacity: 0.95 },
  rowIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.peachSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconDone: { backgroundColor: colors.surfaceAlt },
  rowTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary },
  rowBody: { ...typography.caption, fontSize: 12.5, color: colors.textSecondary, marginTop: 1 },
  checkCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.sage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  simBackdrop: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  simCard: { width: '100%', backgroundColor: colors.surface, borderRadius: radius.xxl, padding: spacing.lg },
  simTitle: { ...typography.h3, color: colors.textPrimary },
  simSub: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  simRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, opacity: 0.5 },
  simRowOn: { opacity: 1 },
  simIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.creamDeep, alignItems: 'center', justifyContent: 'center' },
  simIconOn: { backgroundColor: colors.sage },
  simLabel: { ...typography.bodyMedium, color: colors.textSecondary },
  simLabelOn: { color: colors.textPrimary },
  simBtn: { marginTop: spacing.lg, backgroundColor: colors.peach, borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center' },
  simBtnText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary },
});
