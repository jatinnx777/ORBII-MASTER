import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { safeJourneyLinked, safeJourneyStarted } from '@/redux/slices/appSlice';
import { startSafeJourney } from '@/services/circles';
import { isCircleSharing, startCircleSharing } from '@/services/circle-location';
import {
  addPreset,
  loadJourneyPresets,
  normalisePreset,
  removePreset,
  saveJourneyPresets,
  type JourneyPreset,
} from '@/services/journey-presets';
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
  // The circle told about this journey. Null when she has none yet, in which
  // case the journey still runs locally and simply announces itself to
  // nobody.
  const circleId = useAppSelector((s) => s.circles.activeCircleId);

  const [label, setLabel] = useState('Walk home');
  const [minutes, setMinutes] = useState(30);
  const [contactId, setContactId] = useState<string | null>(
    profile?.emergencyContacts[0]?.id ?? null,
  );
  const [presets, setPresets] = useState<JourneyPreset[]>([]);

  const contacts = profile?.emergencyContacts ?? [];

  useEffect(() => {
    let alive = true;
    void loadJourneyPresets().then((list) => {
      if (alive) setPresets(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  const etaText = useMemo(() => {
    const arrival = new Date(Date.now() + minutes * 60_000);
    return arrival.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [minutes]);

  /**
   * Filling the form from a saved trip.
   *
   * The one case that must not be silent is a preset pointing at a contact who
   * has since been deleted. Falling back quietly would start a journey with
   * nobody watching it, which looks identical on screen to one that is being
   * watched. So it falls back to the first contact AND says so.
   */
  const applyPreset = useCallback(
    (p: JourneyPreset) => {
      setLabel(p.label);
      setMinutes(p.minutes);

      const stillThere = p.contactId
        ? contacts.some((c) => c.id === p.contactId)
        : false;

      if (p.contactId && !stillThere) {
        const fallback = contacts[0] ?? null;
        setContactId(fallback?.id ?? null);
        appAlert(
          'Check who is watching',
          fallback
            ? `The contact saved with "${p.label}" is no longer in your contacts, so ${fallback.name} is selected instead.`
            : `The contact saved with "${p.label}" is no longer in your contacts, and you have none left. Add one before starting.`,
        );
        return;
      }

      setContactId(p.contactId ?? contacts[0]?.id ?? null);
    },
    [contacts],
  );

  const saveCurrent = useCallback(async () => {
    const preset = normalisePreset({ label, minutes, contactId });
    if (!preset) {
      appAlert('Name the trip', 'Give this journey a label before saving it.');
      return;
    }
    const next = addPreset(presets, preset);
    setPresets(next);
    await saveJourneyPresets(next);
    appAlert('Trip saved', `"${preset.label}" is now one tap away.`);
  }, [contactId, label, minutes, presets]);

  const forgetPreset = useCallback(
    async (p: JourneyPreset) => {
      const next = removePreset(presets, p.id);
      setPresets(next);
      await saveJourneyPresets(next);
      appAlert('Trip removed', `"${p.label}" is no longer saved.`);
    },
    [presets],
  );

  const handleStart = () => {
    if (!label.trim()) {
      appAlert('Pick a label', 'Tell us what this journey is.');
      return;
    }
    const etaMs = Date.now() + minutes * 60_000;

    // THE LOCAL GUARD STARTS FIRST, AND IS AUTHORITATIVE.
    //
    // This dispatch is what arms the countdown that fires an SOS if the ETA
    // lapses, and it needs no network at all. Everything below it is about
    // telling other people, and none of it is allowed to delay or block this.
    // A woman walking home through a dead spot must not lose her safety net
    // because a write failed.
    dispatch(
      safeJourneyStarted({
        label: label.trim(),
        etaMs,
        trustedContactId: contactId,
      }),
    );
    navigation.replace('SafeJourneyActive');

    // TELL THE CIRCLE. Not awaited, on purpose: see above.
    //
    // Until this existed the loop broke here. Her phone knew she was on the
    // way and her circle knew nothing, which made "my trusted people know" a
    // step the product claimed and did not perform.
    void (async () => {
      try {
        if (!circleId) return;
        const tripId = await startSafeJourney({
          circleId,
          label: label.trim(),
          kind: 'custom',
          etaMs,
        });
        if (tripId) dispatch(safeJourneyLinked(tripId));
        // A journey with nobody able to see where she is tells her circle a
        // destination and an ETA and nothing else, so sharing is armed for
        // slightly longer than the journey itself: arriving four minutes late
        // should not be the moment her pin goes dark.
        //
        // This is the ONE position pipeline. The journey row carries no
        // coordinates of its own (sql/139), so precision, freshness and
        // `unreachable` keep being decided in the one place that already gets
        // them right.
        if (!(await isCircleSharing())) {
          await startCircleSharing(Math.max(0.5, minutes / 60 + 0.25));
        }
      } catch {
        // Silent. The journey is running and the guard is armed; a failed
        // announcement is not something to interrupt her with as she leaves.
      }
    })();
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

        {presets.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>SAVED TRIPS</Text>
            <View style={styles.chipRow}>
              {presets.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => applyPreset(p)}
                  onLongPress={() => void forgetPreset(p)}
                  delayLongPress={600}
                  style={styles.preset}
                  accessibilityRole="button"
                  accessibilityLabel={`Use saved trip ${p.label}, ${p.minutes} minutes. Long press to remove.`}
                >
                  <Ionicons name="bookmark" size={13} color={colors.primary} />
                  <Text style={styles.presetText} numberOfLines={1}>
                    {p.label}
                  </Text>
                  <Text style={styles.presetMeta}>
                    {p.minutes < 60 ? `${p.minutes}m` : `${Math.round((p.minutes / 60) * 10) / 10}h`}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.presetHint}>Tap to fill this in. Hold to remove.</Text>
          </>
        ) : null}

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

        <Pressable
          onPress={() => void saveCurrent()}
          style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel="Save this trip for next time"
        >
          <Ionicons name="bookmark-outline" size={16} color={colors.textPrimary} />
          <Text style={styles.saveText}>Save this trip for next time</Text>
        </Pressable>

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
  preset: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.circle,
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  presetText: {
    ...typography.bodyMedium,
    fontSize: 14,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  presetMeta: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12,
    color: colors.textMuted,
  },
  presetHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
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
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: spacing.lg,
    paddingVertical: 14,
    borderRadius: radius.circle,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  saveText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14,
    color: colors.textPrimary,
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
