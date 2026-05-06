// Two-track palette:
//
// • BRAND (calm) → light green. This is the everyday voice of the app —
//   tabs, headers, confirmations, "all good" states. Defaults the user
//   sees on the Home, Safety, Settings, Membership tabs.
//
// • PRIMARY (alarm) → red. Reserved for SOS / emergencies / errors.
//   We keep the historical name `primary` pointing at red so existing
//   call sites that mean "emergency action" don't have to change.
//
// Background is a soft white that pairs cleanly with the green brand.
export const colors = {
  // Calm brand — Life360-grade soft mint. brandSoft is the wash colour
  // used for surfaces; brand is the signature mid-mint; brandDeep is the
  // CTA / pressed accent.
  brand: '#95D5B2',
  brandSoft: '#DDF8E8',
  brandMid: '#B7EFC5',
  brandDeep: '#56C596',

  // Alarm — SOS only
  primary: '#FF3B30',

  secondary: '#FFFFFF',
  dark: '#0F1115',
  success: '#16A34A',
  warning: '#F59E0B',

  textPrimary: '#0F1115',
  textSecondary: '#5C6168',
  textMuted: '#9AA0A6',
  textInverse: '#FFFFFF',

  background: '#F8FCFA',
  surface: '#F0F7F3',
  border: '#E5EDE8',
  inputBorder: '#D8E0DB',
  inputBackground: '#FAFCFB',

  error: '#FF3B30',
  overlay: 'rgba(0, 0, 0, 0.55)',

  // Legacy aliases — kept so old imports compile. Prefer canonical names.
  primaryDeep: '#CC2A22',
  accent: '#56C596',
  darkSoft: '#0F1115',
  surfaceMuted: '#E8F2EC',
} as const;

export type ColorKey = keyof typeof colors;
