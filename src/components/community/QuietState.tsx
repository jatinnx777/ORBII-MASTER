import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radius, spacing } from '@/theme';

/**
 * What the Community tab shows when nobody has posted.
 *
 * THE PROBLEM THIS SOLVES, and it is a real one. A social feed with nothing in
 * it reads as an abandoned app, and the reflex fix is to fill it with invented
 * accounts. That reflex is wrong here for a reason specific to this product:
 * the content in this feed is about which places and situations are dangerous,
 * and a woman would act on it. Inventing that is not growth, it is telling
 * somebody a street is fine when nobody has ever walked it.
 *
 * The honest fix is that an empty feed should not be the first thing she sees.
 * ORBII has fifty-nine published guides. Somebody arriving from Instagram or
 * Reddit lands on something worth reading, the app is useful on day one with
 * zero posts in it, and the feed grows underneath as real people arrive.
 *
 * This is not an apology for the emptiness. There is no "be the first to post"
 * line, because nobody has ever been persuaded by one. It is simply the most
 * useful thing available in that space until the space fills.
 */

const BASE = 'https://orbii.in/blog/';

type Guide = { slug: string; title: string; blurb: string; icon: React.ComponentProps<typeof Ionicons>['name']; tint: string };

// Every one of these is published and checked. Ordered by how likely somebody
// is to need it tonight, not by how well it reads.
const GUIDES: Guide[] = [
  {
    slug: 'what-to-do-if-being-followed-india',
    title: 'If you think you are being followed',
    blurb: 'What to do in the first sixty seconds, and what not to do.',
    icon: 'walk',
    tint: colors.coralDeep,
  },
  {
    slug: 'safely-exit-cab-or-uber-if-unsafe',
    title: 'Getting out of a cab that feels wrong',
    blurb: 'How to end the ride without escalating it.',
    icon: 'car',
    tint: colors.goldDeep,
  },
  {
    slug: 'what-to-do-if-you-feel-unsafe-walking-at-night',
    title: 'Walking home at night',
    blurb: 'The things that actually help, and the ones that only feel like they do.',
    icon: 'moon',
    tint: colors.lavenderDeep,
  },
  {
    slug: 'late-night-campus-safety-students-metro-cities',
    title: 'Late nights on campus',
    blurb: 'Hostels, gates, and the walk between them.',
    icon: 'school',
    tint: colors.sageDeep,
  },
  {
    slug: 'night-shift-safety-it-bpo-healthcare-workers',
    title: 'Night shifts',
    blurb: 'Cabs, pickups and the commute nobody else is awake for.',
    icon: 'business',
    tint: colors.brandDeep,
  },
  {
    slug: 'personal-safety-checklist-every-woman-should-have',
    title: 'The checklist',
    blurb: 'Ten minutes now that you will not have to think about later.',
    icon: 'checkbox',
    tint: colors.sageDeep,
  },
];

export function QuietState({ mine }: { mine?: boolean }) {
  const open = (slug: string) => {
    Linking.openURL(BASE + slug).catch(() => undefined);
  };

  return (
    <View style={s.wrap}>
      <Text style={s.kicker}>{mine ? 'YOU HAVE NOT POSTED YET' : 'WHILE IT IS QUIET'}</Text>
      <Text style={s.title}>
        {mine ? 'Anything you post shows up here' : 'Worth reading before you need it'}
      </Text>

      <View style={s.list}>
        {GUIDES.map((g) => (
          <Pressable
            key={g.slug}
            onPress={() => open(g.slug)}
            accessibilityRole="link"
            style={({ pressed }) => [s.card, pressed && s.pressed]}
          >
            <View style={[s.icon, { backgroundColor: g.tint + '1A' }]}>
              <Ionicons name={g.icon} size={19} color={g.tint} />
            </View>
            <View style={s.text}>
              <Text style={s.cardTitle}>{g.title}</Text>
              <Text style={s.cardBlurb}>{g.blurb}</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
          </Pressable>
        ))}
      </View>

      <Text style={s.foot}>
        Written by us, on orbii.in. Fifty-nine more there.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  kicker: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 10.5,
    letterSpacing: 1.2,
    color: colors.textMuted,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 21,
    letterSpacing: -0.4,
    color: colors.textPrimary,
    marginTop: 6,
  },
  list: { marginTop: spacing.lg, gap: spacing.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  pressed: { opacity: 0.9 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  cardTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  cardBlurb: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 12.5,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  foot: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
