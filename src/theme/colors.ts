export const colors = {
  primary: '#FF0000',
  secondary: '#FFFFFF',
  accent: '#FFD700',
  dark: '#2C2C2C',
  success: '#00C853',
  warning: '#FFC107',

  textPrimary: '#2C2C2C',
  textSecondary: '#6B6B6B',
  textMuted: '#9B9B9B',
  textInverse: '#FFFFFF',

  background: '#FFFFFF',
  surface: '#F7F7F7',
  border: '#E5E5E5',
  inputBorder: '#D0D0D0',
  inputBackground: '#FAFAFA',

  error: '#D32F2F',
  overlay: 'rgba(0, 0, 0, 0.5)',
} as const;

export type ColorKey = keyof typeof colors;
