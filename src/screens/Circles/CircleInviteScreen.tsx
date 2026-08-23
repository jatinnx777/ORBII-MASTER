import React, { useCallback, useEffect, useRef, useState } from 'react';
import { appAlert } from '@/components/common';
import {
  ActivityIndicator,
  Image,
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
import { useAppSelector } from '@/redux/store';
import { inviteByPhone, inviteByUsername } from '@/services/circles';
import { findUserByPhone, searchUsers, type PublicUser } from '@/services/users-public';
import { isValidIndianPhone, toE164India } from '@/utils/validation';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '@/theme';
import type { AppScreenProps } from '@/navigation/types';

// Phone-number-first circle invite.
//
//   • You type a +91 mobile number.
//   • We look it up in users_public (debounced). If the number belongs to
//     a registered ORBII user, their profile card surfaces with a single
//     "Send invite" CTA, the invite is tied to their account so they get
//     pulled into the circle the moment they accept.
//   • If the number ISN'T registered, we fall back to a shareable join
//     link (orbii://join/<token>) the inviter can drop into WhatsApp/SMS.
//     The invitee installs ORBII, taps the link, and lands in the circle
//     once they sign in.
//
// Why phone-first (vs. username): users know each other's phone numbers
// instinctively; usernames take cognitive effort. Phone match guarantees
// the invitee has a real ORBII account so location sharing kicks in the
// moment they accept.

const DEBOUNCE_MS = 250;

export function CircleInviteScreen({
  route,
  navigation,
}: AppScreenProps<'CircleInvite'>) {
  const { circleId } = route.params;
  const circle = useAppSelector((s) =>
    s.circles.circles.find((c) => c.id === circleId),
  );
  const myUid = useAppSelector((s) => s.user.profile?.uid ?? null);

  const [phoneInput, setPhoneInput] = useState('');
  const [match, setMatch] = useState<PublicUser | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState<'match' | 'share' | null>(null);

  // Directory search by name / username, so people who signed up with EMAIL
  // (no phone) can still be found and added.
  const [nameQuery, setNameQuery] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [searchingName, setSearchingName] = useState(false);
  const nameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const phoneDigits = phoneInput.replace(/\D/g, '').slice(0, 10);
  const phoneValid = isValidIndianPhone(phoneDigits);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!myUid || !phoneValid) {
      setMatch(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const e164 = toE164India(phoneDigits);
      const found = await findUserByPhone(e164, myUid);
      setMatch(found);
      setSearching(false);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [phoneDigits, phoneValid, myUid]);

  // Debounced directory search by name or username.
  useEffect(() => {
    if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current);
    const q = nameQuery.trim();
    if (!myUid || q.length < 2) {
      setResults([]);
      setSearchingName(false);
      return;
    }
    setSearchingName(true);
    nameDebounceRef.current = setTimeout(async () => {
      const r = await searchUsers({ query: q, excludeUid: myUid });
      setResults(r);
      setSearchingName(false);
    }, DEBOUNCE_MS);
    return () => {
      if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current);
    };
  }, [nameQuery, myUid]);

  const inviteUser = useCallback(
    async (user: PublicUser) => {
      if (!user.username || submitting) return;
      setSubmitting('match');
      try {
        await inviteByUsername(circleId, user.username);
        appAlert(
          'Invite sent',
          `${user.name?.trim() || `@${user.username}`} will see your invite the next time they open ORBII. They'll start sharing their location with the circle as soon as they accept.`,
          [{ text: 'Done', onPress: () => navigation.goBack() }],
        );
      } catch (err) {
        appAlert(
          'Could not send invite',
          err instanceof Error ? err.message : 'Try again.',
        );
      } finally {
        setSubmitting(null);
      }
    },
    [submitting, circleId, navigation],
  );

  const inviteRegistered = useCallback(() => {
    if (match) void inviteUser(match);
  }, [match, inviteUser]);

  const sharePhoneLink = useCallback(async () => {
    if (!phoneValid || submitting) return;
    setSubmitting('share');
    try {
      const e164 = toE164India(phoneDigits);
      const invite = await inviteByPhone(circleId, e164);
      const link = `https://www.orbii.in/join/${invite.token}`;
      try {
        const { Share } = await import('react-native');
        await Share.share({
          message: `Join my ORBII safety circle "${circle?.name ?? ''}". Tap to accept and share your live location: ${link}`,
        });
      } catch {
        // Share sheet dismissed, invite is still saved server-side.
      }
      navigation.goBack();
    } catch (err) {
      appAlert(
        'Could not create invite link',
        err instanceof Error ? err.message : 'Try again.',
      );
    } finally {
      setSubmitting(null);
    }
  }, [phoneValid, phoneDigits, submitting, circleId, circle?.name, navigation]);

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
          <Text style={styles.headerTitle}>Add to circle</Text>
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
            {circle ? (
              <Text style={styles.subhead}>
                Adding to{' '}
                <Text style={styles.subheadAccent}>{circle.name}</Text>
              </Text>
            ) : null}

            {/* Search the ORBII directory, finds email signups too. */}
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>Search people on ORBII</Text>
              <Text style={styles.hint}>
                Find anyone on ORBII by name or username, including friends who signed up with email.
              </Text>
              <View style={styles.inputRow}>
                <Ionicons name="search" size={16} color={colors.brandDeep} />
                <TextInput
                  value={nameQuery}
                  onChangeText={setNameQuery}
                  placeholder="Name or @username"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                />
                {searchingName ? (
                  <ActivityIndicator size="small" color={colors.brandDeep} />
                ) : null}
              </View>
              {results.map((u) => (
                <View key={u.id} style={styles.matchCard}>
                  <View style={styles.matchAvatar}>
                    {u.photoUri ? (
                      <Image source={{ uri: u.photoUri }} style={styles.matchAvatarImg} />
                    ) : (
                      <Text style={styles.matchAvatarInitial}>
                        {(u.name?.charAt(0) ?? u.username.charAt(0)).toUpperCase()}
                      </Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.matchName} numberOfLines={1}>
                      {u.name?.trim() || `@${u.username}`}
                    </Text>
                    <Text style={styles.matchHandle} numberOfLines={1}>@{u.username}</Text>
                  </View>
                  <Pressable
                    onPress={() => inviteUser(u)}
                    disabled={submitting !== null}
                    style={({ pressed }) => [
                      styles.matchInviteBtn,
                      submitting !== null && { opacity: 0.7 },
                      pressed && styles.pressedScale,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Invite ${u.name ?? u.username}`}
                  >
                    <Ionicons name="person-add" size={14} color={colors.textInverse} />
                    <Text style={styles.matchInviteText}>Invite</Text>
                  </Pressable>
                </View>
              ))}
              {nameQuery.trim().length >= 2 && !searchingName && results.length === 0 ? (
                <Text style={styles.emptyHint}>
                  No one found. Try their exact @username, or invite by phone below.
                </Text>
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionLabel}>Or invite by phone number</Text>
              <Text style={styles.hint}>
                The person you invite must have an ORBII account. Once they
                accept, their live location starts sharing with the circle.
              </Text>
              <View style={styles.inputRow}>
                <Text style={styles.atPrefix}>+91</Text>
                <TextInput
                  value={phoneInput}
                  onChangeText={(v) =>
                    setPhoneInput(v.replace(/\D/g, '').slice(0, 10))
                  }
                  placeholder="10-digit mobile number"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  style={styles.input}
                  maxLength={10}
                  autoFocus
                />
                {searching ? (
                  <ActivityIndicator size="small" color={colors.brandDeep} />
                ) : null}
              </View>

              {!phoneValid ? (
                <Text style={styles.emptyHint}>
                  Enter a valid 10-digit Indian mobile number.
                </Text>
              ) : !myUid ? (
                <Text style={styles.emptyHint}>
                  Sign in with Google to search ORBII users.
                </Text>
              ) : match ? (
                <View style={styles.matchCard}>
                  <View style={styles.matchAvatar}>
                    {match.photoUri ? (
                      <Image
                        source={{ uri: match.photoUri }}
                        style={styles.matchAvatarImg}
                      />
                    ) : (
                      <Text style={styles.matchAvatarInitial}>
                        {(match.name?.charAt(0) ?? match.username.charAt(0)).toUpperCase()}
                      </Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.matchTitleRow}>
                      <Text style={styles.matchName} numberOfLines={1}>
                        {match.name?.trim() || `@${match.username}`}
                      </Text>
                      <View style={styles.verifiedDot}>
                        <Ionicons
                          name="checkmark-circle"
                          size={14}
                          color={colors.brandDeep}
                        />
                      </View>
                    </View>
                    <Text style={styles.matchHandle} numberOfLines={1}>
                      Registered on ORBII · @{match.username}
                    </Text>
                  </View>
                  <Pressable
                    onPress={inviteRegistered}
                    style={({ pressed }) => [
                      styles.matchInviteBtn,
                      submitting === 'match' && { opacity: 0.7 },
                      pressed && styles.pressedScale,
                    ]}
                    disabled={submitting !== null}
                    accessibilityRole="button"
                    accessibilityLabel="Send invite"
                  >
                    {submitting === 'match' ? (
                      <ActivityIndicator size="small" color={colors.textInverse} />
                    ) : (
                      <>
                        <Ionicons name="person-add" size={14} color={colors.textInverse} />
                        <Text style={styles.matchInviteText}>Invite</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              ) : !searching ? (
                <View style={styles.noMatchCard}>
                  <View style={styles.noMatchIcon}>
                    <Ionicons
                      name="information-circle"
                      size={18}
                      color={colors.brandDeep}
                    />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.noMatchTitle}>
                      Not on ORBII yet
                    </Text>
                    <Text style={styles.noMatchBody}>
                      Share an invite link via WhatsApp or SMS, and they'll join
                      the circle as soon as they install ORBII and tap the link.
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>

            {phoneValid && !match && !searching ? (
              <Pressable
                onPress={sharePhoneLink}
                disabled={submitting !== null}
                style={({ pressed }) => [
                  styles.shareCta,
                  submitting === 'share' && { opacity: 0.7 },
                  pressed && styles.pressedScale,
                ]}
                accessibilityRole="button"
              >
                <Ionicons
                  name="share-social-outline"
                  size={18}
                  color={colors.brandDeep}
                />
                <Text style={styles.shareCtaText}>
                  {submitting === 'share' ? 'Creating link…' : 'Share invite link'}
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
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
    backgroundColor: colors.surface,
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
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  subhead: {
    ...typography.body,
    fontSize: 13.5,
    color: colors.textSecondary,
  },
  subheadAccent: {
    fontFamily: fontFamilies.poppinsBold,
    color: colors.brandDeep,
  },
  card: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: spacing.sm,
    ...shadows.card,
  },
  sectionLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: colors.textMuted,
    letterSpacing: 0.1,
  },
  hint: {
    ...typography.caption,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.brandSoft,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.brandMid,
  },
  atPrefix: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: colors.brandDeep,
  },
  input: {
    flex: 1,
    fontFamily: fontFamilies.interMedium,
    fontSize: 15,
    color: colors.textPrimary,
    paddingVertical: 12,
  },
  emptyHint: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 12.5,
    color: colors.textSecondary,
    paddingHorizontal: 4,
    paddingTop: 4,
  },
  matchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.brandMid,
  },
  matchAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  matchAvatarImg: { width: '100%', height: '100%' },
  matchAvatarInitial: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: colors.brandDeep,
  },
  matchTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  matchName: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  verifiedDot: {},
  matchHandle: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 11.5,
    color: colors.textSecondary,
    marginTop: 1,
  },
  matchInviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.circle,
    backgroundColor: colors.brandDeep,
    minWidth: 78,
    justifyContent: 'center',
  },
  matchInviteText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 12,
    color: colors.textInverse,
    letterSpacing: 0.3,
  },
  noMatchCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.brandMid,
  },
  noMatchIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noMatchTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  noMatchBody: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 11.5,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  shareCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.brandMid,
  },
  shareCtaText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13.5,
    color: colors.brandDeep,
    letterSpacing: 0.2,
  },
  pressedScale: {
    opacity: 0.92,
    transform: [{ scale: 0.98 }],
  },
});
