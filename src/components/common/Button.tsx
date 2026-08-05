import React, { ReactNode, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { colors, radius, spacing, typography } from '@/theme';

type Variant = 'primary' | 'danger' | 'secondary' | 'outline' | 'ghost';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  /** Optional element rendered to the right of the label (e.g. an arrow icon). */
  icon?: ReactNode;
  style?: ViewStyle;
  testID?: string;
};

/**
 * The ORBII CTA. `primary` is the warm peach pill seen on every screen
 * (Get Started / Continue / Next). `danger` is the coral alarm button
 * (SOS / Call 112). All variants are fully-rounded pills.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  fullWidth = true,
  icon,
  style,
  testID,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const press = useRef(new Animated.Value(1)).current;
  const containerStyle = [
    styles.base,
    styles[variant],
    fullWidth && styles.fullWidth,
    isDisabled && styles.disabled,
    style,
  ];
  const textStyle: TextStyle[] = [styles.baseText, textStyles[variant]];

  const animateTo = (toValue: number) => {
    Animated.spring(press, {
      toValue,
      useNativeDriver: true,
      speed: 40,
      bounciness: 6,
    }).start();
  };

  return (
    <Animated.View
      style={[fullWidth && styles.fullWidth, { transform: [{ scale: press }] }]}
    >
      <Pressable
        testID={testID}
        onPress={onPress}
        onPressIn={() => !isDisabled && animateTo(0.96)}
        onPressOut={() => animateTo(1)}
        android_ripple={{ color: 'rgba(0,0,0,0.06)', borderless: false }}
        disabled={isDisabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        style={containerStyle}
      >
        {loading ? (
          <ActivityIndicator
            color={
              variant === 'danger' || variant === 'primary'
                ? colors.textInverse
                : colors.textPrimary
            }
          />
        ) : (
          <View style={styles.content}>
            <Text style={textStyle}>{label}</Text>
            {icon ? <View style={styles.icon}>{icon}</View> : null}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    marginLeft: spacing.sm,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  primary: {
    backgroundColor: colors.peach,
    shadowColor: colors.peachDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 3,
  },
  danger: {
    backgroundColor: colors.coral,
    shadowColor: colors.coral,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.26,
    shadowRadius: 18,
    elevation: 3,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.peachDeep,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  disabled: {
    opacity: 0.45,
  },
  baseText: {
    ...typography.button,
    textAlign: 'center',
  },
});

const textStyles: Record<Variant, TextStyle> = {
  primary: { color: colors.textInverse },
  danger: { color: colors.textInverse },
  secondary: { color: colors.textPrimary },
  outline: { color: colors.textPrimary },
  ghost: { color: colors.textSecondary },
};
