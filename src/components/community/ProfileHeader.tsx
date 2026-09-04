import React, { useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, fontFamilies, radius, spacing } from '@/theme';
import { avatarEmoji, type PublicProfile } from '@/services/community-feed';

/**
 * The profile header, laid out the way X lays one out.
 *
 * WHY THIS SHAPE AND NOT THE CENTRED ONE IT REPLACES. A centred column of
 * avatar, name, handle, three stat blocks and a button is the layout every
 * template ships with, and it wastes the top third of the screen on furniture
 * before a single post. The left-aligned version reads faster because the eye
 * has one column to follow, and it earns its vertical space back: the same
 * information fits in roughly half the height, so a post is visible without
 * scrolling.
 *
 * Two details do most of the work:
 *
 *  - THE AVATAR OVERLAPS THE BANNER and carries a ring in the page colour. That
 *    single overlap is what makes the header read as one object rather than as
 *    a coloured strip with a circle underneath it.
 *  - STATS ARE A SENTENCE, not three cards. "12 Following · 30 Followers" is
 *    read in one pass; three bordered boxes ask the eye to stop three times for
 *    numbers nobody came here for.
 */

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

const GENDER_LABEL: Record<string, string> = {
  female: 'Female',
  male: 'Male',
  nonbinary: 'Non-binary',
  undisclosed: '',
};

export function ProfileHeader({
  profile,
  onToggleFollow,
  isMe,
}: {
  profile: PublicProfile;
  onToggleFollow: () => void;
  isMe?: boolean;
}) {
  const press = useRef(new Animated.Value(0)).current;
  const setPressed = (down: boolean) =>
    Animated.timing(press, {
      toValue: down ? 1 : 0,
      duration: 120,
      easing: EASE_OUT,
      useNativeDriver: true,
    }).start();

  return (
    <View>
      <View style={s.banner} />

      <View style={s.row}>
        <View style={s.avatarRing}>
          <View style={s.avatar}>
            <Text style={s.avatarEmoji}>{avatarEmoji(profile.avatarKey)}</Text>
          </View>
        </View>

        {!isMe ? (
          <Animated.View
            style={{
              transform: [
                { scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] }) },
              ],
            }}
          >
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
                onToggleFollow();
              }}
              onPressIn={() => setPressed(true)}
              onPressOut={() => setPressed(false)}
              pressRetentionOffset={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              style={[s.follow, profile.isFollowing && s.following]}
            >
              <Text style={[s.followText, profile.isFollowing && s.followingText]}>
                {profile.isFollowing ? 'Following' : 'Follow'}
              </Text>
            </Pressable>
          </Animated.View>
        ) : null}
      </View>

      <View style={s.meta}>
        <Text style={s.name}>{profile.displayName}</Text>
        <Text style={s.handle}>@{profile.handle}</Text>

        {profile.bio ? <Text style={s.bio}>{profile.bio}</Text> : null}

        <View style={s.chips}>
          {GENDER_LABEL[profile.gender] ? (
            <View style={s.chip}>
              <Text style={s.chipText}>{GENDER_LABEL[profile.gender]}</Text>
            </View>
          ) : null}
          {profile.helped > 0 ? (
            <View style={[s.chip, s.chipHelped]}>
              <Text style={[s.chipText, { color: colors.sageDeep }]}>
                {profile.helped} {profile.helped === 1 ? 'person' : 'people'} helped
              </Text>
            </View>
          ) : null}
        </View>

        {/* One line, read in one pass. */}
        <Text style={s.counts}>
          <Text style={s.countNum}>{profile.following}</Text>
          <Text style={s.countLbl}> Following </Text>
          <Text style={s.countDot}>·</Text>
          <Text style={s.countNum}> {profile.followers}</Text>
          <Text style={s.countLbl}> Followers</Text>
        </Text>
      </View>
    </View>
  );
}

const AVATAR = 76;
const RING = 4;

const s = StyleSheet.create({
  banner: { height: 96, backgroundColor: colors.lavenderSoft },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    // Pulls the avatar up over the banner. The overlap is the whole trick.
    marginTop: -(AVATAR / 2 + RING),
    marginBottom: spacing.sm,
  },
  avatarRing: {
    width: AVATAR + RING * 2,
    height: AVATAR + RING * 2,
    borderRadius: (AVATAR + RING * 2) / 2,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: colors.creamDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: { fontSize: 36 },

  follow: {
    height: 38,
    minWidth: 104,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  following: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  followText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14.5,
    color: colors.textInverse,
  },
  followingText: { color: colors.textPrimary },

  meta: { paddingHorizontal: spacing.lg, gap: 2 },
  name: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 21,
    letterSpacing: -0.4,
    color: colors.textPrimary,
  },
  handle: { fontFamily: fontFamilies.interRegular, fontSize: 14.5, color: colors.textMuted },
  bio: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.creamDeep,
  },
  chipHelped: { backgroundColor: colors.sageSoft },
  chipText: { fontFamily: fontFamilies.interRegular, fontSize: 12.5, color: colors.textSecondary },

  counts: { marginTop: spacing.sm, marginBottom: spacing.md },
  countNum: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14.5, color: colors.textPrimary },
  countLbl: { fontFamily: fontFamilies.interRegular, fontSize: 14.5, color: colors.textMuted },
  countDot: { color: colors.textMuted, fontSize: 14.5 },
});
