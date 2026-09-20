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

/**
 * The auth flow's tokens, now the SAME ones the onboarding steps use.
 *
 * This kit used to carry its own palette: white fields with grey borders and a
 * near-black button. That made the auth screens a third design language, so
 * signing in, setting up a profile and first run each looked like a different
 * product, and the join between them is exactly where a new user is deciding
 * whether this thing is serious.
 *
 * Changing them here changes every auth screen at once: sign in, login, phone
 * sign-in, phone verify and profile setup.
 */
export const A = {
  ink: '#17161C',
  body: '#6B6560',
  /** Filled, not outlined. A border round every field is four rectangles
   *  competing with the heading; a soft fill is quiet until you touch it. */
  field: '#ECEAE4',
  fieldBorder: 'transparent',
  fieldText: '#17161C',
  placeholder: '#9A948C',
  /** ORBII lavender, not near-black. */
  btn: '#6E58B6',
  btnText: '#FFFFFF',
  /** The social row's orchid, straight from the reference. */
  social: '#D98FE0',
  socialPressed: '#CB7ED3',
  divider: 'rgba(23,22,28,0.08)',
  link: '#6E58B6',
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
  // 64pt and 17.5pt text, matching the onboarding fields. The old 52/14.5 was
  // small enough that a thumb aimed at it hit the label above as often as the
  // box, and it read as a form rather than a question.
  field: {
    height: 64,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: A.fieldBorder,
    backgroundColor: A.field,
    paddingHorizontal: 18,
    fontFamily: fontFamilies.interRegular,
    fontSize: 17.5,
    color: A.fieldText,
  },

  primary: {
    height: 62,
    borderRadius: 999,
    backgroundColor: A.btn,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A pale tint of the same colour rather than a faded dark slab, so a button
  // that is not ready yet never reads as a button that is broken.
  primaryOff: { backgroundColor: '#D9D0F0' },
  primaryText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 17.5, color: A.btnText },

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
