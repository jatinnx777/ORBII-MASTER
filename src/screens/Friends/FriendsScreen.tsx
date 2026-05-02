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
import { searchUsers, type PublicUser } from '@/services/users-public';
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
            <View style={styles.youCard}>
              <View style={styles.youAvatar}>
                <Text style={styles.youAvatarText}>
                  {(profile?.name ?? '?').charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.youLabel}>Your handle</Text>
                <Text style={styles.youHandle}>
                  {profile?.username ? `@${profile.username}` : 'Set in profile'}
                </Text>
              </View>
              {profile?.username ? (
                <Pressable
                  onPress={handleShareUsername}
                  style={({ pressed }) => [
                    styles.shareBtn,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Share username"
                >
                  <Ionicons name="share-social" size={15} color={colors.textInverse} />
                </Pressable>
              ) : null}
            </View>

            <View style={styles.searchCard}>
              <View style={styles.searchRow}>
                <Ionicons name="search" size={16} color={colors.textSecondary} />
                <TextInput
                  value={draft}
                  onChangeText={(v) => {
                    // Accept letters, numbers, underscore, space (for name
                    // search) and dot. Strip @ silently — handles can be
                    // typed as "@jay" and we resolve to "jay".
                    const cleaned = v.toLowerCase().replace(/[^a-z0-9_ .]/g, '');
                    setDraft(cleaned);
                    if (error) setError(null);
                  }}
                  placeholder="Search username or name"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={32}
                  style={styles.searchInput}
                />
                {draft.length > 0 ? (
                  <Pressable
                    onPress={() => setDraft('')}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                  >
                    <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                  </Pressable>
                ) : null}
              </View>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </View>

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
            <View style={styles.empty}>
              <Ionicons
                name="people-outline"
                size={36}
                color={colors.textMuted}
              />
              <Text style={styles.emptyTitle}>Your circle is empty</Text>
              <Text style={styles.emptyBody}>
                The first person you add could be the one who reaches you fastest.
              </Text>
            </View>
          )
        }
        renderItem={({ item, index }) => (
          <FriendRow
            friend={item}
            index={index}
            onRemove={() => handleRemove(item.username)}
            onChat={() => navigation.navigate('ChatThread', { username: item.username })}
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
  onChat,
}: {
  friend: Friend;
  index: number;
  onRemove: () => void;
  onChat: () => void;
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
      <Pressable
        onPress={onChat}
        style={({ pressed }) => [styles.friendRow, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Chat with ${friend.username}`}
      >
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
            onPress={onChat}
            hitSlop={10}
            style={({ pressed }) => [styles.chatBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Open chat with ${friend.username}`}
          >
            <Ionicons name="chatbubble-ellipses" size={16} color={colors.primary} />
          </Pressable>
          <Pressable
            onPress={onRemove}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${friend.username}`}
          >
            <Ionicons name="close-circle" size={22} color={colors.textMuted} />
          </Pressable>
        </View>
      </Pressable>
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
  youCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.dark,
  },
  youAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  youAvatarText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 17,
    color: colors.textInverse,
  },
  youLabel: {
    fontFamily: fontFamilies.interMedium,
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  youHandle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textInverse,
    marginTop: 1,
  },
  shareBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 4,
    gap: spacing.sm,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
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
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.md,
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
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: spacing.xl,
  },
  emptyTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  emptyBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    fontSize: 13,
    paddingHorizontal: spacing.lg,
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
