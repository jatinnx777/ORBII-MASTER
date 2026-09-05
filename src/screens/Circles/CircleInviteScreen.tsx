import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { appAlert } from '@/components/common';
import { useAppSelector } from '@/redux/store';
import { rotateJoinCode } from '@/services/circles';
import { refreshCircles } from '@/services/circles-bootstrap';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import type { AppScreenProps } from '@/navigation/types';

/**
 * Invite by code. Read six letters out, they type them, they are in.
 *
 * WHAT THIS REPLACED, and why it is gone rather than improved. The old screen
 * searched a directory: type a phone number or a name, get a list of matching
 * ORBII accounts, tap to invite. Every safeguard on it (exact match only, the
 * number never returned, rate limits, a SECURITY DEFINER wrapper so the table
 * itself stayed unreadable) was a mitigation of a hole that did not have to
 * exist.
 *
 * Because the thing being protected was a searchable index of women who
 * installed a personal safety app. There is no version of that which is safe
 * to own, and the mitigations only ever reduced how badly it could go.
 *
 * A code inverts it completely. Nothing is looked up. Nothing is enumerable.
 * The person joining has to have been told six letters by somebody who already
 * has them, which is the same decision the circle owner was making anyway,
 * without an index underneath it.
 *
 * The letters skip I, O, Q and S. This gets read across a room and written on
 * the back of a receipt, and I/1, O/0, S/5 is where that goes wrong.
 */

export function CircleInviteScreen({ route, navigation }: AppScreenProps<'CircleInvite'>) {
  const { circleId } = route.params;
  const circle = useAppSelector((s) => s.circles.circles.find((c) => c.id === circleId));
  const [rolling, setRolling] = useState(false);
  const [copied, setCopied] = useState(false);

  const code = circle?.joinCode ?? null;

  // Split for reading, joined for copying. Three and three is how people say a
  // six letter code out loud, and a single run of six invites a misread.
  const spaced = useMemo(() => (code ? `${code.slice(0, 3)} ${code.slice(3)}` : ''), [code]);

  const copy = useCallback(async () => {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [code]);

  const share = useCallback(async () => {
    if (!code) return;
    // No deep link. A tappable link opens ORBII and joins with one tap, and it
    // also means a code forwarded into a group chat can be joined by anyone
    // who scrolls past it. Six letters that have to be typed is slower on
    // purpose: it takes a decision, not a tap.
    await Share.share({
      message:
        `Join my ORBII circle${circle?.name ? ` "${circle.name}"` : ''}.\n\n` +
        `Open ORBII, go to Circles, tap Join, and enter this code:\n\n${code}`,
    }).catch(() => undefined);
  }, [code, circle?.name]);

  const roll = useCallback(() => {
    appAlert(
      'Get a new code?',
      'The current code stops working straight away. Anyone you already gave it to will not be able to join with it, and people already in the circle are unaffected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'New code',
          style: 'destructive',
          onPress: () => {
            setRolling(true);
            void rotateJoinCode(circleId)
              .then(() => refreshCircles())
              .catch((e: unknown) =>
                appAlert('Could not change the code', e instanceof Error ? e.message : 'Try again.'),
              )
              .finally(() => setRolling(false));
          },
        },
      ],
    );
  }, [circleId]);

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={s.back}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={s.headerTitle} numberOfLines={1}>
          {circle?.name ?? 'Invite'}
        </Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>Give them this code</Text>
        <Text style={s.blurb}>
          They open ORBII, go to Circles, tap Join, and type it in. A circle holds four people.
        </Text>

        <Pressable
          onPress={copy}
          style={({ pressed }) => [s.codeCard, pressed && { transform: [{ scale: 0.99 }] }]}
          accessibilityRole="button"
          accessibilityLabel={
            code ? `Join code ${code.split('').join(' ')}. Tap to copy.` : 'Loading code'
          }
        >
          {code ? (
            <>
              <Text style={s.code}>{spaced}</Text>
              <View style={s.copyRow}>
                <Ionicons
                  name={copied ? 'checkmark' : 'copy-outline'}
                  size={13}
                  color={copied ? colors.sageDeep : colors.textSecondary}
                />
                <Text style={[s.copyText, copied && { color: colors.sageDeep }]}>
                  {copied ? 'Copied' : 'Tap to copy'}
                </Text>
              </View>
            </>
          ) : (
            <ActivityIndicator color={colors.brandDeep} />
          )}
        </Pressable>

        <Pressable
          onPress={share}
          disabled={!code}
          style={({ pressed }) => [s.cta, !code && s.ctaOff, pressed && { transform: [{ scale: 0.98 }] }]}
        >
          <Ionicons name="share-outline" size={18} color={colors.textInverse} />
          <Text style={s.ctaText}>Share the code</Text>
        </Pressable>

        <Pressable onPress={roll} disabled={!code || rolling} style={s.roll}>
          {rolling ? (
            <ActivityIndicator color={colors.textSecondary} />
          ) : (
            <>
              <Ionicons name="refresh" size={15} color={colors.textSecondary} />
              <Text style={s.rollText}>Get a new code</Text>
            </>
          )}
        </Pressable>

        <View style={s.note}>
          <Ionicons name="lock-closed-outline" size={15} color={colors.textMuted} />
          <Text style={s.noteText}>
            ORBII has no people search. Nobody can find you by name or number, and there is no
            directory to look you up in. A code is the only way into a circle, and you decide who
            has it.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  back: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 16,
    color: colors.textPrimary,
  },

  scroll: { padding: spacing.lg, gap: spacing.md },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 26,
    letterSpacing: -0.6,
    color: colors.textPrimary,
  },
  blurb: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 14.5,
    lineHeight: 21,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },

  codeCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  code: {
    fontFamily: fontFamilies.poppinsBold,
    // Large, wide-tracked and tabular. This number gets read aloud across a
    // room, so legibility beats elegance.
    fontSize: 38,
    letterSpacing: 6,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  copyRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  copyText: { fontFamily: fontFamilies.interMedium, fontSize: 12.5, color: colors.textSecondary },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 54,
    borderRadius: radius.pill,
    backgroundColor: colors.brandDeep,
  },
  ctaOff: { backgroundColor: colors.creamDeep },
  ctaText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 16, color: colors.textInverse },

  roll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
  },
  rollText: { fontFamily: fontFamilies.interMedium, fontSize: 14, color: colors.textSecondary },

  note: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.creamDeep,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  noteText: {
    flex: 1,
    fontFamily: fontFamilies.interRegular,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textSecondary,
  },
});

export default CircleInviteScreen;
