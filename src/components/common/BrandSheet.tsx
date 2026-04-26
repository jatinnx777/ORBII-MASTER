import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import {
  colors,
  fontFamilies,
  radius,
  spacing,
  typography,
} from '@/theme';

// Replacement for the system Alert.alert() dialog. Bottom-sheet modal with
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

// Tone-driven colour palette for the icon halo. Keeps the gradient on-brand.
const TONE_GRADIENT: Record<Tone, [string, string]> = {
  neutral: ['#FFE4F0', '#E8D7FF'],
  destructive: ['#FFD9D9', '#FFB3B3'],
  success: ['#D7F8E5', '#B6F2D6'],
  warning: ['#FFEDD5', '#FFE0A6'],
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

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(slide, {
          toValue: 1,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
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
    }
  }, [visible, slide, fade]);

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
  const translateY = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [320, 0],
  });

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
          <Pressable style={styles.backdropTap} onPress={hide} />
          <Animated.View
            style={[
              styles.sheet,
              {
                paddingBottom: spacing.xl + insets.bottom,
                transform: [{ translateY }],
              },
            ]}
          >
            <View style={styles.handle} />
            {config?.icon ? (
              <LinearGradient
                colors={TONE_GRADIENT[tone]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.iconWrap}
              >
                <Ionicons
                  name={config.icon}
                  size={36}
                  color={TONE_ICON_COLOR[tone]}
                />
              </LinearGradient>
            ) : null}
            <Text style={styles.title}>{config?.title}</Text>
            {config?.body ? <Text style={styles.body}>{config.body}</Text> : null}
            <View style={styles.buttonRow}>
              {(config?.buttons ?? [{ label: 'OK', primary: true }]).map((btn, idx) => (
                <SheetButtonView
                  key={idx}
                  button={btn}
                  onTap={() => {
                    hide();
                    btn.onPress?.();
                  }}
                  flex={(config?.buttons?.length ?? 1) > 1 ? 1 : undefined}
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
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  backdropTap: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
    alignItems: 'center',
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    marginTop: 4,
    marginBottom: spacing.sm,
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
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    alignSelf: 'stretch',
  },
  btn: {
    minHeight: 48,
    borderRadius: radius.md,
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
