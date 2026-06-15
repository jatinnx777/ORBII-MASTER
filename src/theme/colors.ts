// ORBII — Warm Greige design system (v28 premium pass).
//
// Calm, premium, Apple-quality warmth. One soft greige canvas, four feeling
// accents, each with a `*Soft` tint for badges/fills:
//
//   • PRIMARY  (#FFD77A) — warm gold. CTAs, highlights, "protected".
//   • CORAL    (#FF6B57) — SOS / alarm. Soft, never harsh.
//   • LAVENDER (#8B7CF8) — Voice SOS / trusted-network accents.
//   • SAGE     (#7BC47F) — success / safe / all-clear.
//
// Legacy key names (brand, primary, peach, …) are preserved + remapped so
// every existing screen picks up the new palette automatically.
export const colors = {
  // ── Canvas ────────────────────────────────────────────────
  cream: '#F2EEEB', // app background (warm greige)
  creamDeep: '#EAE4DF', // pressed / alt surface
  surface: '#FAF8F6', // cards
  surfaceAlt: '#FFFFFF', // pure-white insets

  // ── Gold (primary accent / CTA) ──────────────────────────
  peach: '#FFD77A',
  peachDeep: '#E8B84F',
  peachSoft: '#FBEFD2',

  // ── Sage (success / safe / all-clear) ────────────────────
  sage: '#7BC47F',
  sageDeep: '#5BA85F',
  sageSoft: '#E4F1E5',

  // ── Coral (SOS / alarm) ──────────────────────────────────
  coral: '#FF6B57',
  coralDeep: '#E8553F',
  coralSoft: '#FFE3DD',

  // ── Lavender (Voice SOS / trusted network) ───────────────
  lavender: '#8B7CF8',
  lavenderDeep: '#6F5DE0',
  lavenderSoft: '#ECE8FE',

  // ── Gold (mascot / shield) — same family as primary ──────
  gold: '#FFD77A',
  goldDeep: '#E8B84F',
  goldSoft: '#FBEFD2',

  // ── Text ─────────────────────────────────────────────────
  textPrimary: '#2D2D2D',
  textSecondary: '#8A837D',
  textMuted: '#B3ABA4',
  textInverse: '#FFFFFF',

  // ── Lines (soft, never dark) ─────────────────────────────
  border: 'rgba(45,45,45,0.05)',
  divider: 'rgba(45,45,45,0.04)',
  inputBorder: 'rgba(45,45,45,0.07)',
  inputBackground: '#F2EEEB',
  overlay: 'rgba(40,38,36,0.45)',

  // ── Semantic ─────────────────────────────────────────────
  success: '#7BC47F',
  warning: '#FFD77A',
  error: '#FF6B57',

  // ── Legacy aliases (remapped) ────────────────────────────
  brand: '#7BC47F',
  brandSoft: '#E4F1E5',
  brandMid: '#B5DEB7',
  brandDeep: '#5BA85F',
  primary: '#FF6B57',
  primaryDeep: '#E8553F',
  secondary: '#FFFFFF',
  accent: '#FFD77A',
  dark: '#2D2D2D',
  darkSoft: '#2D2D2D',
  background: '#F2EEEB',
  surfaceMuted: '#FBEFD2',
} as const;

export type ColorKey = keyof typeof colors;
