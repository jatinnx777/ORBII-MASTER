export const colors = {
  primary: '#E11D2A',
  primaryDeep: '#A30D17',
  secondary: '#FFFFFF',
  accent: '#FFD700',
  dark: '#0F1115',
  darkSoft: '#1A1D24',
  success: '#16A34A',
  warning: '#F59E0B',

  textPrimary: '#0F1115',
  textSecondary: '#5C6168',
  textMuted: '#9AA0A6',
  textInverse: '#FFFFFF',

  background: '#FFFFFF',
  surface: '#F4F5F7',
  surfaceMuted: '#EDEEF1',
  border: '#E5E7EB',
  inputBorder: '#D5D7DC',
  inputBackground: '#FAFAFB',

  error: '#DC2626',
  overlay: 'rgba(0, 0, 0, 0.55)',
} as const;

export type ColorKey = keyof typeof colors;
