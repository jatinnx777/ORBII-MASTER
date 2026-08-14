import { TextStyle } from 'react-native';

export const fontFamilies = {
  poppinsBold: 'Poppins_700Bold',
  poppinsSemiBold: 'Poppins_600SemiBold',
  poppinsMedium: 'Poppins_500Medium',
  poppinsRegular: 'Poppins_400Regular',
  interRegular: 'Inter_400Regular',
  interMedium: 'Inter_500Medium',
  interLight: 'Inter_300Light',
  // Handwriting, for the founder's note / signature moments only.
  handwriting: 'Caveat_600SemiBold',
} as const;

export const typography: Record<string, TextStyle> = {
  // Hero headline — "Your Safety. Always." / "All Clear". Big, bold,
  // tight leading like the mockups.
  display: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 44,
    lineHeight: 48,
    letterSpacing: -0.5,
  },
  displaySmall: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.4,
  },
  h1: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 28,
    lineHeight: 36,
    letterSpacing: -0.3,
  },
  h2: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 24,
    lineHeight: 32,
  },
  h3: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 20,
    lineHeight: 28,
  },
  body: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 16,
    lineHeight: 24,
  },
  bodyMedium: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 16,
    lineHeight: 24,
  },
  caption: {
    fontFamily: fontFamilies.interLight,
    fontSize: 12,
    lineHeight: 16,
  },
  button: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 16,
    lineHeight: 20,
  },
  label: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 14,
    lineHeight: 20,
  },
};
