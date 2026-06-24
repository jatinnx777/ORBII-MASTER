import React, { useMemo, useState } from 'react';
import { appAlert } from '@/components/common';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, ScreenContainer } from '@/components/common';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { safeJourneyStarted } from '@/redux/slices/appSlice';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

const QUICK_DURATIONS = [
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '1 hr', minutes: 60 },
  { label: '2 hr', minutes: 120 },
];

const QUICK_LABELS = ['Walk home', 'Cab ride', 'Commute', 'Meeting', 'Gym', 'Night out'];

export function SafeJourneyStartScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);

  const [label, setLabel] = useState('Walk home');
  const [minutes, setMinutes] = useState(30);
  const [contactId, setContactId] = useState<string | null>(
    profile?.emergencyContacts[0]?.id ?? null,
  );

  const contacts = profile?.emergencyContacts ?? [];

  const etaText = useMemo(() => {
    const arrival = new Date(Date.now() + minutes * 60_000);
    return arrival.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [minutes]);

  const handleStart = () => {
    if (!label.trim()) {
      appAlert('Pick a label', 'Tell us what this journey is.');
      return;
    }
    dispatch(
      safeJourneyStarted({
        label: label.trim(),
        etaMs: Date.now() + minutes * 60_000,
        trustedContactId: contactId,
      }),
    );
    navigation.replace('SafeJourneyActive');
  };

  return (
    <ScreenContainer padded={false} scroll={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>SAFE MODE</Text>
            <Text style={styles.title}>Start a journey</Text>
          </View>
        </View>

        <Text style={styles.body}>
          We'll watch over your trip. If you don't mark yourself safe by the
          arrival time, ORBII auto-fires SOS and alerts your trusted contact.
        </Text>

        <Text style={styles.sectionLabel}>WHAT ARE YOU DOING?</Text>
        <View style={styles.chipRow}>
          {QUICK_LABELS.map((l) => {
            const active = l === label;
            return (
              <Pressable
                key={l}
                onPress={() => setLabel(l)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text
                  style={[
                    styles.chipText,
                    active && styles.chipTextActive,
                  ]}
                >
                  {l}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>ARRIVE BY</Text>
        <View style={styles.durationCard}>
          <Text style={styles.durationTime}>{etaText}</Text>
          <Text style={styles.durationMeta}>
            in {minutes < 60 ? `${minutes} min` : `${(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1)} hr`}
          </Text>
        </View>
        <View style={styles.chipRow}>
          {QUICK_DURATIONS.map((d) => {
            const active = d.minutes === minutes;
            return (
              <Pressable
                key={d.label}
                onPress={() => setMinutes(d.minutes)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text
                  style={[
                    styles.chipText,
                    active && styles.chipTextActive,
                  ]}
                >
                  {d.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>TRUSTED CONTACT</Text>
        {contacts.length === 0 ? (
          <Pressable
            onPress={() => navigation.navigate('EmergencyContacts')}
            style={styles.emptyContacts}
          >
            <Ionicons name="person-add-outline" size={18} color={colors.primary} />
            <Text style={styles.emptyContactsText}>
              Add a trusted contact so they can check on you
            </Text>
          </Pressable>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {contacts.map((c) => {
              const active = c.id === contactId;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setContactId(c.id)}
                  style={[styles.contactRow, active && styles.contactRowActive]}
                >
                  <View style={styles.contactAvatar}>
                    <Text style={styles.contactInitial}>
                      {c.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.contactName}>{c.name}</Text>
                    <Text style={styles.contactPhone}>{c.phone}</Text>
                  </View>
                  <View
                    style={[styles.radio, active && styles.radioActive]}
                  >
                    {active ? (
                      <View style={styles.radioDot} />
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={{ height: spacing.xl }} />
      </ScrollView>

      <View style={styles.footer}>
        <Button label="Start Safe Mode" onPress={handleStart} />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
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
  body: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.textMuted,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  chipText: {
    ...typography.bodyMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  chipTextActive: {
    color: colors.textInverse,
  },
  durationCard: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    alignItems: 'center',
  },
  durationTime: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 40,
    color: colors.textPrimary,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  durationMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  emptyContacts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 77, 77, 0.22)',
    backgroundColor: 'rgba(255, 77, 77, 0.08)',
  },
  emptyContactsText: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
    flex: 1,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  contactRowActive: {
    borderColor: colors.textPrimary,
    borderWidth: 2,
  },
  contactAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E3F2FD',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#1976D2',
  },
  contactInitial: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 15,
    color: '#1976D2',
  },
  contactName: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 15,
    color: colors.textPrimary,
  },
  contactPhone: {
    ...typography.caption,
    color: colors.textMuted,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: {
    borderColor: colors.textPrimary,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.textPrimary,
  },
  footer: {
    padding: spacing.lg,
    paddingTop: spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    ...shadows.sheet,
  },
});
