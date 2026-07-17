import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { appAlert } from './AppDialog';
import {
  Animated,
  Easing,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  colors,
  fontFamilies,
  radius,
  spacing,
  typography,
} from '@/theme';

// Replacement for the system appAlert() dialog. Bottom-sheet modal with
// an icon halo, branded gradient header, and animated entrance. One-button
// (acknowledge) and two-button (cancel + confirm) shapes both supported.
//
// Usage:
//   const sheet = useBrandSheet();
//   sheet.confirm({
//     title: 'Sign out?',
//     body: '...',
//     destructive: true,
//     confirmLabel: 'Sign out',
//     onConfirm: () => dispatch(...),
//   });

type Tone = 'neutral' | 'destructive' | 'success' | 'warning';

type SheetButton = {
  label: string;
  onPress?: () => void;
  destructive?: boolean;
  primary?: boolean;
};

export type SheetConfig = {
  title: string;
  body?: string;
  tone?: Tone;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  buttons?: SheetButton[];
};

type ConfirmOpts = {
  title: string;
  body?: string;
  cancelLabel?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
};

type NotifyOpts = {
  title: string;
  body?: string;
  tone?: Tone;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  acknowledgeLabel?: string;
};

type SheetContext = {
  show: (config: SheetConfig) => void;
  confirm: (opts: ConfirmOpts) => void;
  notify: (opts: NotifyOpts) => void;
  hide: () => void;
};

const Ctx = createContext<SheetContext | null>(null);

export function useBrandSheet(): SheetContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useBrandSheet must be used inside BrandSheetProvider');
  return ctx;
}

// Flat tone-driven icon backdrop. Solid surface tinted by tone — no
// gradient, no halo.
const TONE_BG: Record<Tone, string> = {
  neutral: colors.surface,
  destructive: '#FFEFEF',
  success: '#E8F7EE',
  warning: '#FFF7E6',
};

const TONE_ICON_COLOR: Record<Tone, string> = {
  neutral: colors.primary,
  destructive: colors.error,
  success: colors.success,
  warning: '#B45309',
};

const DEFAULT_TONE_ICON: Record<Tone, React.ComponentProps<typeof Ionicons>['name']> = {
  neutral: 'information-circle',
  destructive: 'alert-circle',
  success: 'checkmark-circle',
  warning: 'warning',
};

export function BrandSheetProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<SheetConfig | null>(null);
  const [visible, setVisible] = useState(false);
  const insets = useSafeAreaInsets();

  const slide = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  // Finger-following drag offset (downward, >= 0). Combined with the open
  // animation so the sheet tracks the thumb and bounces back on release.
  const drag = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      drag.setValue(0);
      Animated.parallel([
        // Spring entrance for a soft overshoot/settle (Apple Maps feel).
        Animated.spring(slide, {
          toValue: 1,
          useNativeDriver: true,
          friction: 9,
          tension: 70,
        }),
        Animated.timing(fade, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      slide.setValue(0);
      fade.setValue(0);
      drag.setValue(0);
    }
  }, [visible, slide, fade, drag]);

  const hide = useCallback(() => {
    Animated.parallel([
      Animated.timing(slide, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setVisible(false);
      setConfig(null);
    });
  }, [slide, fade]);

  // Drag-to-dismiss: slide the sheet down past a threshold to close.
  const dismissByDrag = useCallback(() => {
    Animated.parallel([
      Animated.timing(drag, { toValue: 520, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(fade, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      setVisible(false);
      setConfig(null);
      drag.setValue(0);
      slide.setValue(0);
    });
  }, [drag, fade, slide]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        drag.setValue(Math.max(0, g.dy));
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 0.8) {
          dismissByDrag();
        } else {
          Animated.spring(drag, { toValue: 0, useNativeDriver: true, friction: 7, tension: 90 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(drag, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
      },
    }),
  ).current;

  const show = useCallback((next: SheetConfig) => {
    setConfig(next);
    setVisible(true);
  }, []);

  const confirm = useCallback(
    (opts: ConfirmOpts) => {
      const tone: Tone = opts.destructive ? 'destructive' : 'neutral';
      show({
        title: opts.title,
        body: opts.body,
        tone,
        icon: opts.icon ?? DEFAULT_TONE_ICON[tone],
        buttons: [
          { label: opts.cancelLabel ?? 'Cancel', onPress: opts.onCancel },
          {
            label: opts.confirmLabel ?? 'Confirm',
            onPress: opts.onConfirm,
            destructive: !!opts.destructive,
            primary: true,
          },
        ],
      });
    },
    [show],
  );

  const notify = useCallback(
    (opts: NotifyOpts) => {
      const tone: Tone = opts.tone ?? 'neutral';
      show({
        title: opts.title,
        body: opts.body,
        tone,
        icon: opts.icon ?? DEFAULT_TONE_ICON[tone],
        buttons: [
          { label: opts.acknowledgeLabel ?? 'OK', primary: true },
        ],
      });
    },
    [show],
  );

  const value = useMemo(
    () => ({ show, confirm, notify, hide }),
    [show, confirm, notify, hide],
  );

  const tone: Tone = config?.tone ?? 'neutral';
  const openTranslate = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [18, 0],
  });
  // Combine the open animation with the live finger drag.
  const translateY = Animated.add(openTranslate, drag);

  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal
        visible={visible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={hide}
      >
        <Animated.View style={[styles.backdrop, { opacity: fade }]}>
          <BlurView intensity={22} tint="dark" style={StyleSheet.absoluteFill} />
          <Pressable style={styles.backdropTap} onPress={hide} />
          <Animated.View
            style={[
              styles.sheet,
              { opacity: fade, transform: [{ translateY }, { scale: fade.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] },
            ]}
          >
            <Pressable style={styles.closeBtn} hitSlop={10} onPress={hide} accessibilityLabel="Close">
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </Pressable>
            {config?.icon ? (
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: TONE_BG[tone] },
                ]}
              >
                <Ionicons
                  name={config.icon}
                  size={36}
                  color={TONE_ICON_COLOR[tone]}
                />
              </View>
            ) : null}
            <Text style={styles.title}>{config?.title}</Text>
            {config?.body ? <Text style={styles.body}>{config.body}</Text> : null}
            <View style={styles.buttonRow}>
              {(config?.buttons ?? [{ label: 'OK', primary: true }])
                // Primary/destructive on top, plain secondary (cancel) below.
                .slice()
                .sort((a, b) => (a.primary || a.destructive ? 0 : 1) - (b.primary || b.destructive ? 0 : 1))
                .map((btn, idx) => (
                  <SheetButtonView
                    key={idx}
                    button={btn}
                    onTap={() => {
                      hide();
                      btn.onPress?.();
                    }}
                  />
                ))}
            </View>
          </Animated.View>
        </Animated.View>
      </Modal>
    </Ctx.Provider>
  );
}

function SheetButtonView({
  button,
  onTap,
  flex,
}: {
  button: SheetButton;
  onTap: () => void;
  flex?: number;
}) {
  const press = useRef(new Animated.Value(1)).current;
  const pressIn = () =>
    Animated.spring(press, {
      toValue: 0.95,
      speed: 40,
      bounciness: 0,
      useNativeDriver: true,
    }).start();
  const pressOut = () =>
    Animated.spring(press, {
      toValue: 1,
      speed: 30,
      bounciness: 8,
      useNativeDriver: true,
    }).start();

  const isPrimary = button.primary;
  const isDestructive = button.destructive;

  const containerStyle = [
    styles.btn,
    isPrimary && (isDestructive ? styles.btnDestructive : styles.btnPrimary),
    !isPrimary && styles.btnSecondary,
    flex != null && { flex },
  ];

  return (
    <Animated.View
      style={[
        flex != null ? { flex } : null,
        { transform: [{ scale: press }] },
      ]}
    >
      <Pressable
        onPress={onTap}
        onPressIn={pressIn}
        onPressOut={pressOut}
        style={containerStyle}
        accessibilityRole="button"
      >
        <Text
          style={[
            styles.btnLabel,
            isPrimary && styles.btnLabelPrimary,
            !isPrimary && styles.btnLabelSecondary,
          ]}
        >
          {button.label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    // Lighter scrim — the BlurView behind does the heavy lifting now.
    backgroundColor: 'rgba(20,18,30,0.30)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  backdropTap: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    width: '100%',
    maxWidth: 350,
    backgroundColor: colors.surface,
    borderRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 18,
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
    zIndex: 2,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 20,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    fontSize: 14,
    paddingHorizontal: spacing.sm,
  },
  buttonRow: {
    flexDirection: 'column',
    gap: spacing.sm,
    marginTop: spacing.md,
    alignSelf: 'stretch',
  },
  btn: {
    width: '100%',
    minHeight: 50,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  btnPrimary: {
    backgroundColor: colors.primary,
  },
  btnDestructive: {
    backgroundColor: colors.error,
  },
  btnSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    letterSpacing: 0.4,
  },
  btnLabelPrimary: {
    color: colors.textInverse,
  },
  btnLabelSecondary: {
    color: colors.textPrimary,
  },
});
