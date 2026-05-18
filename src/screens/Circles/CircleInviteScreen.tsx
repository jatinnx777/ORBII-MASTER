import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/common';
import { useAppSelector } from '@/redux/store';
import { inviteByPhone, inviteByUsername } from '@/services/circles';
import { searchUsers, type PublicUser } from '@/services/users-public';
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

// Invite-to-circle screen. Two complementary paths:
//   • Username search — live debounced query against users_public. Only
//     surfaces real Supabase-backed users (Google sign-ins today; phone
//     sign-ins land here too once the OTP gateway is wired). Tap a result
//     to send the invite instantly.
//   • Phone — pre-creates a pending invite by E.164 and pops the native
//     Share sheet with an orbii://join/<token> deep link the inviter can
//     drop into WhatsApp / SMS. The receiver opens that link inside ORBII
//     and gets auto-added (handler in App.tsx).

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

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.replace(/^@/, '').trim();
    if (!myUid || q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const matches = await searchUsers({ query: q, excludeUid: myUid });
      setResults(matches);
      setSearching(false);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, myUid]);

  const sendUsername = useCallback(
    async (username: string) => {
      if (!username || submitting) return;
      setSubmitting(username);
      try {
        await inviteByUsername(circleId, username);
        Alert.alert(
          'Invite sent',
          `@${username} will see your invite the next time they open ORBII.`,
          [{ text: 'OK', onPress: () => navigation.goBack() }],
        );
      } catch (err) {
        Alert.alert(
          'Could not send invite',
          err instanceof Error ? err.message : 'Try again.',
        );
      } finally {
        setSubmitting(null);
      }
    },
    [circleId, navigation, submitting],
  );

  const sendPhone = useCallback(async () => {
    if (!isValidIndianPhone(phone) || submitting) return;
    setSubmitting('phone');
    try {
      const e164 = toE164India(phone);
      const invite = await inviteByPhone(circleId, e164);
      const link = `https://orbii.app/join/${invite.token}`;
      try {
        await Share.share({
          message: `Join my ORBII safety circle "${circle?.name ?? ''}": ${link}`,
        });
      } catch {
        // Share sheet dismissed — invite is still pending server-side.
      }
      setPhone('');
      navigation.goBack();
    } catch (err) {
      Alert.alert(
        'Could not send invite',
        err instanceof Error ? err.message : 'Try again.',
      );
    } finally {
      setSubmitting(null);
    }
  }, [phone, submitting, circleId, circle?.name, navigation]);

  const showSearchResults = query.replace(/^@/, '').trim().length >= 2;

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
          <Text style={styles.headerTitle}>Invite to circle</Text>
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
              <Text style={styles.subhead} numberOfLines={1}>
                Adding to <Text style={styles.subheadAccent}>{circle.name}</Text>
              </Text>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.sectionLabel}>Search someone on ORBII</Text>
              <Text style={styles.hint}>
                Type a username or name. Real ORBII users only.
              </Text>
              <View style={styles.inputRow}>
                <Ionicons
                  name="search"
                  size={16}
                  color={colors.textMuted}
                  style={{ marginLeft: 4 }}
                />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search by name or @username"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                  maxLength={48}
                />
                {searching ? (
                  <ActivityIndicator size="small" color={colors.brandDeep} />
                ) : null}
              </View>

              {!showSearchResults ? null : !myUid ? (
                <Text style={styles.emptyHint}>
                  Sign in with Google to search ORBII users.
                </Text>
              ) : results.length === 0 && !searching ? (
                <Text style={styles.emptyHint}>
                  No one found. Try a different spelling, or invite by phone below.
                </Text>
              ) : (
                <View style={{ gap: 6 }}>
                  {results.map((user) => (
                    <Pressable
                      key={user.id}
                      onPress={() => sendUsername(user.username)}
                      style={({ pressed }) => [
                        styles.userRow,
                        pressed && styles.pressedScale,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Invite @${user.username}`}
                      disabled={submitting !== null}
                    >
                      <View style={styles.avatar}>
                        {user.photoUri ? (
                          <Image
                            source={{ uri: user.photoUri }}
                            style={styles.avatarImg}
                          />
                        ) : (
                          <Text style={styles.avatarInitial}>
                            {(user.name?.charAt(0) ?? user.username.charAt(0)).toUpperCase()}
                          </Text>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.userName} numberOfLines={1}>
                          {user.name?.trim() || `@${user.username}`}
                        </Text>
                        <Text style={styles.userHandle} numberOfLines={1}>
                          @{user.username}
                        </Text>
                      </View>
                      <View style={styles.inviteBadge}>
                        {submitting === user.username ? (
                          <ActivityIndicator
                            size="small"
                            color={colors.textInverse}
                          />
                        ) : (
                          <Text style={styles.inviteBadgeText}>Invite</Text>
                        )}
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionLabel}>Invite by phone</Text>
              <Text style={styles.hint}>
                Generates a share link for WhatsApp / SMS. They'll join the circle when they open it in ORBII.
              </Text>
              <View style={styles.inputRow}>
                <Text style={styles.atPrefix}>+91</Text>
                <TextInput
                  value={phone}
                  onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))}
                  placeholder="10-digit number"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                  style={styles.input}
                  maxLength={10}
                />
              </View>
              <Button
                label={submitting === 'phone' ? 'Sending…' : 'Create & share'}
                onPress={sendPhone}
                disabled={!isValidIndianPhone(phone) || submitting !== null}
                loading={submitting === 'phone'}
                variant="outline"
              />
            </View>
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
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    gap: spacing.sm,
    ...shadows.card,
  },
  sectionLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  hint: {
    ...typography.caption,
    color: colors.textSecondary,
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
    borderColor: 'rgba(0,0,0,0.06)',
  },
  atPrefix: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: colors.textSecondary,
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
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: '#F7FAF8',
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: colors.brandDeep,
  },
  userName: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  userHandle: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 11.5,
    color: colors.textSecondary,
    marginTop: 1,
  },
  inviteBadge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.circle,
    backgroundColor: colors.brandDeep,
    minWidth: 64,
    alignItems: 'center',
  },
  inviteBadgeText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 11.5,
    color: colors.textInverse,
    letterSpacing: 0.3,
  },
  pressedScale: {
    opacity: 0.92,
    transform: [{ scale: 0.98 }],
  },
});
