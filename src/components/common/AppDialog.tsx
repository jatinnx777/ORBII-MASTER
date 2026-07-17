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
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';

// On-brand replacement for React Native's system Alert. `appAlert` mirrors the
// system alert signature exactly, so call sites can swap one for the other with
// no behaviour change — but the popup renders inside the app as a centred glass
// card: frosted backdrop, close X, an icon, a bold title, and full-width pill
// buttons. One shape for every popup in ORBII.

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
      duration: 140,
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

  const hasDestructive = buttons.some((b) => b.style === 'destructive');
  // Decorative header icon. Destructive dialogs get a warning; everything else
  // gets a calm brand mark. (appAlert has no icon param, so this is inferred.)
  const icon = hasDestructive ? 'alert-circle' : 'shield-checkmark';
  const iconTint = hasDestructive ? colors.coralDeep : colors.brandDeep;
  const iconBg = hasDestructive ? colors.coralSoft : colors.brandSoft;

  return (
    <Modal transparent visible statusBarTranslucent onRequestClose={() => close()}>
      <View style={styles.backdrop}>
        <BlurView intensity={22} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.scrim} />
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} />

        <Animated.View
          style={[
            styles.card,
            {
              opacity: anim,
              transform: [
                { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
                { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
              ],
            },
          ]}
        >
          <Pressable style={styles.closeBtn} hitSlop={10} onPress={() => close()} accessibilityLabel="Close">
            <Ionicons name="close" size={18} color={colors.textSecondary} />
          </Pressable>

          <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
            <Ionicons name={icon} size={30} color={iconTint} />
          </View>

          <Text style={styles.title}>{cfg.title}</Text>
          {cfg.message ? <Text style={styles.message}>{cfg.message}</Text> : null}

          <View style={styles.btns}>
            {[...buttons]
              // Primary/destructive on top, cancel below — like the reference.
              .sort((a, b) => (a.style === 'cancel' ? 1 : 0) - (b.style === 'cancel' ? 1 : 0))
              .map((b, i) => {
                const cancel = b.style === 'cancel';
                const destructive = b.style === 'destructive';
                return (
                  <Pressable
                    key={`${b.text}-${i}`}
                    onPress={() => close(b.onPress)}
                    style={({ pressed }) => [
                      styles.btn,
                      cancel ? styles.btnCancel : destructive ? styles.btnDestructive : styles.btnDefault,
                      pressed && { opacity: 0.9 },
                    ]}
                    accessibilityRole="button"
                  >
                    <Text
                      style={[
                        styles.btnText,
                        cancel ? styles.btnTextCancel : styles.btnTextInverse,
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
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(20,20,30,0.34)' },
  card: {
    width: '100%',
    maxWidth: 350,
    backgroundColor: colors.surface,
    borderRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    alignItems: 'center',
    ...shadows.sheet,
  },
  closeBtn: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.creamDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 19,
    color: colors.textPrimary,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  message: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  btns: { width: '100%', gap: spacing.sm, marginTop: spacing.lg },
  btn: { width: '100%', alignItems: 'center', justifyContent: 'center', paddingVertical: 15, borderRadius: radius.pill },
  btnDefault: { backgroundColor: colors.brand },
  btnDestructive: { backgroundColor: colors.coral },
  btnCancel: { backgroundColor: 'transparent' },
  btnText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15 },
  btnTextInverse: { color: colors.textInverse },
  btnTextCancel: { color: colors.textSecondary },
});
