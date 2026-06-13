// ORBII — Warm "Guardian" palette (v27 rebrand).
//
// The whole app lives on a soft warm CREAM canvas. There are four feeling
// colours, each lifted straight from the product mockups:
//
//   • PEACH   (#F3C6A0) — the ORBII CTA. Big rounded buttons, primary actions.
//   • SAGE    (#7FA86B) — "you're safe / all clear / active". Calm green.
//   • CORAL   (#E07A5F) — SOS / alarm / emergency. Soft, never harsh red.
//   • LAVENDER(#8E7CC0) — voice trigger + trusted network accents.
//   • GOLD    (#E0AC63) — the mascot / shield / AI-protection accent.
//
// Each accent has a matching `*Soft` tint used for the round icon badges.
//
// IMPORTANT: legacy key names (brand, brandSoft, primary, success, …) are
// preserved so existing screens keep compiling — they are remapped onto the
// warm palette, so the app reads warm the instant the theme loads. New code
// should prefer the canonical names below.
export const colors = {
  // ── Canvas ────────────────────────────────────────────────
  cream: '#F4ECE3', // app background
  creamDeep: '#ECE1D2', // pressed / alt surface
  surface: '#FBF7F0', // cards
  surfaceAlt: '#FFFFFF', // pure-white insets (avatars, toggles)

  // ── Peach (primary CTA) ──────────────────────────────────
  peach: '#F3C6A0',
  peachDeep: '#E9B084',
  peachSoft: '#F9E4D2',

  // ── Sage (safe / active / all-clear) ─────────────────────
  sage: '#7FA86B',
  sageDeep: '#5E8A4D',
  sageSoft: '#E7EFDD',

  // ── Coral (SOS / alarm) ──────────────────────────────────
  coral: '#E07A5F',
  coralDeep: '#CB6549',
  coralSoft: '#F8E3DC',

  // ── Lavender (voice / trusted network) ───────────────────
  lavender: '#8E7CC0',
  lavenderDeep: '#6F5DA6',
  lavenderSoft: '#ECE7F6',

  // ── Gold (mascot / shield / AI) ──────────────────────────
  gold: '#E0AC63',
  goldDeep: '#C8924A',
  goldSoft: '#F7E9D5',

  // ── Text ─────────────────────────────────────────────────
  textPrimary: '#2D2924',
  textSecondary: '#7C7468',
  textMuted: '#A89F92',
  textInverse: '#FFFFFF',

  // ── Lines ────────────────────────────────────────────────
  border: 'rgba(45,41,36,0.06)',
  divider: 'rgba(45,41,36,0.05)',
  inputBorder: 'rgba(45,41,36,0.08)',
  inputBackground: '#F4ECE3',
  overlay: 'rgba(45, 41, 36, 0.45)',

  // ── Semantic ─────────────────────────────────────────────
  success: '#7FA86B', // = sage
  warning: '#E0AC63', // = gold
  error: '#E07A5F', // = coral

  // ── Legacy aliases (remapped to warm) ────────────────────
  // Kept so existing imports compile; values now point at the warm
  // palette so old call sites pick up the rebrand automatically.
  brand: '#7FA86B', // was mint → now sage (safe/active states)
  brandSoft: '#E7EFDD',
  brandMid: '#BFD6AE',
  brandDeep: '#5E8A4D',
  primary: '#E07A5F', // alarm/SOS → coral
  primaryDeep: '#CB6549',
  secondary: '#FFFFFF',
  accent: '#F3C6A0', // → peach CTA
  dark: '#2D2924',
  darkSoft: '#2D2924',
  background: '#F4ECE3',
  surfaceMuted: '#F7E9D5',
} as const;

export type ColorKey = keyof typeof colors;
