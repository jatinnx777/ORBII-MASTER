import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { connectionChanged } from '@/redux/slices/appSlice';
import { subscribeConnection } from '@/services/net';

export function OfflineBanner() {
  const dispatch = useAppDispatch();
  const online = useAppSelector((s) => s.app.isOnline);

  useEffect(() => {
    const unsub = subscribeConnection((state) => {
      dispatch(connectionChanged(state.isConnected));
    });
    return () => unsub();
  }, [dispatch]);

  if (online) return null;

  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <Ionicons name="cloud-offline" size={16} color={colors.textInverse} />
      <Text style={styles.text}>
        Offline — SOS will queue and send when you reconnect.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.warning,
    paddingVertical: spacing.sm,
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
