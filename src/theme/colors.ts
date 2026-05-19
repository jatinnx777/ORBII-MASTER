// Single-brand palette. ORBII has exactly one accent colour — the mint
// (#57C691). Everything that previously varied (success badges, the
// secondary mint, the legacy `accent` alias) now resolves to one of four
// brand tones so the app reads as ONE consistent product.
//
// • BRAND          (#57C691) — the colour of ORBII. Default for chips,
//                              dots, active states, "all good" badges.
// • brandSoft       — wash for tinted card backgrounds.
// • brandMid        — secondary mint per spec; subtle borders + accents.
// • brandDeep       — high-contrast CTA / pressed state.
// • PRIMARY (#FF4D4D) — alarm. SOS only. Never used for non-emergency UI.
export const colors = {
  brand: '#57C691',
  brandSoft: '#E2F4EB',
  brandMid: '#AEE8CC',
  brandDeep: '#1E8E5A',

  // Alarm — SOS / errors only. Never used for confirmations.
  primary: '#FF4D4D',

  secondary: '#FFFFFF',
  dark: '#0F1115',
  // `success` is intentionally identical to `brand` so any "OK / all
  // clear" UI inherits the official ORBII colour automatically. Don't
  // introduce a separate green elsewhere — use `brand`.
  success: '#57C691',
  warning: '#F59E0B',

  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  textInverse: '#FFFFFF',

  background: '#F7FAF8',
  surface: '#FFFFFF',
  border: 'rgba(0,0,0,0.05)',
  inputBorder: 'rgba(0,0,0,0.06)',
  inputBackground: '#F7FAF8',

  error: '#FF4D4D',
  overlay: 'rgba(0, 0, 0, 0.55)',

  // Legacy aliases — kept ONLY so old imports compile. All resolve to
  // the official mint so any straggling call site automatically picks
  // up the brand colour. Prefer canonical names in new code.
  primaryDeep: '#D63A3A',
  accent: '#57C691',
  darkSoft: '#0F1115',
  surfaceMuted: '#E2F4EB',
} as const;

export type ColorKey = keyof typeof colors;
