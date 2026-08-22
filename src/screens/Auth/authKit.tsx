import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fontFamilies } from '@/theme';

/**
 * The auth screens' shared kit, matching the onboarding it follows.
 *
 * Onboarding and sign-in are one continuous experience: she taps "Allow &
 * finish" and lands here two hundred milliseconds later. If the type, the
 * button shape or the field styling changes across that boundary it reads as
 * two apps stitched together, and that is exactly the moment a safety product
 * cannot afford to look improvised.
 *
 * So: same Poppins, same 28pt black pill, same near-black ink, same centred
 * heading. What changes is the ground — white here rather than lilac, because
 * these screens are work rather than story, and a form on a decorated
 * background is harder to read.
 */

export const A = {
  ink: '#141527',
  body: '#6B6B7B',
  field: '#FFFFFF',
  fieldBorder: '#E6E4EE',
  fieldText: '#141527',
  placeholder: '#A8A6B8',
  btn: '#141527',
  btnText: '#FFFFFF',
  /** The social row's orchid, straight from the reference. */
  social: '#D98FE0',
  socialPressed: '#CB7ED3',
  divider: '#E6E4EE',
  link: '#141527',
};

/** Screen heading: back chevron, centred title. */
export function AuthHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <View style={s.header}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={14} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={23} color={A.ink} />
        </Pressable>
      ) : (
        <View style={{ width: 23 }} />
      )}
      <Text style={s.headerTitle}>{title}</Text>
      <View style={{ width: 23 }} />
    </View>
  );
}

/**
 * A social sign-in row. Orchid pill, brand glyph on the left, label centred.
 *
 * The reference centres the label rather than left-aligning it beside the icon,
 * which is unusual and is most of why the row reads as a button rather than a
 * list item. Kept.
 */
export function SocialButton({
  label,
  icon,
  onPress,
  busy,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  busy?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [s.social, pressed && { backgroundColor: A.socialPressed }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={s.socialIcon}>{busy ? <ActivityIndicator color="#fff" size="small" /> : icon}</View>
      <Text style={s.socialLabel}>{label}</Text>
    </Pressable>
  );
}

/** "Or continue with email" — a rule either side of small grey text. */
export function OrDivider({ label }: { label: string }) {
  return (
    <View style={s.divRow}>
      <View style={s.divLine} />
      <Text style={s.divText}>{label}</Text>
      <View style={s.divLine} />
    </View>
  );
}

/** Labelled field. Label sits above, left-aligned, as in the reference. */
export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize = 'none',
  ...rest
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
} & TextInputProps) {
  return (
    <View style={s.fieldWrap}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={A.placeholder}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        style={s.field}
        {...rest}
      />
    </View>
  );
}

/** The one primary action. Black pill, full width. */
export function PrimaryButton({
  label,
  onPress,
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  const off = busy || disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [s.primary, off && s.primaryOff, pressed && !off && s.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {busy ? <ActivityIndicator color={A.btnText} /> : <Text style={s.primaryText}>{label}</Text>}
    </Pressable>
  );
}

/** Secondary action. Outlined pill, same geometry. */
export function GhostButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.ghost, pressed && s.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={s.ghostText}>{label}</Text>
    </Pressable>
  );
}

/** "Don't have an account? Register" */
export function FootLink({
  text,
  actionLabel,
  onPress,
}: {
  text: string;
  actionLabel: string;
  onPress: () => void;
}) {
  return (
    <View style={s.footRow}>
      <Text style={s.footText}>{text} </Text>
      <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button">
        <Text style={s.footAction}>{actionLabel}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 26,
  },
  headerTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 17,
    color: A.ink,
  },

  social: {
    height: 52,
    borderRadius: 26,
    backgroundColor: A.social,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  socialIcon: { position: 'absolute', left: 20, width: 22, alignItems: 'center' },
  socialLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14.5,
    color: '#FFFFFF',
  },

  divRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 20 },
  divLine: { flex: 1, height: 1, backgroundColor: A.divider },
  divText: { fontFamily: fontFamilies.poppinsRegular, fontSize: 12.5, color: A.body },

  fieldWrap: { marginBottom: 16 },
  fieldLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13.5,
    color: A.ink,
    marginBottom: 8,
  },
  field: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: A.fieldBorder,
    backgroundColor: A.field,
    paddingHorizontal: 16,
    fontFamily: fontFamilies.poppinsRegular,
    fontSize: 14.5,
    color: A.fieldText,
  },

  primary: {
    height: 56,
    borderRadius: 28,
    backgroundColor: A.btn,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryOff: { opacity: 0.45 },
  primaryText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15.5, color: A.btnText },

  ghost: {
    height: 56,
    borderRadius: 28,
    borderWidth: 1.4,
    borderColor: A.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15.5, color: A.ink },

  footRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 18 },
  footText: { fontFamily: fontFamilies.poppinsRegular, fontSize: 13, color: A.body },
  footAction: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13, color: A.link },

  pressed: { opacity: 0.9 },
});
