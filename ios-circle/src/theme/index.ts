// The same tokens the main ORBII app reads, so the two apps look like one
// company rather than two projects that happen to share a name.
//
// Fonts are deliberately NOT copied across. ORBII bundles Poppins and Inter as
// assets; this app uses the platform faces (San Francisco on iOS, Roboto on
// Android) until the type is worth the download. A circle app is opened in a
// panic and read once, so a fast cold start matters more than a brand face.
export { colors } from './colors';
export { spacing, radius, touchTarget, shadows, glass } from './spacing';

import { Platform } from 'react-native';

export const fonts = {
  regular: Platform.select({ ios: 'System', default: 'sans-serif' }) as string,
  medium: Platform.select({ ios: 'System', default: 'sans-serif-medium' }) as string,
  bold: Platform.select({ ios: 'System', default: 'sans-serif' }) as string,
};

export const weight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};
