import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fontFamilies, radius, spacing } from '@/theme';
import type { Circle } from '@/services/circles';

// Circle switcher.
//
// Tapping the circle name in a map header opens this: the whole map blurs out
// and the only thing left in focus is which group you are looking at. That is
// the point of the treatment. Switching circles changes the meaning of every
// pin on the screen, so it deserves the user's full attention for the second it
// takes, rather than a row of chips competing with the map behind them.

export function CircleSwitcherTrigger({
  name,
  count,
  onPress,
}: {
  name: string;
  count: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.trigger, pressed && styles.triggerPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Switch circle. Currently ${name}`}
    >
      <Text style={styles.triggerText} numberOfLines={1}>
        {name}
      </Text>
      {count > 0 ? <Text style={styles.triggerCount}>{count}</Text> : null}
      <Ionicons name="chevron-down" size={15} color={colors.textPrimary} />
    </Pressable>
  );
}

export function CircleSwitcher({
  visible,
  circles,
  selectedId,
  onSelect,
  onCreate,
  onClose,
}: {
  visible: boolean;
  circles: Circle[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate?: () => void;
  onClose: () => void;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: visible ? 260 : 160,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

  const panelStyle = {
    opacity: anim,
    transform: [
      { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) },
      { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
    ],
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFill}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <SafeAreaView edges={['top']} pointerEvents="box-none">
          <Animated.View style={[styles.panel, panelStyle]}>
            <Text style={styles.panelLabel}>YOUR CIRCLES</Text>
            {circles.map((c, i) => {
              const on = c.id === selectedId;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    onSelect(c.id);
                    onClose();
                  }}
                  style={({ pressed }) => [
                    styles.item,
                    i > 0 && styles.itemDivider,
                    pressed && styles.itemPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <View style={[styles.itemIcon, on && styles.itemIconOn]}>
                    <Text style={styles.itemEmoji}>{c.emoji || '👥'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.itemName, on && styles.itemNameOn]} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text style={styles.itemMeta} numberOfLines={1}>
                      {c.isDefault ? 'Default circle' : 'Tap to view'}
                    </Text>
                  </View>
                  {on ? (
                    <Ionicons name="checkmark-circle" size={21} color={colors.brand} />
                  ) : null}
                </Pressable>
              );
            })}

            {onCreate ? (
              <Pressable
                onPress={() => {
                  onClose();
                  onCreate();
                }}
                style={({ pressed }) => [styles.item, styles.itemDivider, pressed && styles.itemPressed]}
                accessibilityRole="button"
              >
                <View style={styles.addIcon}>
                  <Ionicons name="add" size={19} color={colors.brandDeep} />
                </View>
                <Text style={styles.addText}>New circle</Text>
              </Pressable>
            ) : null}
          </Animated.View>
        </SafeAreaView>
      </BlurView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.9)',
    maxWidth: 210,
  },
  triggerPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  triggerText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14.5,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  triggerCount: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 11,
    color: colors.textInverse,
    backgroundColor: colors.brand,
    borderRadius: 9,
    minWidth: 18,
    textAlign: 'center',
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },

  panel: {
    marginTop: spacing.xl + spacing.md,
    marginHorizontal: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    shadowColor: '#2B0B45',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 28,
    elevation: 10,
    overflow: 'hidden',
  },
  panelLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
  },
  itemDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  itemPressed: { backgroundColor: colors.creamDeep },
  itemIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.cream,
  },
  itemIconOn: { backgroundColor: colors.brandSoft },
  itemEmoji: { fontSize: 18 },
  itemName: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15.5, color: colors.textPrimary },
  itemNameOn: { color: colors.brandDeep },
  itemMeta: { fontFamily: fontFamilies.poppinsRegular, fontSize: 12, color: colors.textMuted, marginTop: 1 },
  addIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  addText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15.5, color: colors.brandDeep },
});
