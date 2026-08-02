import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenContainer } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import type { AppStackParamList } from '@/navigation/types';
import { useAppSelector } from '@/redux/store';
import { getItem } from '@/services/storage';
import { MAX_NAME_LEN } from '@/services/mesh-chat';
import { nearbyAvailable, startNearby, stopNearby, onPeers, type NearbyPeer } from '@/services/mesh-nearby';

const NAME_KEY = 'orbii:mesh-chat-name';

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 8) return 'active now';
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

export function NearbyPeopleScreen() {
  const navigation = useNavigation<NavigationProp<AppStackParamList>>();
  const profile = useAppSelector((s) => s.user.profile);
  const [peers, setPeers] = useState<NearbyPeer[]>([]);

  useEffect(() => {
    let alive = true;
    let started = false;
    (async () => {
      if (!nearbyAvailable) return;
      const saved = await getItem<string>(NAME_KEY);
      const nick = (saved || profile?.name || profile?.username || 'Neighbour').slice(0, MAX_NAME_LEN);
      await startNearby(nick);
      started = true;
      if (!alive) return;
    })();
    const unsub = onPeers(setPeers);
    return () => {
      alive = false;
      unsub();
      if (started) stopNearby();
    };
  }, [profile?.name, profile?.username]);

  const renderPeer = ({ item }: { item: NearbyPeer }) => (
    <Pressable
      onPress={() =>
        navigation.navigate('DmThread', { peerPublicB64: item.publicB64, peerNick: item.nick })
      }
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{(item.nick || '?').slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{item.nick || 'Nearby'}</Text>
        <View style={styles.metaRow}>
          <Ionicons name="lock-closed" size={11} color={colors.sageDeep} />
          <Text style={styles.meta}>Encrypted · {ago(item.lastSeen)}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );

  return (
    <ScreenContainer padded={false} scroll={false} edges={['top', 'left', 'right']}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>People nearby</Text>
          <View style={{ width: 40 }} />
        </View>

        {peers.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="wifi-outline" size={30} color={colors.lavenderDeep} />
            </View>
            <Text style={styles.emptyTitle}>Looking for people nearby…</Text>
            <Text style={styles.emptyBody}>
              Anyone with ORBII open within Bluetooth range shows up here. Tap them to start a private,
              end-to-end encrypted chat that only the two of you can read, with no internet.
            </Text>
          </View>
        ) : (
          <FlatList
            data={peers}
            keyExtractor={(p) => p.shortId}
            renderItem={renderPeer}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <Text style={styles.hint}>
                Tap someone for a private encrypted chat. Only people with ORBII open nearby appear.
              </Text>
            }
          />
        )}
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
  headerTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: colors.textPrimary },

  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  hint: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.icon,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.lavenderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: colors.lavenderDeep },
  name: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15.5, color: colors.textPrimary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  meta: { fontFamily: fontFamilies.poppinsMedium, fontSize: 12, color: colors.textSecondary },

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
  emptyTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: colors.textPrimary },
  emptyBody: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
  },
  pressed: { opacity: 0.85 },
});
