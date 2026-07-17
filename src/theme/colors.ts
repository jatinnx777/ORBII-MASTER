// ORBII — Violet Neo-Minimal design system (v31).
//
// Soft-minimal / neo-minimal, the language of Blinkit, Uber, Google Maps,
// Airbnb and Apple: clean near-white canvas, pure-white cards, generous
// rounding, subtle neutral elevation, and ONE confident brand colour.
//
//   • BRAND / SAFE  (#7B5FC7) — ORBII violet. CTAs, "protected", success,
//     "help is coming". This is the app's identity.
//   • CORAL         (#FF5A5F) — SOS / danger only. Never used for anything calm.
//   • GOLD          (#F5C451) — premium (ORBII Plus) + highlights.
//   • MINT          (#3DBE8B) — "all clear" / verified confirmations.
//
// Every screen reads these tokens, so retinting here restyles the whole app.
// Nothing brand-related is hardcoded in screens — always reference a token.

// Brand violet scale.
const GREEN = '#7B5FC7';
const GREEN_DEEP = '#5E45A0';
const GREEN_SOFT = '#EFEAFA';

export const colors = {
  // ── Canvas (clean near-white, faintly violet-biased neutral) ──
  cream: '#F7F5FC', // app background
  creamDeep: '#EEEAF6', // pressed / alt surface
  surface: '#FFFFFF', // cards (pure white — neo-minimal)
  surfaceAlt: '#FFFFFF', // insets

  // ── Green (primary accent / CTA / safe) ──────────────────
  peach: GREEN, // legacy name — now the brand green (drives most CTAs)
  peachDeep: GREEN_DEEP,
  peachSoft: GREEN_SOFT,

  // ── Mint (success / safe / all-clear). Stays GREEN even though the brand is
  // violet: green is the one colour everyone reads as "you're okay". Keeping
  // the `sage*` names so every existing screen picks this up untouched.
  sage: '#3DBE8B',
  sageDeep: '#2E9B70',
  sageSoft: '#E3F6EE',

  // ── Coral (SOS / alarm / danger) ─────────────────────────
  coral: '#FF5A5F',
  coralDeep: '#E23F45',
  coralSoft: '#FFE4E5',

  // ── Lavender (Voice SOS / trusted network) ───────────────
  lavender: '#9B86E0',
  lavenderDeep: '#7B61D9',
  lavenderSoft: '#F1ECFC',

  // ── Gold (the bee / premium / highlights) ────────────────
  gold: '#F5C451',
  goldDeep: '#DCA633',
  goldSoft: '#FBEFCB',

  // ── Text ─────────────────────────────────────────────────
  textPrimary: '#1A1A22',
  textSecondary: '#6B6B7B',
  textMuted: '#A2A2B0',
  textInverse: '#FFFFFF',

  // ── Lines (soft, never dark) ─────────────────────────────
  border: 'rgba(20,20,30,0.06)',
  divider: 'rgba(20,20,30,0.045)',
  inputBorder: 'rgba(20,20,30,0.08)',
  inputBackground: '#F7F5FC',
  overlay: 'rgba(20,20,30,0.45)',

  // ── Semantic ─────────────────────────────────────────────
  success: '#3DBE8B',
  warning: '#F5C451',
  error: '#FF5A5F',

  // ── Legacy aliases (remapped so every screen updates) ────
  brand: GREEN,
  brandSoft: GREEN_SOFT,
  brandMid: '#BCA9EE',
  brandDeep: GREEN_DEEP,
  primary: '#FF5A5F', // SOS / danger primary — stays coral
  primaryDeep: '#E23F45',
  secondary: '#FFFFFF',
  accent: GREEN,
  dark: '#1A1A22',
  darkSoft: '#1A1A22',
  background: '#F7F5FC',
  surfaceMuted: GREEN_SOFT,
} as const;

export type ColorKey = keyof typeof colors;
