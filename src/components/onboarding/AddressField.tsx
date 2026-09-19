import React from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, fontFamilies, radius } from '@/theme';

/**
 * One field of the home address form, in the shape the reference uses.
 *
 * Three parts, stacked, and each earns its place:
 *
 *   - A tall filled box with the label AS the placeholder. No floating label,
 *     no caption above. The box is quiet until you touch it.
 *   - An example underneath, in grey, showing a real address rather than a
 *     format string. "E.g.: 12 MG Road, near Axis Bank" tells somebody what to
 *     type; "<street>, <landmark>" does not.
 *   - A character count on the right, but ONLY where a limit exists. A counter
 *     under a field with no limit is an instruction to worry about nothing.
 *
 * The example and the counter share one row, which is what stops the form
 * turning into a column of stacked grey sentences.
 */
export function AddressField({
  hint,
  max,
  value,
  style,
  ...props
}: TextInputProps & { hint?: string; max?: number; value: string }) {
  const [focused, setFocused] = React.useState(false);
  return (
    <View style={style}>
      <View style={[s.box, focused && s.boxOn]}>
        <TextInput
          {...props}
          value={value}
          maxLength={max}
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
      {hint || max ? (
        <View style={s.under}>
          <Text style={s.hint} numberOfLines={2}>
            {hint ?? ''}
          </Text>
          {max ? (
            <Text style={s.count}>
              {value.length}/{max}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  // 64pt and a soft fill. Big enough that a thumb never misses it, and quiet
  // enough that four of them stacked do not read as a wall of boxes.
  box: {
    height: 64,
    borderRadius: radius.md,
    backgroundColor: '#ECEAE4',
    paddingHorizontal: 18,
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  boxOn: { borderColor: colors.brand, backgroundColor: '#E6E3DC' },
  input: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 17.5,
    color: colors.textPrimary,
    padding: 0,
  },
  under: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 7,
    paddingHorizontal: 4,
  },
  hint: {
    flex: 1,
    fontFamily: fontFamilies.interRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
  },
  count: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
  },
});
