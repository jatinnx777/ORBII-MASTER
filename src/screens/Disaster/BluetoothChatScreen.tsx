import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenContainer, appAlert } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { getItem, setItem } from '@/services/storage';
import {
  chatAvailable,
  ensureChatReady,
  subscribeChatMessages,
  sendChatMessage,
  MAX_CHAT_LEN,
  MAX_NAME_LEN,
  type MeshChatMessage,
} from '@/services/mesh-chat';

type Row = MeshChatMessage & { id: string; mine: boolean };

const NAME_KEY = 'orbii:mesh-chat-name';

let seq = 0;
const rowId = () => `${Date.now()}-${seq++}`;

export function BluetoothChatScreen() {
  const navigation = useNavigation();
  const profile = useAppSelector((s) => s.user.profile);

  const defaultName = useMemo(
    () => (profile?.name || profile?.username || 'Neighbour').slice(0, MAX_NAME_LEN),
    [profile?.name, profile?.username],
  );

  const [name, setName] = useState(defaultName);
  const [editingName, setEditingName] = useState(false);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [ready, setReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const listRef = useRef<FlatList<Row>>(null);

  // Load a saved display name, then bring Bluetooth up and start listening.
  useEffect(() => {
    let alive = true;
    (async () => {
      const saved = await getItem<string>(NAME_KEY);
      if (alive && saved) setName(saved.slice(0, MAX_NAME_LEN));
      if (!chatAvailable) {
        if (alive) setDenied(true);
        return;
      }
      const ok = await ensureChatReady();
      if (!alive) return;
      setReady(ok);
      setDenied(!ok);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Receive messages from nearby phones.
  useEffect(() => {
    if (!chatAvailable) return;
    const unsub = subscribeChatMessages((m) => {
      setRows((prev) => [...prev, { ...m, id: rowId(), mine: false }]);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (rows.length) listRef.current?.scrollToEnd({ animated: true });
  }, [rows.length]);

  const saveName = async () => {
    const clean = name.trim().slice(0, MAX_NAME_LEN) || defaultName;
    setName(clean);
    setEditingName(false);
    await setItem(NAME_KEY, clean);
  };

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    if (!ready) {
      appAlert(
        'Bluetooth not ready',
        'Allow Bluetooth for ORBII and keep it on. This chat needs Bluetooth to reach nearby phones.',
      );
      return;
    }
    setText('');
    // Show it immediately; the radio broadcasts in the background.
    setRows((prev) => [...prev, { sender: name, text: body, at: Date.now(), id: rowId(), mine: true }]);
    const ok = await sendChatMessage(body, name);
    if (!ok) {
      setRows((prev) => [
        ...prev,
        {
          sender: 'ORBII',
          text: "Couldn't send. Your phone may not support Bluetooth broadcast.",
          at: Date.now(),
          id: rowId(),
          mine: false,
        },
      ]);
    }
  };

  const renderRow = ({ item }: { item: Row }) => (
    <View style={[styles.bubbleRow, item.mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.bubble, item.mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {!item.mine ? <Text style={styles.bubbleSender}>{item.sender || 'Nearby'}</Text> : null}
        <Text style={[styles.bubbleText, item.mine && styles.bubbleTextMine]}>{item.text}</Text>
      </View>
    </View>
  );

  return (
    <ScreenContainer padded={false} scroll={false} edges={['top', 'left', 'right']}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Nearby chat</Text>
            <View style={styles.statusRow}>
              <View style={[styles.dot, { backgroundColor: ready ? colors.sageDeep : colors.textMuted }]} />
              <Text style={styles.statusText}>{ready ? 'Bluetooth on · offline' : 'Bluetooth off'}</Text>
            </View>
          </View>
          <Pressable onPress={() => setEditingName(true)} hitSlop={10} style={styles.back}>
            <Ionicons name="person-circle-outline" size={24} color={colors.textPrimary} />
          </Pressable>
        </View>

        {/* Name editor */}
        {editingName ? (
          <View style={styles.nameBar}>
            <Text style={styles.nameLabel}>You appear as</Text>
            <TextInput
              value={name}
              onChangeText={(v) => setName(v.slice(0, MAX_NAME_LEN))}
              placeholder="Your name"
              placeholderTextColor={colors.textMuted}
              style={styles.nameInput}
              autoFocus
              onSubmitEditing={saveName}
            />
            <Pressable onPress={saveName} style={styles.nameSave}>
              <Text style={styles.nameSaveText}>Save</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Explainer / empty state */}
        {rows.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="bluetooth" size={30} color={colors.lavenderDeep} />
            </View>
            <Text style={styles.emptyTitle}>Talk with no internet</Text>
            <Text style={styles.emptyBody}>
              Messages hop phone-to-phone over Bluetooth to people within about a hundred metres, and
              a few hops beyond. No signal, no data, no accounts needed.
            </Text>
            <Text style={styles.emptyWarn}>
              This is a shout to everyone nearby, not a private message. Don't share anything private.
              First release, still being tested.
            </Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={rows}
            keyExtractor={(r) => r.id}
            renderItem={renderRow}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          />
        )}

        {denied ? (
          <View style={styles.deniedBar}>
            <Ionicons name="alert-circle" size={16} color={colors.coralDeep} />
            <Text style={styles.deniedText}>
              {chatAvailable
                ? 'Turn on Bluetooth and allow it for ORBII to chat nearby.'
                : "This phone can't broadcast Bluetooth chat."}
            </Text>
          </View>
        ) : null}

        {/* Composer */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={8}
        >
          <View style={styles.composer}>
            <TextInput
              value={text}
              onChangeText={(v) => setText(v.slice(0, MAX_CHAT_LEN))}
              placeholder="Message people nearby…"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              multiline
              maxLength={MAX_CHAT_LEN}
            />
            <Pressable
              onPress={send}
              disabled={!text.trim()}
              style={({ pressed }) => [
                styles.sendBtn,
                (!text.trim() || pressed) && styles.sendBtnDim,
              ]}
            >
              <Ionicons name="arrow-up" size={22} color={colors.textInverse} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { alignItems: 'center' },
  headerTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: colors.textPrimary },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontFamily: fontFamilies.poppinsMedium, fontSize: 11, color: colors.textSecondary },

  nameBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.sm,
    ...shadows.icon,
  },
  nameLabel: { fontFamily: fontFamilies.poppinsMedium, fontSize: 12, color: colors.textSecondary },
  nameInput: {
    flex: 1,
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14,
    color: colors.textPrimary,
    paddingVertical: 4,
  },
  nameSave: {
    backgroundColor: colors.textPrimary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  nameSaveText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13, color: colors.textInverse },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.lavenderSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 19, color: colors.textPrimary },
  emptyBody: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
  emptyWarn: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },

  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  bubbleRow: { marginVertical: 3, flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bubbleMine: { backgroundColor: colors.brandDeep, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: colors.surface, borderBottomLeftRadius: 4, ...shadows.icon },
  bubbleSender: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 11.5,
    color: colors.lavenderDeep,
    marginBottom: 2,
  },
  bubbleText: { fontFamily: fontFamilies.poppinsMedium, fontSize: 14, lineHeight: 20, color: colors.textPrimary },
  bubbleTextMine: { color: colors.textInverse },

  deniedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.coralSoft,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  deniedText: { flex: 1, fontFamily: fontFamilies.poppinsMedium, fontSize: 12.5, color: colors.coralDeep },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 14,
    color: colors.textPrimary,
    ...shadows.icon,
  },
  sendBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.brandDeep,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.icon,
  },
  sendBtnDim: { opacity: 0.5 },
});
