import React, { useState } from 'react';
import { appAlert } from '@/components/common';
import {
  Pressable,
  ScrollView,
  StyleSheet,
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
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { ghostStarted } from '@/redux/slices/safetyModesSlice';
import { getFastLocation } from '@/services/location';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'GhostStart'>;

export function GhostStartScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const isPremium = useAppSelector((s) => s.user.profile?.isPremium ?? false);
  const active = useAppSelector((s) => s.safetyModes.ghost.active);

  const [destination, setDestination] = useState('');
  const [cabNumber, setCabNumber] = useState('');
  const [driverName, setDriverName] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (active) {
    navigation.replace('GhostActive');
    return null;
  }

  const handleStart = async () => {
    if (destination.trim().length < 2) {
      appAlert(
        'Add a destination',
        'Tell ORBII where you\'re heading so it can flag if you go off-route.',
      );
      return;
    }
    setSubmitting(true);
    try {
      const point = await getFastLocation().catch(() => null);
      dispatch(
        ghostStarted({
          destinationLabel: destination.trim(),
          destination: null, // OSRM geocode is a future enhancement
          origin: point ?? null,
          cabNumber: cabNumber.trim() || null,
          driverName: driverName.trim() || null,
          note: note.trim() || null,
        }),
      );
      navigation.replace('GhostActive');
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
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={styles.backBtn}
          >
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Ghost Mode</Text>
          <View style={{ width: 38 }} />
        </View>

        <View style={styles.heroCard}>
          <LinearGradient
            colors={[colors.brandSoft, '#FFFFFF']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroGradient}
          >
            <View style={styles.heroIconWrap}>
              <Ionicons name="eye-outline" size={26} color={colors.brandDeep} />
            </View>
            <Text style={styles.heroTitle}>Quietly watching over you.</Text>
            <Text style={styles.heroSub}>
              Ghost Mode silently tracks your trip. If you go off-route, stop
              for too long, or your phone goes dark, ORBII checks in and can
              alert your circle automatically.
            </Text>
          </LinearGradient>
        </View>

        <Section title="Where are you headed?" />
        <Field
          icon="navigate-outline"
          placeholder="e.g. Home, Connaught Place, Friend's place"
          value={destination}
          onChangeText={setDestination}
        />

        <SectionWithBadge title="Ride details" badge="GOLD" locked={!isPremium} />
        <Field
          icon="car-outline"
          placeholder="Cab / vehicle number"
          value={cabNumber}
          onChangeText={setCabNumber}
          editable={isPremium}
        />
        <View style={{ height: 8 }} />
        <Field
          icon="person-outline"
          placeholder="Driver name (optional)"
          value={driverName}
          onChangeText={setDriverName}
          editable={isPremium}
        />
        {!isPremium ? (
          <Pressable
            onPress={() => navigation.navigate('PremiumUpgrade')}
            style={({ pressed }) => [
              styles.upgradeRow,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="sparkles" size={14} color={colors.brandDeep} />
            <Text style={styles.upgradeText}>
              Cab tracking is part of Gold. Tap to unlock.
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
          </Pressable>
        ) : null}

        <Section title="Note for your circle" />
        <View style={styles.noteWrap}>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Coming home from college"
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={140}
            style={styles.noteInput}
          />
        </View>

        <View style={{ height: spacing.lg }} />
        <Pressable
          onPress={handleStart}
          disabled={submitting}
          style={({ pressed }) => [
            styles.startBtn,
            (pressed || submitting) && styles.pressed,
          ]}
        >
          <Ionicons name="eye" size={16} color={colors.textInverse} />
          <Text style={styles.startBtnText}>
            {submitting ? 'Starting…' : 'Start Ghost Mode'}
          </Text>
        </Pressable>
        <Text style={styles.footnote}>
          Your trip stays on this device. Your circle only learns about it
          if Ghost Mode flags something.
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}

function Section({ title }: { title: string }) {
  return <Text style={styles.section}>{title}</Text>;
}

function SectionWithBadge({
  title,
  badge,
  locked,
}: {
  title: string;
  badge: string;
  locked: boolean;
}) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.section}>{title}</Text>
      <View
        style={[
          styles.tierBadge,
          { backgroundColor: locked ? colors.surface : '#FFF1CB' },
        ]}
      >
        {locked ? (
          <Ionicons name="lock-closed" size={9} color={colors.textPrimary} />
        ) : null}
        <Text style={styles.tierBadgeText}>{badge}</Text>
      </View>
    </View>
  );
}

function Field({
  icon,
  placeholder,
  value,
  onChangeText,
  editable = true,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  placeholder: string;
  value: string;
  onChangeText: (v: string) => void;
  editable?: boolean;
}) {
  return (
    <View style={[styles.fieldWrap, !editable && styles.fieldWrapDisabled]}>
      <Ionicons
        name={icon}
        size={18}
        color={editable ? colors.textSecondary : colors.textMuted}
      />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        editable={editable}
        style={styles.fieldInput}
      />
    </View>
  );
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
    letterSpacing: -0.3,
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
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  tierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.circle,
  },
  tierBadgeText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 9,
    color: colors.textPrimary,
    letterSpacing: 0.6,
  },
  fieldWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  fieldWrapDisabled: {
    backgroundColor: colors.surface,
    opacity: 0.7,
  },
  fieldInput: {
    flex: 1,
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  upgradeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginTop: 8,
  },
  upgradeText: {
    flex: 1,
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12,
    color: colors.textPrimary,
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
  startBtn: {
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
  startBtnText: {
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
