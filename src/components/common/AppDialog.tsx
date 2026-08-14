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
  // Small squircle glyph, like an app icon rather than a big badge. Destructive
  // dialogs read as a warning; everything else gets a calm brand mark.
  const icon = hasDestructive ? 'alert' : 'shield-checkmark';
  const iconTint = hasDestructive ? colors.coralDeep : colors.brandDeep;
  const iconBg = hasDestructive ? colors.coralSoft : colors.brandSoft;

  return (
    <Modal transparent visible statusBarTranslucent onRequestClose={() => close()}>
      <View style={styles.backdrop}>
        <BlurView intensity={16} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.scrim} />
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} />

        <Animated.View
          style={[
            styles.card,
            {
              opacity: anim,
              transform: [
                { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
                { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
              ],
            },
          ]}
        >
          <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
            <Ionicons name={icon} size={24} color={iconTint} />
          </View>

          <Text style={styles.title}>{cfg.title}</Text>
          {cfg.message ? <Text style={styles.message}>{cfg.message}</Text> : null}

          <View style={styles.btns}>
            {[...buttons]
              // Primary/destructive on top, cancel below.
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
                      pressed && styles.btnPressed,
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
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(17,16,28,0.42)' },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: 32,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(17,16,28,0.06)',
    paddingHorizontal: 24,
    paddingTop: 26,
    paddingBottom: 20,
    alignItems: 'center',
    ...shadows.sheet,
  },
  // Squircle app-icon-style glyph, not a big circular badge.
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 20,
    color: colors.textPrimary,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  message: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 4,
  },
  btns: { width: '100%', gap: 10, marginTop: 24 },
  btn: { width: '100%', alignItems: 'center', justifyContent: 'center', paddingVertical: 15, borderRadius: radius.pill },
  btnPressed: { opacity: 0.92, transform: [{ scale: 0.985 }] },
  btnDefault: { backgroundColor: colors.brand },
  btnDestructive: { backgroundColor: colors.coral },
  // Filled light pill rather than a bare text link — reads as finished, modern.
  btnCancel: { backgroundColor: colors.creamDeep },
  btnText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15.5 },
  btnTextInverse: { color: colors.textInverse },
  btnTextCancel: { color: colors.textSecondary },
});
