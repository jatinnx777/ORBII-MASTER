// Two-track palette, aligned to the ORBII premium design spec:
//
// • BRAND (calm) → mint. Everyday voice of the app — tabs, headers,
//   confirmations, "all good" states. Used on Home, Circles, Safety,
//   Settings, Membership.
//
// • PRIMARY (alarm) → red. Reserved for SOS / emergencies / errors.
//   We keep the historical name `primary` pointing at red so existing
//   call sites that mean "emergency action" don't have to change.
//
// Background is a soft warm white (#F7FAF8) that pairs cleanly with the
// mint. Borders are a near-invisible rgba(0,0,0,0.05) so cards feel
// soft and grounded rather than line-art.
export const colors = {
  // Primary mint per spec (#57C691). brandSoft is the wash used for card
  // chips + tinted backgrounds; brandMid is the secondary mint per spec;
  // brandDeep is the CTA / pressed accent.
  brand: '#57C691',
  brandSoft: '#E2F4EB',
  brandMid: '#AEE8CC',
  brandDeep: '#1E8E5A',

  // Alarm — SOS only. Per spec #FF4D4D.
  primary: '#FF4D4D',

  secondary: '#FFFFFF',
  dark: '#0F1115',
  // Spec-aligned success mint (#2FBF71) — used for "all clear" badges.
  success: '#2FBF71',
  warning: '#F59E0B',

  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  textInverse: '#FFFFFF',

  background: '#F7FAF8',
  surface: '#FFFFFF',
  // Near-invisible 5% black; lets cards read as "lifted off the page"
  // without harsh strokes.
  border: 'rgba(0,0,0,0.05)',
  inputBorder: 'rgba(0,0,0,0.06)',
  inputBackground: '#F7FAF8',

  error: '#FF4D4D',
  overlay: 'rgba(0, 0, 0, 0.55)',

  // Legacy aliases — kept so old imports compile. Prefer canonical names.
  primaryDeep: '#D63A3A',
  accent: '#57C691',
  darkSoft: '#0F1115',
  surfaceMuted: '#E2F4EB',
} as const;

export type ColorKey = keyof typeof colors;
