import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { openChat, type ChatHandle, type ChatMessage } from '@/services/chat';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'ChatThread'>;

// Direct chat between the signed-in user and one friend. Messages travel
// over a Supabase Realtime broadcast channel keyed off both usernames, so
// no backend tables are required for the live experience.
export function ChatThreadScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<AppStackParamList, 'ChatThread'>>();
  const profile = useAppSelector((s) => s.user.profile);
  const friendUsername = route.params.username;
  const me = profile?.username ?? null;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const handleRef = useRef<ChatHandle | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  useEffect(() => {
    if (!me) return;
    const handle = openChat(me, friendUsername, (msg) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });
    handleRef.current = handle;
    return () => {
      handle.unsubscribe();
      handleRef.current = null;
    };
  }, [me, friendUsername]);

  useEffect(() => {
    if (messages.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages.length]);

  const handleSend = async () => {
    const trimmed = draft.trim();
    if (!trimmed || !me) return;
    const handle = handleRef.current;
    if (!handle) return;
    const optimistic: ChatMessage = {
      id: `m_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
      fromUsername: me,
      toUsername: friendUsername,
      body: trimmed,
      kind: 'text',
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft('');
    await handle.send({
      fromUsername: me,
      toUsername: friendUsername,
      body: trimmed,
      kind: 'text',
    });
  };

  const handleShareLocation = async () => {
    if (!me) return;
    const handle = handleRef.current;
    if (!handle) return;
    try {
      const point = await getFastLocation();
      const optimistic: ChatMessage = {
        id: `m_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
        fromUsername: me,
        toUsername: friendUsername,
        body: 'Shared a live location',
        kind: 'location',
        latitude: point.latitude,
        longitude: point.longitude,
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, optimistic]);
      await handle.send({
        fromUsername: me,
        toUsername: friendUsername,
        body: 'Shared a live location',
        kind: 'location',
        latitude: point.latitude,
        longitude: point.longitude,
      });
    } catch {
      Alert.alert('Location off', 'Enable location to share where you are.');
    }
  };

  const friendInitial = friendUsername.charAt(0).toUpperCase();

  if (!me) {
    return (
      <ScreenContainer>
        <Text style={styles.empty}>Set a username from your profile first.</Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false} scroll={false}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={styles.backBtn}
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
            Live chat. Messages flow when both of you are online.
          </Text>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
        ListEmptyComponent={<EmptyState friend={friendUsername} />}
        renderItem={({ item }) => (
          <MessageBubble message={item} mine={item.fromUsername === me} />
        )}
      />

      <View style={styles.composer}>
        <Pressable
          onPress={handleShareLocation}
          style={styles.locationBtn}
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
          style={[
            styles.sendBtn,
            !draft.trim() && styles.sendBtnDisabled,
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

  const handleOpenLocation = () => {
    if (message.kind !== 'location' || message.latitude == null) return;
    const url = `https://maps.google.com/?q=${message.latitude},${message.longitude}`;
    Linking.openURL(url).catch(() => undefined);
  };

  return (
    <View
      style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}
    >
      <View
        style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}
      >
        {message.kind === 'location' ? (
          <Pressable onPress={handleOpenLocation} style={styles.locationBubble}>
            <View style={styles.locationIconWrap}>
              <Ionicons name="location" size={16} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
                {message.body}
              </Text>
              <Text style={styles.locationCoord}>
                Tap to open in Maps
              </Text>
            </View>
          </Pressable>
        ) : (
          <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
            {message.body}
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
  empty: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xxl,
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
