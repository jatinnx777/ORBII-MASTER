import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  FlatList,
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
import { Button, ScreenContainer } from '@/components/common';
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
import type { Friend } from '@/types';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'Friends'>;

// Friends/Chat tab. Friends are added by username and live in the user's
// safety circle. We do not have a profiles table yet, so adding by
// username persists locally without verifying the friend exists. Once a
// real backend is wired we can resolve usernames to user records and
// surface friend status / chat.
export function FriendsScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);
  const friends: Friend[] = profile?.friends ?? [];

  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);

  const sanitizedDraft = draft.toLowerCase().replace(/[^a-z0-9_]/g, '');
  const draftValid = /^[a-z0-9_]{3,20}$/.test(sanitizedDraft);

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

  const handleAdd = async () => {
    if (!draftValid) {
      setError('Username must be 3 to 20 lowercase letters, numbers, or underscores.');
      return;
    }
    if (sanitizedDraft === profile?.username) {
      setError("That's your own username.");
      return;
    }
    if (friends.some((f) => f.username === sanitizedDraft)) {
      setError('Already in your circle.');
      return;
    }
    if (outgoing.some((r) => r.toUsername === sanitizedDraft)) {
      setError('Request already pending.');
      return;
    }
    if (!profile?.uid || !profile.username) {
      setError('Set up your profile before adding friends.');
      return;
    }
    setSubmitting(true);
    try {
      await sendFriendRequest({
        fromUserId: profile.uid,
        fromUsername: profile.username,
        toUsername: sanitizedDraft,
      });
      setDraft('');
      setError(null);
      await refreshRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send request.');
    } finally {
      setSubmitting(false);
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
      friendAdded({ username: request.fromUsername, addedAt: Date.now() }),
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

  return (
    <ScreenContainer padded={false} scroll={false}>
      <View style={styles.header}>
        <Text style={styles.title}>Your safety circle</Text>
        <Text style={styles.subtitle}>
          Friends in your circle see your SOS first. Add them by username.
        </Text>
      </View>

      <FlatList
        data={friends}
        keyExtractor={(f) => f.username}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <LinearGradient
              colors={['#FFE4F0', '#E8D7FF']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.youCard}
            >
              <View style={styles.youAvatar}>
                <Text style={styles.youAvatarText}>
                  {(profile?.name ?? '?').charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.youLabel}>Your username</Text>
                <Text style={styles.youHandle}>
                  {profile?.username ? `@${profile.username}` : 'Set in profile'}
                </Text>
              </View>
              {profile?.username ? (
                <Pressable
                  onPress={handleShareUsername}
                  style={styles.shareBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Share username"
                >
                  <Ionicons name="share-social" size={16} color={colors.primary} />
                </Pressable>
              ) : null}
            </LinearGradient>

            <View style={styles.addCard}>
              <Text style={styles.addLabel}>Send a friend request by username</Text>
              <View style={styles.addRow}>
                <Text style={styles.addPrefix}>@</Text>
                <TextInput
                  value={draft}
                  onChangeText={(v) => {
                    setDraft(v.toLowerCase().replace(/[^a-z0-9_]/g, ''));
                    if (error) setError(null);
                  }}
                  placeholder="their_username"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={20}
                  style={styles.addInput}
                />
              </View>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              <Button
                label={submitting ? 'Sending…' : 'Send request'}
                onPress={handleAdd}
                disabled={!draftValid || submitting}
                loading={submitting}
              />
              <Text style={styles.hintText}>
                They have to accept before you're connected. Until then no
                location sharing or chat.
              </Text>
            </View>

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
                <Text style={styles.sectionHeader}>
                  Pending — sent by you
                </Text>
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
          </View>
        }
        ListEmptyComponent={
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

// Slide-up + fade-in for each friend row, indexed so the list reads as a
// cascade rather than appearing all at once.
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

  return (
    <Animated.View
      style={{ opacity: enter, transform: [{ translateY }] }}
    >
      <Pressable
        onPress={onChat}
        style={({ pressed }) => [
          styles.friendRow,
          pressed && { opacity: 0.85 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Chat with ${friend.username}`}
      >
        <View style={styles.friendAvatar}>
          <Text style={styles.friendAvatarText}>
            {friend.username.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.friendHandle}>@{friend.username}</Text>
          <Text style={styles.friendMeta}>
            Added{' '}
            {new Date(friend.addedAt).toLocaleDateString('en-IN', {
              day: '2-digit',
              month: 'short',
            })}
          </Text>
        </View>
        <View style={styles.friendActions}>
          <Pressable
            onPress={onChat}
            hitSlop={10}
            style={styles.chatBtn}
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

// Pending incoming friend request. Renders the sender's handle plus an
// Accept (primary, red) and Decline (outline) action.
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
        <Text style={styles.friendMeta}>
          Wants to add you to their circle
        </Text>
      </View>
      <Pressable
        onPress={onDecline}
        style={styles.declineBtn}
        accessibilityRole="button"
        accessibilityLabel="Decline"
      >
        <Ionicons name="close" size={18} color={colors.textSecondary} />
      </Pressable>
      <Pressable
        onPress={onAccept}
        style={styles.acceptBtn}
        accessibilityRole="button"
        accessibilityLabel="Accept"
      >
        <Ionicons name="checkmark" size={18} color={colors.textInverse} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
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
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  youAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  youAvatarText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    color: colors.textInverse,
  },
  youLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  youHandle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textPrimary,
    marginTop: 2,
  },
  shareBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  addLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addPrefix: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 16,
  },
  addInput: {
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
  },
  sectionHeader: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 12,
    color: colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
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
    padding: spacing.md,
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
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
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
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintText: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
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
    borderColor: colors.primary,
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
