import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';

// On-brand replacement for React Native's system Alert. `appAlert` mirrors the
// system alert signature exactly, so call sites can
// swap one for the other with no behaviour change — but the popup now renders
// inside the app in ORBII's cream/peach style instead of the grey OS dialog.

export type AppDialogButton = {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
};

type DialogConfig = {
  title: string;
  message?: string;
  buttons?: AppDialogButton[];
};

type Listener = (cfg: DialogConfig) => void;
let listener: Listener | null = null;
// If a dialog is requested before the host has mounted, hold the most recent
// one and flush it as soon as the host registers.
let pending: DialogConfig | null = null;

export function appAlert(
  title: string,
  message?: string,
  buttons?: AppDialogButton[],
): void {
  const cfg = { title, message, buttons };
  if (listener) listener(cfg);
  else pending = cfg;
}

export function AppDialogHost() {
  const [cfg, setCfg] = useState<DialogConfig | null>(null);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    listener = (c) => setCfg(c);
    if (pending) {
      setCfg(pending);
      pending = null;
    }
    return () => {
      listener = null;
    };
  }, []);

  useEffect(() => {
    if (!cfg) return;
    anim.setValue(0);
    Animated.spring(anim, {
      toValue: 1,
      useNativeDriver: true,
      friction: 8,
      tension: 90,
    }).start();
  }, [cfg, anim]);

  const close = (cb?: () => void) => {
    Animated.timing(anim, {
      toValue: 0,
      duration: 130,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setCfg(null);
      cb?.();
    });
  };

  if (!cfg) return null;

  const buttons =
    cfg.buttons && cfg.buttons.length > 0
      ? cfg.buttons
      : [{ text: 'OK', style: 'default' as const }];
  // 3+ buttons read better stacked vertically; 1–2 sit side by side.
  const stacked = buttons.length > 2;

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => close()}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} />
        <Animated.View
          style={[
            styles.card,
            {
              opacity: anim,
              transform: [
                {
                  scale: anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.9, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <Text style={styles.title}>{cfg.title}</Text>
          {cfg.message ? <Text style={styles.message}>{cfg.message}</Text> : null}
          <View style={[styles.btnRow, stacked && styles.btnCol]}>
            {buttons.map((b, i) => {
              const cancel = b.style === 'cancel';
              const destructive = b.style === 'destructive';
              return (
                <Pressable
                  key={`${b.text}-${i}`}
                  onPress={() => close(b.onPress)}
                  style={({ pressed }) => [
                    styles.btn,
                    stacked ? styles.btnStacked : styles.btnInline,
                    cancel
                      ? styles.btnCancel
                      : destructive
                        ? styles.btnDestructive
                        : styles.btnDefault,
                    pressed && { opacity: 0.85 },
                  ]}
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      styles.btnText,
                      cancel
                        ? styles.btnTextCancel
                        : destructive
                          ? styles.btnTextDestructive
                          : styles.btnTextDefault,
                    ]}
                  >
                    {b.text}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    ...shadows.sheet,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    color: colors.textPrimary,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  message: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  btnRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  btnCol: {
    flexDirection: 'column-reverse',
  },
  btn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: radius.lg,
  },
  btnInline: { flex: 1 },
  btnStacked: { width: '100%' },
  btnDefault: { backgroundColor: colors.coral },
  btnDestructive: { backgroundColor: colors.coral },
  btnCancel: { backgroundColor: colors.cream },
  btnText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15,
  },
  btnTextDefault: { color: colors.textInverse },
  btnTextDestructive: { color: colors.textInverse },
  btnTextCancel: { color: colors.textPrimary },
});
