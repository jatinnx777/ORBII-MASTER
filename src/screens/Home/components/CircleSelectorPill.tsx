import React, { useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAppSelector } from '@/redux/store';
import { setActiveCircle } from '@/services/circles-bootstrap';
import type { Circle, CircleKind } from '@/services/circles';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
} from '@/theme';
import type { AppStackParamList } from '@/navigation/types';

// Center pill in the Home header that names the currently-active circle
// ("Family Circle ▾") and opens a sheet listing every circle the user
// belongs to. Tapping a circle switches the active context (and persists
// it). The bottom row of the sheet offers "Create circle" and "See all".
//
// When the user has no circles yet, the pill collapses to an inviting
// "Add a circle" CTA so the empty state still feels intentional.

type Nav = NativeStackNavigationProp<AppStackParamList>;

const KIND_ICON: Record<
  CircleKind,
  React.ComponentProps<typeof Ionicons>['name']
> = {
  family: 'home',
  friends: 'people',
  trip: 'airplane',
  college: 'school',
  women: 'female',
  emergency: 'alert-circle',
  general: 'people-circle',
};

export function CircleSelectorPill() {
  const navigation = useNavigation<Nav>();
  const { circles, activeCircleId, status } = useAppSelector((s) => s.circles);
  const [open, setOpen] = useState(false);

  const active = useMemo(
    () => circles.find((c) => c.id === activeCircleId) ?? null,
    [circles, activeCircleId],
  );

  // Empty state — invite the user to create their first circle.
  if (status === 'ready' && circles.length === 0) {
    return (
      <Pressable
        onPress={() => navigation.navigate('CircleCreate')}
        style={({ pressed }) => [
          styles.pill,
          styles.pillEmpty,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Create your first circle"
      >
        <Ionicons name="add" size={14} color={colors.brandDeep} />
        <Text style={styles.pillTextEmpty}>Add a circle</Text>
      </Pressable>
    );
  }

  // Loading / no data yet — calm placeholder so the header doesn't jump.
  if (!active) {
    return (
      <View style={[styles.pill, { opacity: 0.6 }]} pointerEvents="none">
        <Text style={styles.pillText}>ORBII</Text>
      </View>
    );
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Active circle: ${active.name}. Tap to switch.`}
      >
        <View
          style={[
            styles.activeIcon,
            { backgroundColor: tint(active.color, 0.18) },
          ]}
        >
          {active.emoji ? (
            <Text style={styles.activeEmoji}>{active.emoji}</Text>
          ) : (
            <Ionicons
              name={KIND_ICON[active.kind] ?? 'people-circle'}
              size={12}
              color={active.color}
            />
          )}
        </View>
        <Text style={styles.pillText} numberOfLines={1}>
          {active.name}
        </Text>
        <Ionicons name="chevron-down" size={12} color={colors.textSecondary} />
      </Pressable>

      <CircleSheet
        visible={open}
        onClose={() => setOpen(false)}
        circles={circles}
        activeCircleId={activeCircleId}
        onSelect={async (c) => {
          setOpen(false);
          await setActiveCircle(c.id);
        }}
        onCreate={() => {
          setOpen(false);
          navigation.navigate('CircleCreate');
        }}
        onSeeAll={() => {
          setOpen(false);
          navigation.navigate('Tabs', { screen: 'Circles' });
        }}
      />
    </>
  );
}

function CircleSheet({
  visible,
  onClose,
  circles,
  activeCircleId,
  onSelect,
  onCreate,
  onSeeAll,
}: {
  visible: boolean;
  onClose: () => void;
  circles: Circle[];
  activeCircleId: string | null;
  onSelect: (c: Circle) => void;
  onCreate: () => void;
  onSeeAll: () => void;
}) {
  const enter = useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(enter, {
      toValue: visible ? 1 : 0,
      duration: visible ? 220 : 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, enter]);

  const translateY = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [40, 0],
  });

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Animated.View
          style={[
            styles.sheet,
            { opacity: enter, transform: [{ translateY }] },
          ]}
          onStartShouldSetResponder={() => true}
        >
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Switch circle</Text>
          <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ gap: 6 }}>
            {circles.map((c) => {
              const isActive = c.id === activeCircleId;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => onSelect(c)}
                  style={({ pressed }) => [
                    styles.row,
                    isActive && styles.rowActive,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                >
                  <View
                    style={[
                      styles.rowIcon,
                      { backgroundColor: tint(c.color, 0.18) },
                    ]}
                  >
                    {c.emoji ? (
                      <Text style={styles.rowEmoji}>{c.emoji}</Text>
                    ) : (
                      <Ionicons
                        name={KIND_ICON[c.kind] ?? 'people-circle'}
                        size={16}
                        color={c.color}
                      />
                    )}
                  </View>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {c.name}
                  </Text>
                  {isActive ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={18}
                      color={colors.brandDeep}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.footerRow}>
            <Pressable
              onPress={onCreate}
              style={({ pressed }) => [styles.footerBtn, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Ionicons name="add" size={16} color={colors.brandDeep} />
              <Text style={styles.footerBtnText}>Create</Text>
            </Pressable>
            <Pressable
              onPress={onSeeAll}
              style={({ pressed }) => [styles.footerBtn, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Ionicons name="people-outline" size={16} color={colors.brandDeep} />
              <Text style={styles.footerBtnText}>See all</Text>
            </Pressable>
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.circle,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    maxWidth: 200,
    ...shadows.card,
  },
  pillEmpty: {
    backgroundColor: colors.brandSoft,
    borderColor: colors.brandMid,
  },
  pressed: {
    opacity: 0.92,
    transform: [{ scale: 0.97 }],
  },
  activeIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeEmoji: { fontSize: 12 },
  pillText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12.5,
    color: colors.textPrimary,
    letterSpacing: 0.1,
    maxWidth: 130,
  },
  pillTextEmpty: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12.5,
    color: colors.brandDeep,
    letterSpacing: 0.1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    paddingBottom: spacing.lg + 12,
    gap: spacing.sm,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.10)',
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: '#F7FAF8',
  },
  rowActive: {
    backgroundColor: colors.brandSoft,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowEmoji: { fontSize: 16 },
  rowName: {
    flex: 1,
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  footerRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  footerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brandMid,
    backgroundColor: colors.brandSoft,
  },
  footerBtnText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: colors.brandDeep,
    letterSpacing: 0.2,
  },
});
