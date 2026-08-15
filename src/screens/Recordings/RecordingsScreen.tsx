import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useAudioPlayer } from 'expo-audio';
import { useBrandSheet } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import {
  deleteRecording,
  listRecordings,
  type SavedRecording,
} from '@/services/sos-recording';

// Evidence vault, every SOS audio clip saved on THIS device. Play, or delete.
// Nothing here ever leaves the phone unless the user shares it; deleting is
// permanent and immediate, because it's her evidence and her choice.

export function RecordingsScreen() {
  const navigation = useNavigation();
  const sheet = useBrandSheet();
  const [items, setItems] = useState<SavedRecording[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const player = useAudioPlayer(
    playingId ? items.find((i) => i.sosId === playingId)?.uri ?? null : null,
  );

  const refresh = useCallback(() => setItems(listRecordings()), []);
  useFocusEffect(useCallback(() => refresh(), [refresh]));

  const toggle = (rec: SavedRecording) => {
    if (playingId === rec.sosId) {
      player.pause();
      setPlayingId(null);
      return;
    }
    setPlayingId(rec.sosId);
    // useAudioPlayer swaps source on the next render; play shortly after.
    setTimeout(() => {
      try {
        player.seekTo(0);
        player.play();
      } catch {
        // source not ready yet
      }
    }, 120);
  };

  const remove = (rec: SavedRecording) => {
    sheet.confirm({
      title: 'Delete this recording?',
      body: 'This permanently removes the audio from your device. It cannot be undone.',
      destructive: true,
      confirmLabel: 'Delete',
      icon: 'trash',
      onConfirm: () => {
        if (playingId === rec.sosId) {
          player.pause();
          setPlayingId(null);
        }
        deleteRecording(rec.sosId);
        refresh();
      },
    });
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Evidence vault</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.note}>
            <Ionicons name="lock-closed" size={15} color={colors.brandDeep} />
            <Text style={styles.noteText}>
              Every SOS records audio automatically, including the seconds before
              it fired. Clips stay on your phone. Only you can play or delete them.
            </Text>
          </View>

          {items.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="mic-off-outline" size={34} color={colors.textMuted} />
              <Text style={styles.emptyText}>No recordings yet.</Text>
              <Text style={styles.emptyHint}>
                One is saved automatically the next time you fire an SOS.
              </Text>
            </View>
          ) : (
            items.map((rec) => {
              const on = playingId === rec.sosId;
              return (
                <View key={rec.sosId} style={styles.card}>
                  <Pressable
                    onPress={() => toggle(rec)}
                    style={[styles.playBtn, on && styles.playBtnOn]}
                    accessibilityRole="button"
                    accessibilityLabel={on ? 'Pause recording' : 'Play recording'}
                  >
                    <Ionicons
                      name={on ? 'pause' : 'play'}
                      size={20}
                      color={colors.textInverse}
                    />
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recTitle}>
                      SOS recording
                    </Text>
                    <Text style={styles.recSub}>
                      {rec.savedAt
                        ? new Date(rec.savedAt).toLocaleString('en-IN')
                        : 'Saved on device'}{' '}
                      · {(rec.sizeBytes / 1024 / 1024).toFixed(1)} MB
                    </Text>
                  </View>
                  <Pressable onPress={() => remove(rec)} hitSlop={8} style={styles.del}>
                    <Ionicons name="trash-outline" size={20} color={colors.coralDeep} />
                  </Pressable>
                </View>
              );
            })
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.icon,
  },
  headerTitle: { ...typography.h2, fontSize: 17, color: colors.textPrimary },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  note: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.brandSoft,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  noteText: {
    flex: 1,
    ...typography.caption,
    fontSize: 11.5,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  empty: { alignItems: 'center', gap: 8, paddingVertical: spacing.xxl },
  emptyText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  emptyHint: { ...typography.caption, fontSize: 12, color: colors.textMuted, textAlign: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    ...shadows.card,
  },
  playBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtnOn: { backgroundColor: colors.brandDeep },
  recTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14.5, color: colors.textPrimary },
  recSub: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary, marginTop: 1 },
  del: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.coralSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
