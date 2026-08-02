import React, { useEffect, useRef, useState } from 'react';
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
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenContainer, appAlert } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { getItem } from '@/services/storage';
import { MAX_NAME_LEN } from '@/services/mesh-chat';
import type { AppStackParamList } from '@/navigation/types';
import {
  nearbyAvailable,
  startNearby,
  stopNearby,
  onDirectMessage,
  sendDirectMessage,
  MAX_DM_LEN,
} from '@/services/mesh-nearby';

const NAME_KEY = 'orbii:mesh-chat-name';

type Row = { text: string; at: number; id: string; mine: boolean };

let seq = 0;
const rowId = () => `${Date.now()}-${seq++}`;

export function DmThreadScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<AppStackParamList, 'DmThread'>>();
  const { peerPublicB64, peerNick } = route.params;
  const profile = useAppSelector((s) => s.user.profile);

  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [ready, setReady] = useState(false);
  const listRef = useRef<FlatList<Row>>(null);

  useEffect(() => {
    let alive = true;
    let started = false;
    (async () => {
      if (!nearbyAvailable) return;
      const saved = await getItem<string>(NAME_KEY);
      const nick = (saved || profile?.name || profile?.username || 'Neighbour').slice(0, MAX_NAME_LEN);
      const ok = await startNearby(nick);
      started = true;
      if (alive) setReady(ok);
    })();
    // Only messages from THIS peer land in this thread.
    const unsub = onDirectMessage((m) => {
      if (m.fromPublicB64 !== peerPublicB64) return;
      setRows((prev) => [...prev, { text: m.text, at: m.at, id: rowId(), mine: false }]);
    });
    return () => {
      alive = false;
      unsub();
      if (started) stopNearby();
    };
  }, [peerPublicB64, profile?.name, profile?.username]);

  useEffect(() => {
    if (rows.length) listRef.current?.scrollToEnd({ animated: true });
  }, [rows.length]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    if (!ready) {
      appAlert('Bluetooth not ready', 'Allow Bluetooth for ORBII and keep it on to send.');
      return;
    }
    setText('');
    setRows((prev) => [...prev, { text: body, at: Date.now(), id: rowId(), mine: true }]);
    const ok = await sendDirectMessage(peerPublicB64, body);
    if (!ok) {
      setRows((prev) => [
        ...prev,
        { text: "Couldn't send. They may have moved out of range.", at: Date.now(), id: rowId(), mine: false },
      ]);
    }
  };

  const renderRow = ({ item }: { item: Row }) => (
    <View style={[styles.bubbleRow, item.mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.bubble, item.mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        <Text style={[styles.bubbleText, item.mine && styles.bubbleTextMine]}>{item.text}</Text>
      </View>
    </View>
  );

  return (
    <ScreenContainer padded={false} scroll={false} edges={['top', 'left', 'right']}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle} numberOfLines={1}>{peerNick || 'Nearby'}</Text>
            <View style={styles.statusRow}>
              <Ionicons name="lock-closed" size={11} color={colors.sageDeep} />
              <Text style={styles.statusText}>End-to-end encrypted · offline</Text>
            </View>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {rows.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="lock-closed" size={28} color={colors.sageDeep} />
            </View>
            <Text style={styles.emptyTitle}>Only you two can read this</Text>
            <Text style={styles.emptyBody}>
              Messages are encrypted to {peerNick || 'this person'}'s phone and sent over Bluetooth.
              Relays in between carry them but can't read them. Keep both phones in range.
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

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={8}
        >
          <View style={styles.composer}>
            <TextInput
              value={text}
              onChangeText={(v) => setText(v.slice(0, MAX_DM_LEN))}
              placeholder={`Message ${peerNick || 'privately'}…`}
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              multiline
              maxLength={MAX_DM_LEN}
            />
            <Pressable
              onPress={send}
              disabled={!text.trim()}
              style={({ pressed }) => [styles.sendBtn, (!text.trim() || pressed) && styles.sendBtnDim]}
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
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: colors.textPrimary },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  statusText: { fontFamily: fontFamilies.poppinsMedium, fontSize: 11, color: colors.textSecondary },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.sageSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: colors.textPrimary },
  emptyBody: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },

  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
  bubbleRow: { marginVertical: 3, flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bubbleMine: { backgroundColor: colors.sageDeep, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: colors.surface, borderBottomLeftRadius: 4, ...shadows.icon },
  bubbleText: { fontFamily: fontFamilies.poppinsMedium, fontSize: 14, lineHeight: 20, color: colors.textPrimary },
  bubbleTextMine: { color: colors.textInverse },

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
    backgroundColor: colors.sageDeep,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.icon,
  },
  sendBtnDim: { opacity: 0.5 },
});
