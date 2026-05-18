import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/common';
import { useAppDispatch } from '@/redux/store';
import {
  createCircle,
  CirclesNotInstalledError,
  type CircleKind,
} from '@/services/circles';
import { circleAdded } from '@/redux/slices/circlesSlice';
import { setActiveCircle } from '@/services/circles-bootstrap';
import {
  colors,
  fontFamilies,
  radius,
  spacing,
  typography,
} from '@/theme';
import type { AppScreenProps } from '@/navigation/types';

// New-circle wizard. Pick a kind (which seeds an icon + colour), pick a
// name, optional emoji, optionally mark as default. Server returns the
// created Circle which we dispatch into the slice immediately so the
// CirclesScreen list updates without a refetch.

const KIND_OPTIONS: Array<{
  kind: CircleKind;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  color: string;
  hint: string;
}> = [
  { kind: 'family', icon: 'home', label: 'Family', color: '#57C691', hint: 'Parents, siblings, partner.' },
  { kind: 'friends', icon: 'people', label: 'Friends', color: '#3FB9A1', hint: 'Your closest friend group.' },
  { kind: 'trip', icon: 'airplane', label: 'Trip', color: '#5BA9E6', hint: 'A single journey or vacation.' },
  { kind: 'college', icon: 'school', label: 'College', color: '#9A7CF5', hint: 'Hostel, classmates, batchmates.' },
  { kind: 'women', icon: 'female', label: 'Women', color: '#E07AB6', hint: 'Women-only safety circle.' },
  { kind: 'emergency', icon: 'alert-circle', label: 'Emergency', color: '#FF4D4D', hint: 'People who should be alerted in a real SOS.' },
  { kind: 'general', icon: 'people-circle', label: 'General', color: '#6B7280', hint: 'Any other trusted group.' },
];

export function CircleCreateScreen({
  navigation,
}: AppScreenProps<'CircleCreate'>) {
  const dispatch = useAppDispatch();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [kind, setKind] = useState<CircleKind>('family');
  const [isDefault, setIsDefault] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selected = KIND_OPTIONS.find((o) => o.kind === kind)!;

  const submit = async () => {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    try {
      const circle = await createCircle({
        name,
        kind,
        color: selected.color,
        emoji: emoji.trim() || null,
        isDefault,
      });
      dispatch(circleAdded(circle));
      await setActiveCircle(circle.id);
      navigation.replace('CircleDetail', { circleId: circle.id });
    } catch (err) {
      if (err instanceof CirclesNotInstalledError) {
        Alert.alert(
          'Backend setup needed',
          'The circles tables are not installed on your Supabase project yet. Open Supabase → SQL Editor → paste the contents of sql/09_circles.sql → Run. Then try again.',
        );
      } else {
        Alert.alert(
          'Could not create circle',
          err instanceof Error ? err.message : 'Try again in a moment.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={styles.backBtn}
            accessibilityRole="button"
          >
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>New circle</Text>
          <View style={{ width: 40 }} />
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.sectionLabel}>Type</Text>
            <View style={styles.kindGrid}>
              {KIND_OPTIONS.map((opt) => {
                const active = opt.kind === kind;
                return (
                  <Pressable
                    key={opt.kind}
                    onPress={() => setKind(opt.kind)}
                    style={[
                      styles.kindChip,
                      active && {
                        borderColor: opt.color,
                        backgroundColor: tint(opt.color, 0.12),
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={opt.label}
                  >
                    <View
                      style={[
                        styles.kindIcon,
                        { backgroundColor: tint(opt.color, 0.16) },
                      ]}
                    >
                      <Ionicons name={opt.icon} size={18} color={opt.color} />
                    </View>
                    <Text style={styles.kindLabel}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
              Name
            </Text>
            <Text style={styles.hint}>{selected.hint}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Sharma Family, College Roomies…"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              autoFocus
              maxLength={48}
              returnKeyType="next"
            />

            <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
              Emoji (optional)
            </Text>
            <TextInput
              value={emoji}
              onChangeText={(v) =>
                // Keep at most one visible char so the icon stays tidy.
                setEmoji(Array.from(v).slice(0, 1).join(''))
              }
              placeholder="🏠"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { width: 80 }]}
              maxLength={4}
            />

            <Pressable
              onPress={() => setIsDefault((v) => !v)}
              style={styles.defaultRow}
              accessibilityRole="switch"
              accessibilityState={{ checked: isDefault }}
            >
              <View
                style={[
                  styles.checkbox,
                  isDefault && {
                    borderColor: colors.brandDeep,
                    backgroundColor: colors.brandDeep,
                  },
                ]}
              >
                {isDefault ? (
                  <Ionicons name="checkmark" size={14} color={colors.textInverse} />
                ) : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.defaultTitle}>Make this my default circle</Text>
                <Text style={styles.defaultBody}>
                  Used on Home until you switch to another circle.
                </Text>
              </View>
            </Pressable>
          </ScrollView>

          <View style={styles.footer}>
            <Button
              label={submitting ? 'Creating…' : 'Create circle'}
              onPress={submit}
              disabled={!name.trim() || submitting}
              loading={submitting}
            />
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  body: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  sectionLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  kindGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  kindChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.circle,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  kindIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kindLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12.5,
    color: colors.textPrimary,
  },
  hint: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  input: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  defaultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  defaultTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13.5,
    color: colors.textPrimary,
  },
  defaultBody: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  footer: {
    padding: spacing.md,
    paddingBottom: spacing.lg,
  },
});
