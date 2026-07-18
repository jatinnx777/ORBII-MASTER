import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { recordMood, snoozeMood, type Mood } from '@/services/mood';

// "How are you feeling?" — a gentle 12-hourly wellbeing check-in. A horizontal
// side-scrolling row of moods (not a fixed grid), then Confirm. On-device only.

type Option = { mood: Mood; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; tint: string; bg: string };

const OPTIONS: Option[] = [
  { mood: 'happy', label: 'Happy', icon: 'happy', tint: '#2E9B70', bg: '#E3F6EE' },
  { mood: 'calm', label: 'Calm', icon: 'leaf', tint: colors.brandDeep, bg: colors.brandSoft },
  { mood: 'sad', label: 'Sad', icon: 'sad', tint: '#4A78C2', bg: '#E6EEFB' },
  { mood: 'anxious', label: 'Anxious', icon: 'alert-circle', tint: colors.goldDeep, bg: colors.goldSoft },
  { mood: 'angry', label: 'Angry', icon: 'flame', tint: colors.coralDeep, bg: colors.coralSoft },
];

export function MoodCheckIn({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [picked, setPicked] = useState<Mood | null>(null);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    setPicked(null);
    anim.setValue(0);
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 8, tension: 90 }).start();
  }, [visible, anim]);

  const dismiss = async () => {
    await snoozeMood();
    onClose();
  };

  const confirm = async () => {
    if (!picked) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    await recordMood(picked);
    onClose();
  };

  return (
    <Modal visible={visible} transparent statusBarTranslucent onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <BlurView intensity={22} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.scrim} />
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />

        <Animated.View
          style={[
            styles.card,
            { opacity: anim, transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] },
          ]}
        >
          <Pressable style={styles.close} hitSlop={10} onPress={dismiss} accessibilityLabel="Close">
            <Ionicons name="close" size={18} color={colors.textSecondary} />
          </Pressable>

          <Text style={styles.title}>How are you feeling?</Text>
          <Text style={styles.sub}>A quick check-in, just for you.</Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
            style={styles.scroll}
          >
            {OPTIONS.map((o) => {
              const on = picked === o.mood;
              return (
                <Pressable
                  key={o.mood}
                  onPress={() => {
                    setPicked(o.mood);
                    Haptics.selectionAsync().catch(() => undefined);
                  }}
                  style={[styles.mood, on && styles.moodOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={o.label}
                >
                  <View style={[styles.moodIcon, { backgroundColor: o.bg }, on && { borderColor: o.tint, borderWidth: 2 }]}>
                    <Ionicons name={o.icon} size={30} color={o.tint} />
                  </View>
                  <Text style={[styles.moodLabel, on && { color: colors.textPrimary }]}>{o.label}</Text>
                  <View style={[styles.radio, on && { borderColor: colors.brand }]}>
                    {on ? <View style={styles.radioDot} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            onPress={confirm}
            disabled={!picked}
            style={({ pressed }) => [styles.confirm, !picked && { opacity: 0.5 }, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
            accessibilityLabel="Confirm"
          >
            <Text style={styles.confirmText}>Confirm</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20,20,30,0.34)' },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    alignItems: 'center',
    ...shadows.sheet,
  },
  close: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.creamDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: fontFamilies.poppinsBold, fontSize: 20, color: colors.textPrimary, letterSpacing: -0.3 },
  sub: { ...typography.caption, fontSize: 12.5, color: colors.textSecondary, marginTop: 2 },
  scroll: { alignSelf: 'stretch', marginTop: spacing.lg },
  row: { gap: spacing.md, paddingHorizontal: spacing.xs, paddingVertical: spacing.xs },
  mood: { alignItems: 'center', gap: 8, width: 86, paddingVertical: spacing.sm, borderRadius: radius.xl },
  moodOn: { backgroundColor: colors.brandSoft },
  moodIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moodLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.textSecondary },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand },
  confirm: {
    alignSelf: 'stretch',
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  confirmText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15.5, color: colors.textInverse },
});
