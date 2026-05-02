// 3-color core palette: Primary red (emergencies only), neutral dark/light
// surfaces, success green for connected/helper states. No pastels, no
// accent yellow, no decorative tones. Keeping a few legacy aliases pointed
// at the canonical colours so existing references compile without churn.
export const colors = {
  primary: '#FF3B30',
  secondary: '#FFFFFF',
  dark: '#0F1115',
  success: '#16A34A',
  warning: '#F59E0B',

  textPrimary: '#0F1115',
  textSecondary: '#5C6168',
  textMuted: '#9AA0A6',
  textInverse: '#FFFFFF',

  background: '#FFFFFF',
  surface: '#F4F5F7',
  border: '#E5E7EB',
  inputBorder: '#D5D7DC',
  inputBackground: '#FAFAFB',

  error: '#FF3B30',
  overlay: 'rgba(0, 0, 0, 0.55)',

  // Legacy aliases — kept so old imports compile. Prefer canonical names.
  primaryDeep: '#CC2A22',
  accent: '#FF3B30',
  darkSoft: '#0F1115',
  surfaceMuted: '#EDEEF1',
} as const;

export type ColorKey = keyof typeof colors;
