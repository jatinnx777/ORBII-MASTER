import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { connectionChanged } from '@/redux/slices/appSlice';
import { subscribeConnection } from '@/services/net';

export function OfflineBanner() {
  const dispatch = useAppDispatch();
  const insets = useSafeAreaInsets();
  const online = useAppSelector((s) => s.app.isOnline);

  useEffect(() => {
    const unsub = subscribeConnection((state) => {
      dispatch(connectionChanged(state.isConnected));
    });
    return () => unsub();
  }, [dispatch]);

  if (online) return null;

  return (
    <View
      style={[styles.wrap, { paddingTop: insets.top + spacing.sm }]}
      accessibilityRole="alert"
    >
      <Ionicons name="cloud-offline" size={16} color={colors.textInverse} />
      <Text style={styles.text}>
        No internet. Your SOS is saved and sends the instant you reconnect.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.warning,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  text: {
    ...typography.caption,
    color: colors.textInverse,
    flex: 1,
  },
});
