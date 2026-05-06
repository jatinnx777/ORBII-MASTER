import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '@/components/common';
import {
  colors,
  fontFamilies,
  radius,
  spacing,
  typography,
} from '@/theme';
import { LinearGradient } from 'expo-linear-gradient';

// Lightweight, on-device "AI" support chat. The bot picks the best
// matching saved reply from a small intent table — fast, deterministic,
// and works offline. The user always sees a human escape hatch (the
// `escalate` quick reply emails support).

type Sender = 'me' | 'bot';
type Msg = {
  id: string;
  sender: Sender;
  body: string;
  createdAt: number;
};

type Intent = {
  id: string;
  patterns: RegExp[];
  reply: string;
};

const INTENTS: Intent[] = [
  {
    id: 'sos_not_firing',
    patterns: [/sos.*(not|isn'?t).*work/i, /sos.*(broken|dead)/i],
    reply:
      'For SOS to fire reliably, you need: (1) location permission granted, ' +
      '(2) network or mobile data on, (3) at least one emergency contact ' +
      'added. Open Settings → Privacy and confirm both toggles. If it still ' +
      'misbehaves, tap "Talk to a human" below.',
  },
  {
    id: 'voice_not_listening',
    patterns: [/voice.*(not|isn'?t).*listen/i, /voice sos.*(not|broken)/i, /mic.*not.*work/i],
    reply:
      'Voice SOS uses your microphone, so first check the mic permission in ' +
      'Android Settings → Apps → ORBII. Inside the app, open Safety → Voice ' +
      'SOS and toggle it OFF then ON. Background listening drops on Xiaomi / ' +
      'Oppo / Vivo because of aggressive battery savers — disable battery ' +
      'optimisation for ORBII to keep it alive.',
  },
  {
    id: 'add_friend',
    patterns: [/add (a )?friend/i, /how.*friend/i, /circle/i],
    reply:
      'Open the Safety tab → Manage your circle, or tap the chat icon on the ' +
      'home header. Type 2+ letters of your friend\'s username or name and ' +
      'tap "Add". They have to accept before you\'re connected — until then ' +
      'no location share or chat.',
  },
  {
    id: 'username_taken',
    patterns: [/username.*taken/i, /can'?t.*username/i],
    reply:
      'Each ORBII handle is unique. Try variations with underscores or numbers ' +
      '(e.g. jay_k, jay007). You can change your username again 30 days after ' +
      'your last change.',
  },
  {
    id: 'plans',
    patterns: [/plan|silver|gold|platinum|pric|cost|subscri|month|year/i],
    reply:
      'We have three tiers: Silver ₹99/mo (Crime Reports), Gold ₹199/mo (priority ' +
      'response + extended tracking), Platinum ₹299/mo (everything + Travel ' +
      'Heatmap + family dashboard). Yearly saves up to 25%. See the Plans tab ' +
      'for the full comparison.',
  },
  {
    id: 'data_breach',
    patterns: [/breach|leak|hack/i],
    reply:
      'Data Breach Alerts (free) checks your sign-in email against known leaks. ' +
      'Open Safety → Digital Safety and toggle it on. Results show breach names ' +
      'and dates — change passwords on those services immediately.',
  },
  {
    id: 'cancel_account',
    patterns: [/delete.*account|cancel.*account|remove.*data/i],
    reply:
      'You can sign out anytime from Settings → Account. To permanently delete ' +
      'your account and data, tap "Talk to a human" below — we wipe everything ' +
      'within 24 hours.',
  },
  {
    id: 'thanks',
    patterns: [/^(thanks|thank you|thx|ty)$/i, /^(ok|okay|cool|great)\b/i],
    reply: "You're welcome! Stay safe out there. I'm here whenever you need me.",
  },
  {
    id: 'hi',
    patterns: [/^(hi|hello|hey|hola)\b/i],
    reply:
      "Hi! I'm ORBII Assistant. Ask me anything about SOS, your circle, plans, " +
      'or privacy — or tap a quick reply below.',
  },
];

const QUICK_REPLIES = [
  'How do SOS alerts work?',
  'Voice SOS is not listening',
  'How do I add a friend?',
  'Tell me about plans',
];

const FALLBACK =
  "I'm not sure about that one yet. The fastest path is to email our team " +
  'at hello@orbii.app — we usually reply within a few hours.';

function pickReply(text: string): string {
  for (const intent of INTENTS) {
    if (intent.patterns.some((re) => re.test(text))) return intent.reply;
  }
  return FALLBACK;
}

export function SupportChatScreen() {
  const navigation = useNavigation();
  const listRef = useRef<FlatList<Msg>>(null);
  const [messages, setMessages] = useState<Msg[]>(() => [
    {
      id: 'intro',
      sender: 'bot',
      body:
        "Hi, I'm the ORBII Assistant 👋\n\nI can help with SOS, your circle, " +
        'voice settings, plans, and privacy. What can I help with today?',
      createdAt: Date.now(),
    },
  ]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;
    const mine: Msg = {
      id: `m_${Date.now()}`,
      sender: 'me',
      body: trimmed,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, mine]);
    setDraft('');
    setThinking(true);
    // Small delay so the bot feels considered, not instant.
    const replyText = pickReply(trimmed);
    setTimeout(() => {
      const reply: Msg = {
        id: `m_${Date.now()}_bot`,
        sender: 'bot',
        body: replyText,
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, reply]);
      setThinking(false);
    }, 600);
  };

  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [messages.length, thinking]);

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
        <View style={styles.botBadge}>
          <Ionicons name="sparkles" size={16} color={colors.brandDeep} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>ORBII Assistant</Text>
          <Text style={styles.headerSub}>Instant replies · always available</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <Bubble msg={item} />}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListFooterComponent={thinking ? <Typing /> : null}
        />

        <View style={styles.quickRow}>
          {QUICK_REPLIES.map((q) => (
            <Pressable
              key={q}
              onPress={() => send(q)}
              style={({ pressed }) => [
                styles.quickPill,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.quickPillText}>{q}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() =>
              Linking.openURL('mailto:hello@orbii.app').catch(() => undefined)
            }
            style={({ pressed }) => [
              styles.quickPill,
              styles.quickPillEscalate,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="person" size={12} color={colors.textInverse} />
            <Text style={styles.quickPillEscalateText}>Talk to a human</Text>
          </Pressable>
        </View>

        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask anything…"
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={500}
            style={styles.input}
          />
          <Pressable
            onPress={() => send(draft)}
            disabled={!draft.trim() || thinking}
            style={({ pressed }) => [
              styles.sendBtn,
              (!draft.trim() || thinking) && styles.sendBtnDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="arrow-up" size={18} color={colors.textInverse} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

function Bubble({ msg }: { msg: Msg }) {
  const mine = msg.sender === 'me';
  const time = useMemo(
    () =>
      new Date(msg.createdAt).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
      }),
    [msg.createdAt],
  );
  if (mine) {
    return (
      <View style={[styles.bubbleRow, styles.bubbleRowMine]}>
        <View style={styles.bubbleMine}>
          <Text style={styles.bubbleTextMine}>{msg.body}</Text>
          <Text style={styles.bubbleTimeMine}>{time}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.bubbleRow, styles.bubbleRowBot]}>
      <View style={styles.botAvatar}>
        <LinearGradient
          colors={[colors.brandSoft, colors.background]}
          style={styles.botAvatarBg}
        >
          <Ionicons name="sparkles" size={12} color={colors.brandDeep} />
        </LinearGradient>
      </View>
      <View style={styles.bubbleTheirs}>
        <Text style={styles.bubbleTextTheirs}>{msg.body}</Text>
        <Text style={styles.bubbleTimeTheirs}>{time}</Text>
      </View>
    </View>
  );
}

function Typing() {
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    const loops = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(d, {
            toValue: 1,
            duration: 360,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(d, {
            toValue: 0,
            duration: 360,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [dots]);
  return (
    <View style={[styles.bubbleRow, styles.bubbleRowBot]}>
      <View style={styles.botAvatar}>
        <LinearGradient
          colors={[colors.brandSoft, colors.background]}
          style={styles.botAvatarBg}
        >
          <Ionicons name="sparkles" size={12} color={colors.brandDeep} />
        </LinearGradient>
      </View>
      <View style={styles.typingBubble}>
        {dots.map((d, i) => (
          <Animated.View
            key={i}
            style={[
              styles.typingDot,
              {
                opacity: d.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.3, 1],
                }),
                transform: [
                  {
                    translateY: d.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, -3],
                    }),
                  },
                ],
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  botBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  headerSub: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    flexGrow: 1,
  },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowBot: { justifyContent: 'flex-start' },
  botAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
  },
  botAvatarBg: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleMine: {
    maxWidth: '78%',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 16,
    borderBottomRightRadius: 4,
    backgroundColor: colors.brandDeep,
  },
  bubbleTextMine: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 14,
    color: colors.textInverse,
    lineHeight: 19,
  },
  bubbleTimeMine: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 10,
    color: 'rgba(255,255,255,0.78)',
    marginTop: 3,
    textAlign: 'right',
  },
  bubbleTheirs: {
    maxWidth: '78%',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    backgroundColor: colors.surface,
  },
  bubbleTextTheirs: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 19,
  },
  bubbleTimeTheirs: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 3,
  },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    backgroundColor: colors.surface,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.brandDeep,
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingTop: 4,
    paddingBottom: 8,
  },
  quickPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.circle,
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.brandMid,
  },
  quickPillText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 11,
    color: colors.brandDeep,
  },
  quickPillEscalate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.brandDeep,
    borderColor: colors.brandDeep,
  },
  quickPillEscalateText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 11,
    color: colors.textInverse,
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
    backgroundColor: colors.brandDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
});
