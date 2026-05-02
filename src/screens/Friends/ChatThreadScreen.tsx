import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer } from '@/components/common';
import {
  colors,
  fontFamilies,
  radius,
  spacing,
  typography,
} from '@/theme';
import { useAppSelector } from '@/redux/store';
import { getFastLocation } from '@/services/location';
import {
  encodeLocationMessage,
  fetchRecentMessages,
  parseLocation,
  sendMessage,
  subscribeMessages,
  type ChatMessage,
} from '@/services/messages';
import { getPublicUserByUsername } from '@/services/users-public';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'ChatThread'>;

// Persistent chat backed by Supabase `messages` table. We resolve the
// friend's username → uid on mount, fetch the last 50 messages, then
// subscribe to INSERTs for the pair.
export function ChatThreadScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<AppStackParamList, 'ChatThread'>>();
  const profile = useAppSelector((s) => s.user.profile);
  const friendUsername = route.params.username;
  const myUid = profile?.uid ?? null;

  const [friendUid, setFriendUid] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const pub = await getPublicUserByUsername(friendUsername);
      if (!alive) return;
      setFriendUid(pub?.id ?? null);
      if (!pub || !myUid) {
        setLoading(false);
        return;
      }
      const recent = await fetchRecentMessages(myUid, pub.id);
      if (!alive) return;
      setMessages(recent);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [friendUsername, myUid]);

  useEffect(() => {
    if (!myUid || !friendUid) return;
    const handle = subscribeMessages(myUid, friendUid, (msg) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });
    return () => handle.unsubscribe();
  }, [myUid, friendUid]);

  useEffect(() => {
    if (messages.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages.length]);

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed || !myUid || !friendUid) return;
    setDraft('');
    const sent = await sendMessage(myUid, friendUid, trimmed);
    if (sent) {
      setMessages((prev) =>
        prev.some((m) => m.id === sent.id) ? prev : [...prev, sent],
      );
    }
  };

  const handleShareLocation = async () => {
    if (!myUid || !friendUid) return;
    try {
      const point = await getFastLocation();
      const text = encodeLocationMessage(
        point.latitude,
        point.longitude,
        'Sharing my location',
      );
      const sent = await sendMessage(myUid, friendUid, text);
      if (sent) {
        setMessages((prev) =>
          prev.some((m) => m.id === sent.id) ? prev : [...prev, sent],
        );
      }
    } catch {
      Alert.alert('Location off', 'Enable location to share where you are.');
    }
  };

  const friendInitial = friendUsername.charAt(0).toUpperCase();

  if (!myUid) {
    return (
      <ScreenContainer>
        <Text style={styles.empty}>Set a username from your profile first.</Text>
      </ScreenContainer>
    );
  }

  if (!loading && !friendUid) {
    return (
      <ScreenContainer>
        <View style={styles.emptyState}>
          <Ionicons name="alert-circle-outline" size={36} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>User not found</Text>
          <Text style={styles.emptyBody}>
            @{friendUsername} hasn't set up an ORBII profile yet.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false} scroll={false}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.friendBadge}>
          <Text style={styles.friendBadgeText}>{friendInitial}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.friendHandle}>@{friendUsername}</Text>
          <Text style={styles.friendMeta}>
            {loading ? 'Loading…' : 'Messages stored, end-to-friend'}
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
          ListEmptyComponent={<EmptyState friend={friendUsername} />}
          renderItem={({ item }) => (
            <MessageBubble message={item} mine={item.senderId === myUid} />
          )}
        />
      )}

      <View style={styles.composer}>
        <Pressable
          onPress={handleShareLocation}
          style={({ pressed }) => [styles.locationBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Share live location"
        >
          <Ionicons name="location" size={18} color={colors.primary} />
        </Pressable>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={`Message @${friendUsername}`}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          multiline
          maxLength={500}
        />
        <Pressable
          onPress={handleSend}
          disabled={!draft.trim()}
          style={({ pressed }) => [
            styles.sendBtn,
            !draft.trim() && styles.sendBtnDisabled,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Send"
        >
          <Ionicons name="arrow-up" size={18} color={colors.textInverse} />
        </Pressable>
      </View>
    </ScreenContainer>
  );
}

function MessageBubble({
  message,
  mine,
}: {
  message: ChatMessage;
  mine: boolean;
}) {
  const time = useMemo(
    () =>
      new Date(message.createdAt).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    [message.createdAt],
  );

  const location = useMemo(() => parseLocation(message.message), [message.message]);

  const handleOpenLocation = () => {
    if (!location) return;
    const url = `https://maps.google.com/?q=${location.latitude},${location.longitude}`;
    Linking.openURL(url).catch(() => undefined);
  };

  return (
    <View
      style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}
    >
      <View
        style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}
      >
        {location ? (
          <Pressable onPress={handleOpenLocation} style={styles.locationBubble}>
            <View style={styles.locationIconWrap}>
              <Ionicons name="location" size={16} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
                {location.caption || 'Shared a live location'}
              </Text>
              <Text style={styles.locationCoord}>Tap to open in Maps</Text>
            </View>
          </Pressable>
        ) : (
          <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
            {message.message}
          </Text>
        )}
        <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>
          {time}
        </Text>
      </View>
    </View>
  );
}

function EmptyState({ friend }: { friend: string }) {
  return (
    <View style={styles.emptyState}>
      <Ionicons name="chatbubbles-outline" size={36} color={colors.textMuted} />
      <Text style={styles.emptyTitle}>No messages yet</Text>
      <Text style={styles.emptyBody}>
        Say hi to @{friend} or share your live location to let them know
        where you are.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  empty: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xxl,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendBadgeText: {
    fontFamily: fontFamilies.poppinsBold,
    color: colors.textInverse,
    fontSize: 16,
  },
  friendHandle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  friendMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
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
  },
  bubbleRow: {
    flexDirection: 'row',
  },
  bubbleRowMine: {
    justifyContent: 'flex-end',
  },
  bubbleRowTheirs: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
  },
  bubbleMine: {
    backgroundColor: colors.primary,
    borderTopRightRadius: 4,
  },
  bubbleTheirs: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 4,
  },
  bubbleText: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  bubbleTextMine: {
    color: colors.textInverse,
  },
  bubbleTime: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'right',
  },
  bubbleTimeMine: {
    color: 'rgba(255,255,255,0.78)',
  },
  locationBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  locationIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationCoord: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  locationBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.surface,
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
});
