import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  FlatList,
  Image,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer } from '@/components/common';
import {
  colors,
  fontFamilies,
  radius,
  spacing,
  typography,
} from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { friendAdded, friendRemoved } from '@/redux/slices/userSlice';
import {
  acceptFriendRequest,
  declineFriendRequest,
  listIncomingRequests,
  listOutgoingRequests,
  sendFriendRequest,
  type FriendRequest,
} from '@/services/friend-requests';
import {
  searchUsers,
  syncUsersPublic,
  type PublicUser,
} from '@/services/users-public';
import type { Friend } from '@/types';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'Friends'>;

// Friends/Chat tab. Search pulls live `users_public` rows from Supabase
// and the Friend rows are enriched with name + photo from the same table.
export function FriendsScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);
  const friends: Friend[] = profile?.friends ?? [];

  const [draft, setDraft] = useState('');
  const [searchResults, setSearchResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittingFor, setSubmittingFor] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Strip a leading "@" and trim — what the user actually means to query.
  const queryDraft = draft.replace(/^@+/, '').trim();

  const refreshRequests = useCallback(async () => {
    if (!profile?.uid || !profile.username) return;
    const [inc, out] = await Promise.all([
      listIncomingRequests(profile.username),
      listOutgoingRequests(profile.uid),
    ]);
    setIncoming(inc);
    setOutgoing(out.filter((r) => r.status === 'pending'));
  }, [profile?.uid, profile?.username]);

  useEffect(() => {
    refreshRequests();
  }, [refreshRequests]);

  // Mirror the current user into users_public on every Friends open.
  // Defensive — if the auto-sync at sign-in failed (RLS, network), this
  // catches it so the user is searchable.
  useEffect(() => {
    if (profile && profile.username) {
      syncUsersPublic(profile).catch(() => undefined);
    }
  }, [profile?.uid, profile?.username]);

  // Debounced live search. Hits Supabase only after the user stops typing.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (queryDraft.length < 2 || !profile?.uid) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      const results = await searchUsers({
        query: queryDraft,
        excludeUid: profile.uid,
      });
      setSearchResults(results);
      setSearching(false);
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [queryDraft, profile?.uid]);

  const sentTo = useMemo(
    () => new Set(outgoing.map((r) => r.toUsername)),
    [outgoing],
  );
  const friendUsernames = useMemo(
    () => new Set(friends.map((f) => f.username)),
    [friends],
  );

  const handleSend = async (target: PublicUser) => {
    if (!profile?.uid || !profile.username) {
      setError('Set up your profile before adding friends.');
      return;
    }
    setSubmittingFor(target.username);
    setError(null);
    try {
      await sendFriendRequest({
        fromUserId: profile.uid,
        fromUsername: profile.username,
        toUsername: target.username,
      });
      await refreshRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send request.');
    } finally {
      setSubmittingFor(null);
    }
  };

  const handleAccept = async (request: FriendRequest) => {
    if (!profile?.uid || !profile.username) return;
    await acceptFriendRequest({
      requestId: request.id,
      myUid: profile.uid,
      myUsername: profile.username,
      fromUserId: request.fromUserId,
      fromUsername: request.fromUsername,
    });
    dispatch(
      friendAdded({
        username: request.fromUsername,
        addedAt: Date.now(),
        uid: request.fromUserId,
      }),
    );
    await refreshRequests();
  };

  const handleDecline = async (request: FriendRequest) => {
    await declineFriendRequest(request.id);
    await refreshRequests();
  };

  const handleRemove = (username: string) => {
    Alert.alert('Remove from circle?', `${username} will be removed from your safety circle.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => dispatch(friendRemoved(username)),
      },
    ]);
  };

  const handleShareUsername = async () => {
    if (!profile?.username) return;
    try {
      await Share.share({
        message: `Add me on ORBII as @${profile.username}. We watch out for each other in emergencies.`,
      });
    } catch {
      // ignore
    }
  };

  const isSearching = queryDraft.length >= 2;

  return (
    <ScreenContainer padded={false} scroll={false}>
      <View style={styles.header}>
        <Text style={styles.title}>Your safety circle</Text>
        <Text style={styles.subtitle}>
          Friends in your circle see your SOS first.
        </Text>
      </View>

      <FlatList
        data={isSearching ? [] : friends}
        keyExtractor={(f) => f.username}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <YouCard
              name={profile?.name ?? '?'}
              username={profile?.username ?? null}
              onShare={handleShareUsername}
            />

            <SearchField
              value={draft}
              onChange={(v) => {
                const cleaned = v.toLowerCase().replace(/[^a-z0-9_@ .]/g, '');
                setDraft(cleaned);
                if (error) setError(null);
              }}
              onClear={() => setDraft('')}
              error={error}
            />

            {isSearching ? (
              <View style={styles.searchResults}>
                <Text style={styles.sectionHeader}>
                  {searching
                    ? 'Searching…'
                    : searchResults.length > 0
                      ? `${searchResults.length} result${searchResults.length === 1 ? '' : 's'}`
                      : 'No matches'}
                </Text>
                {searchResults.map((u) => (
                  <SearchResultRow
                    key={u.id}
                    user={u}
                    isFriend={friendUsernames.has(u.username)}
                    isSent={sentTo.has(u.username)}
                    submitting={submittingFor === u.username}
                    onSend={() => handleSend(u)}
                  />
                ))}
                {!searching && searchResults.length === 0 ? (
                  <Text style={styles.noMatchHint}>
                    They need to sign in to ORBII at least once before they
                    show up in search.
                  </Text>
                ) : null}
              </View>
            ) : (
              <>
                {incoming.length > 0 ? (
                  <View style={styles.requestsBlock}>
                    <Text style={styles.sectionHeader}>
                      {incoming.length} request{incoming.length === 1 ? '' : 's'} for you
                    </Text>
                    {incoming.map((req) => (
                      <RequestRow
                        key={req.id}
                        request={req}
                        onAccept={() => handleAccept(req)}
                        onDecline={() => handleDecline(req)}
                      />
                    ))}
                  </View>
                ) : null}

                {outgoing.length > 0 ? (
                  <View style={styles.requestsBlock}>
                    <Text style={styles.sectionHeader}>Pending — sent by you</Text>
                    {outgoing.map((req) => (
                      <View key={req.id} style={styles.outgoingRow}>
                        <Ionicons name="paper-plane-outline" size={16} color={colors.textSecondary} />
                        <Text style={styles.outgoingHandle}>@{req.toUsername}</Text>
                        <Text style={styles.outgoingMeta}>Waiting for them</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {friends.length > 0 ? (
                  <Text style={styles.sectionHeader}>
                    {friends.length} friend{friends.length === 1 ? '' : 's'} in your circle
                  </Text>
                ) : null}
              </>
            )}
          </View>
        }
        ListEmptyComponent={
          isSearching ? null : (
            <CircleEmptyState onInvite={handleShareUsername} />
          )
        }
        renderItem={({ item, index }) => (
          <FriendRow
            friend={item}
            index={index}
            onRemove={() => handleRemove(item.username)}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      />
    </ScreenContainer>
  );
}

function SearchResultRow({
  user,
  isFriend,
  isSent,
  submitting,
  onSend,
}: {
  user: PublicUser;
  isFriend: boolean;
  isSent: boolean;
  submitting: boolean;
  onSend: () => void;
}) {
  const initial = (user.name ?? user.username).charAt(0).toUpperCase();
  return (
    <View style={styles.resultRow}>
      <View style={styles.resultAvatar}>
        {user.photoUri ? (
          <Image source={{ uri: user.photoUri }} style={styles.resultAvatarImg} />
        ) : (
          <Text style={styles.resultAvatarText}>{initial}</Text>
        )}
      </View>
      <View style={{ flex: 1 }}>
        {user.name ? <Text style={styles.resultName}>{user.name}</Text> : null}
        <Text style={styles.resultHandle}>@{user.username}</Text>
      </View>
      {isFriend ? (
        <View style={styles.statusPill}>
          <Ionicons name="checkmark" size={14} color={colors.success} />
          <Text style={styles.statusPillText}>In circle</Text>
        </View>
      ) : isSent ? (
        <View style={styles.statusPill}>
          <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.statusPillText}>Pending</Text>
        </View>
      ) : (
        <Pressable
          onPress={onSend}
          disabled={submitting}
          style={({ pressed }) => [
            styles.addBtn,
            (pressed || submitting) && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Send friend request to ${user.username}`}
        >
          <Ionicons name="person-add" size={14} color={colors.textInverse} />
          <Text style={styles.addBtnText}>{submitting ? 'Sending…' : 'Add'}</Text>
        </Pressable>
      )}
    </View>
  );
}

function FriendRow({
  friend,
  index,
  onRemove,
}: {
  friend: Friend;
  index: number;
  onRemove: () => void;
}) {
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const id = setTimeout(() => {
      Animated.timing(enter, {
        toValue: 1,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }, index * 50);
    return () => clearTimeout(id);
  }, [enter, index]);

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  const initial = (friend.name ?? friend.username).charAt(0).toUpperCase();

  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY }] }}>
      <View style={styles.friendRow}>
        <View style={styles.friendAvatar}>
          {friend.photoUri ? (
            <Image source={{ uri: friend.photoUri }} style={styles.friendAvatarImg} />
          ) : (
            <Text style={styles.friendAvatarText}>{initial}</Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.friendHandle}>
            {friend.name ? friend.name : `@${friend.username}`}
          </Text>
          <Text style={styles.friendMeta}>
            {friend.name ? `@${friend.username}` : `Added ${new Date(friend.addedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`}
          </Text>
        </View>
        <View style={styles.friendActions}>
          <Pressable
            onPress={onRemove}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${friend.username}`}
          >
            <Ionicons name="close-circle" size={22} color={colors.textMuted} />
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

function RequestRow({
  request,
  onAccept,
  onDecline,
}: {
  request: FriendRequest;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <View style={styles.requestRow}>
      <View style={styles.requestAvatar}>
        <Text style={styles.requestAvatarText}>
          {request.fromUsername.charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.friendHandle}>@{request.fromUsername}</Text>
        <Text style={styles.friendMeta}>Wants to add you to their circle</Text>
      </View>
      <Pressable
        onPress={onDecline}
        style={({ pressed }) => [styles.declineBtn, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Decline"
      >
        <Ionicons name="close" size={18} color={colors.textSecondary} />
      </Pressable>
      <Pressable
        onPress={onAccept}
        style={({ pressed }) => [styles.acceptBtn, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Accept"
      >
        <Ionicons name="checkmark" size={18} color={colors.textInverse} />
      </Pressable>
    </View>
  );
}

// "You" card — translucent layered mint card. Replaces the harsh dark
// block with something that reads as your own corner of the app.
function YouCard({
  name,
  username,
  onShare,
}: {
  name: string;
  username: string | null;
  onShare: () => void;
}) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.04,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const initial = (name || '?').charAt(0).toUpperCase();

  return (
    <View style={styles.youCardWrap}>
      <LinearGradient
        colors={[colors.brandSoft, colors.background]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.youCardGradient}
      >
        <Animated.View
          style={[styles.youAvatar, { transform: [{ scale: pulse }] }]}
        >
          <Text style={styles.youAvatarText}>{initial}</Text>
        </Animated.View>
        <View style={{ flex: 1 }}>
          <Text style={styles.youLabel}>Your handle</Text>
          <Text style={styles.youHandle}>
            {username ? `@${username}` : 'Set in profile'}
          </Text>
        </View>
        {username ? (
          <Pressable
            onPress={onShare}
            style={({ pressed }) => [
              styles.shareBtn,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Share username"
          >
            <Ionicons name="share-social" size={16} color={colors.brandDeep} />
          </Pressable>
        ) : null}
      </LinearGradient>
    </View>
  );
}

// Soft, focusable search field. Border + shadow shift on focus so the
// input feels alive without flashing colour.
function SearchField({
  value,
  onChange,
  onClear,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
  error: string | null;
}) {
  const [focused, setFocused] = useState(false);
  const focusAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(focusAnim, {
      toValue: focused ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [focused, focusAnim]);

  const borderColor = focusAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.border, colors.brand],
  });
  const shadowOpacity = focusAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.18],
  });

  return (
    <View>
      <Animated.View
        style={[
          styles.searchRow,
          { borderColor, shadowOpacity, shadowColor: colors.brandDeep },
        ]}
      >
        <Ionicons name="search" size={16} color={colors.textSecondary} />
        <TextInput
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search username or name"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={32}
          style={styles.searchInput}
        />
        {value.length > 0 ? (
          <Pressable
            onPress={onClear}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Ionicons name="close-circle" size={16} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </Animated.View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

// Friendly empty state for new users with no circle yet. Soft floating
// illustration block + warm copy. Replaces the stark "people-outline +
// 'Your circle is empty'" placeholder.
function CircleEmptyState({ onInvite }: { onInvite: () => void }) {
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [float]);
  const translateY = float.interpolate({
    inputRange: [0, 1],
    outputRange: [-3, 3],
  });

  return (
    <View style={styles.emptyWrap}>
      <Animated.View
        style={[styles.emptyArt, { transform: [{ translateY }] }]}
      >
        <LinearGradient
          colors={[colors.brandSoft, colors.background]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.emptyArtGradient}
        >
          <View style={styles.emptyArtRing}>
            <Ionicons
              name="people"
              size={40}
              color={colors.brandDeep}
            />
          </View>
        </LinearGradient>
      </Animated.View>
      <Text style={styles.emptyTitle}>
        Your circle starts with one trusted person.
      </Text>
      <Text style={styles.emptyBody}>
        The people you add here can help faster during emergencies.
      </Text>
      <Pressable
        onPress={onInvite}
        style={({ pressed }) => [
          styles.inviteBtn,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
      >
        <Ionicons name="paper-plane" size={14} color={colors.textInverse} />
        <Text style={styles.inviteBtnText}>Invite Friends</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: 4,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 24,
    color: colors.textPrimary,
    letterSpacing: -0.4,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 14,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  listHeader: {
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  youCardWrap: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: colors.background,
    shadowColor: colors.brandDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10,
    shadowRadius: 14,
    elevation: 4,
  },
  youCardGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: 18,
  },
  youAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.brandDeep,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.brandDeep,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  youAvatarText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    color: colors.textInverse,
  },
  youLabel: {
    fontFamily: fontFamilies.interMedium,
    color: colors.textSecondary,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  youHandle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 17,
    color: colors.textPrimary,
    marginTop: 1,
  },
  shareBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.brandMid,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#0F1115',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 3,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing.sm,
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 15,
    color: colors.textPrimary,
  },
  errorText: {
    ...typography.caption,
    color: colors.error,
    fontSize: 12,
    paddingHorizontal: spacing.sm,
  },
  searchResults: {
    gap: 6,
  },
  noMatchHint: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 12,
    color: colors.textMuted,
    paddingHorizontal: spacing.sm,
    paddingTop: 4,
    lineHeight: 17,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resultAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  resultAvatarImg: { width: '100%', height: '100%' },
  resultAvatarText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  resultName: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  resultHandle: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 12,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  addBtnText: {
    color: colors.textInverse,
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 12,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.circle,
  },
  statusPillText: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 11,
    color: colors.textSecondary,
  },
  sectionHeader: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
    marginBottom: 2,
  },
  emptyWrap: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  emptyArt: {
    width: 120,
    height: 120,
    borderRadius: 60,
    overflow: 'hidden',
    marginBottom: spacing.md,
    shadowColor: colors.brandDeep,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 6,
  },
  emptyArtGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyArtRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    color: colors.textPrimary,
    marginTop: spacing.sm,
    textAlign: 'center',
    letterSpacing: -0.2,
    paddingHorizontal: spacing.md,
  },
  emptyBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    fontSize: 13,
    paddingHorizontal: spacing.lg,
    lineHeight: 19,
  },
  inviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.brandDeep,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderRadius: radius.circle,
    marginTop: spacing.md,
    shadowColor: colors.brandDeep,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32,
    shadowRadius: 10,
    elevation: 4,
  },
  inviteBtnText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: colors.textInverse,
    letterSpacing: 0.2,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  friendAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  friendAvatarImg: { width: '100%', height: '100%' },
  friendAvatarText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: colors.primary,
  },
  friendHandle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  friendMeta: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
  },
  friendActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chatBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestsBlock: {
    gap: 6,
  },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  requestAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestAvatarText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: colors.textInverse,
  },
  acceptBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outgoingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  outgoingHandle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: colors.textPrimary,
    flex: 1,
  },
  outgoingMeta: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
  },
});
