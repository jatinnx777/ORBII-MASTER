import React, { useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { colors, fontFamilies, spacing } from '@/theme';

/**
 * The three controls the onboarding is built out of: a pill button, a pill
 * field, and a row of code boxes.
 *
 * WHY FULLY ROUNDED AND NOT THE APP'S USUAL RADIUS. Onboarding is the only
 * place in ORBII where a person is being asked questions rather than shown
 * their own information, and it should feel different from the app they are
 * about to be inside. A fully rounded control reads as conversational; the
 * squarer radius used everywhere else reads as a form.
 *
 * WHY NEAR-BLACK AND NOT THE BRAND COLOUR. There is exactly one action per
 * screen and it should be unmissable against a pale drifting ground. Lavender
 * on cream is pleasant and low contrast, which is right for a button competing
 * with other content and wrong for the only button on the page. The brand
 * shows up in the ground behind it instead.
 */

const PRESS_MS = 110;
const EASE = Easing.bezier(0.23, 1, 0.32, 1);

export function PillButton({
  label,
  onPress,
  disabled,
  busy,
  tone = 'solid',
  style,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** `quiet` is the secondary action: same shape, no fill, no competition. */
  tone?: 'solid' | 'quiet';
  style?: StyleProp<ViewStyle>;
}) {
  const scale = useRef(new Animated.Value(0)).current;
  const to = (down: boolean) =>
    Animated.timing(scale, {
      toValue: down ? 1 : 0,
      duration: PRESS_MS,
      easing: EASE,
      useNativeDriver: true,
    }).start();

  const off = !!disabled || !!busy;
  const solid = tone === 'solid';

  return (
    <Animated.View
      style={[
        { transform: [{ scale: scale.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] }) }] },
        style,
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={() => to(true)}
        onPressOut={() => to(false)}
        disabled={off}
        accessibilityRole="button"
        accessibilityState={{ disabled: off, busy: !!busy }}
        accessibilityLabel={label}
        style={[
          s.pill,
          solid ? s.pillSolid : s.pillQuiet,
          off && (solid ? s.pillSolidOff : s.pillQuietOff),
        ]}
      >
        {busy ? (
          <ActivityIndicator color={solid ? colors.cream : colors.textPrimary} />
        ) : (
          <Text style={[s.pillText, solid ? s.pillTextSolid : s.pillTextQuiet, off && s.pillTextOff]}>
            {label}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

export function PillInput({
  prefix,
  style,
  ...props
}: TextInputProps & { prefix?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const [focused, setFocused] = React.useState(false);
  return (
    <View style={[s.field, focused && s.fieldOn, style]}>
      {prefix ? <View style={s.prefix}>{prefix}</View> : null}
      <TextInput
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        placeholderTextColor={colors.textMuted}
        style={s.input}
      />
    </View>
  );
}

/**
 * The verification code, as separate round boxes.
 *
 * ONE HIDDEN INPUT, NOT SIX. Six real fields means six refs, focus juggling,
 * and a backspace that has to guess which box it belongs to, and it breaks the
 * moment a password manager pastes the whole code at once. This renders boxes
 * and puts a single transparent input across all of them, so paste, autofill
 * and backspace are all just text editing and none of them are special cases.
 */
export function CodeBoxes({
  value,
  onChange,
  length = 6,
  autoFocus,
  secure,
}: {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  autoFocus?: boolean;
  /**
   * Render a filled dot instead of the character. For a PIN, which is the one
   * code here that is a secret rather than a one-time token: an emailed code
   * is worthless to anyone reading over her shoulder, and a PIN is not.
   */
  secure?: boolean;
}) {
  const ref = useRef<TextInput>(null);
  const chars = value.split('');

  // Sized from the count, not fixed. Supabase issues an EIGHT digit code on
  // this project, and eight boxes at the six-box width overflow a phone. A
  // reference design showing six is a layout, not a spec: the number of boxes
  // has to come from the code the server actually sends, and getting that
  // wrong once already made signup impossible.
  const box = length > 6 ? 36 : 46;
  const gap = length > 6 ? 6 : 10;

  return (
    <Pressable onPress={() => ref.current?.focus()} style={[s.boxRow, { gap }]} accessibilityRole="none">
      {Array.from({ length }).map((_, i) => {
        const filled = i < chars.length;
        // The box the next character lands in, so there is somewhere obvious
        // for the eye to be while typing.
        const next = i === chars.length;
        return (
          <View
            key={i}
            style={[s.box, { width: box, borderRadius: box / 2 }, filled && s.boxFilled, next && s.boxNext]}
          >
            {secure && filled ? (
              <View style={s.dot} />
            ) : (
              <Text style={[s.boxText, length > 6 && { fontSize: 18 }]}>{chars[i] ?? ''}</Text>
            )}
          </View>
        );
      })}
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(t) => onChange(t.replace(/[^0-9A-Za-z]/g, '').slice(0, length).toUpperCase())}
        maxLength={length}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        secureTextEntry={secure}
        textContentType={secure ? 'password' : 'oneTimeCode'}
        autoComplete={secure ? 'off' : 'one-time-code'}
        accessibilityLabel={`Verification code, ${chars.length} of ${length} entered`}
        // Transparent and stretched over the boxes rather than hidden off
        // screen: an input at left:-1000 stops receiving autofill on Android.
        style={s.hidden}
        caretHidden
      />
    </Pressable>
  );
}

const s = StyleSheet.create({
  pill: {
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  pillSolid: { backgroundColor: colors.textPrimary },
  pillSolidOff: { backgroundColor: 'rgba(23,22,28,0.22)' },
  pillQuiet: { backgroundColor: 'transparent' },
  pillQuietOff: { opacity: 0.4 },
  pillText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 16 },
  pillTextSolid: { color: colors.cream },
  pillTextQuiet: { color: colors.textSecondary },
  pillTextOff: { color: colors.cream },

  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    borderWidth: 1.5,
    borderColor: 'transparent',
    // The soft lift is what separates a white pill from a drifting pale
    // background. Without it the field disappears into the ground.
    shadowColor: '#17161C',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  fieldOn: { borderColor: colors.brandDeep },
  prefix: { flexDirection: 'row', alignItems: 'center' },
  input: {
    flex: 1,
    fontFamily: fontFamilies.interMedium,
    fontSize: 17,
    color: colors.textPrimary,
    paddingVertical: 14,
  },

  boxRow: { flexDirection: 'row', justifyContent: 'center' },
  box: {
    height: 56,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
    shadowColor: '#17161C',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  boxFilled: { borderColor: 'rgba(110,88,182,0.28)' },
  boxNext: { borderColor: colors.brandDeep },
  boxText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 21,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  dot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: colors.textPrimary,
  },
  hidden: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0,
    fontSize: 1,
  },
});
