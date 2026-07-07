// ORBII — Green Neo-Minimal design system (v29).
//
// Soft-minimal / neo-minimal, the language of Blinkit, Uber, Google Maps,
// Airbnb and Apple: clean near-white canvas, pure-white cards, generous
// rounding, subtle neutral elevation, and ONE confident brand colour.
//
//   • BRAND / SAFE  (#4BAD3F) — ORBII green, sampled from the logo. CTAs,
//     "protected", success, "help is coming". This is the app's identity.
//   • CORAL         (#FF6B57) — SOS / danger only. Never used for anything calm.
//   • GOLD          (#F5C451) — the bee. Premium (ORBII Plus) + highlights.
//   • LAVENDER      (#8B7CF8) — Voice SOS / trusted-network accents.
//
// Every screen reads these tokens, so retinting here restyles the whole app.
// Nothing brand-related is hardcoded in screens — always reference a token.

// Brand green scale, derived from the logo (#4BAD3F).
const GREEN = '#4BAD3F';
const GREEN_DEEP = '#3A8F30';
const GREEN_SOFT = '#E7F4E3';

export const colors = {
  // ── Canvas (clean near-white, faintly green-biased neutral) ──
  cream: '#F5F6F3', // app background
  creamDeep: '#ECEEE9', // pressed / alt surface
  surface: '#FFFFFF', // cards (pure white — neo-minimal)
  surfaceAlt: '#FFFFFF', // insets

  // ── Green (primary accent / CTA / safe) ──────────────────
  peach: GREEN, // legacy name — now the brand green (drives most CTAs)
  peachDeep: GREEN_DEEP,
  peachSoft: GREEN_SOFT,

  // ── Sage (success / safe / all-clear) — same green family ─
  sage: GREEN,
  sageDeep: GREEN_DEEP,
  sageSoft: GREEN_SOFT,

  // ── Coral (SOS / alarm / danger) ─────────────────────────
  coral: '#FF6B57',
  coralDeep: '#E8553F',
  coralSoft: '#FFE3DD',

  // ── Lavender (Voice SOS / trusted network) ───────────────
  lavender: '#8B7CF8',
  lavenderDeep: '#6F5DE0',
  lavenderSoft: '#ECE8FE',

  // ── Gold (the bee / premium / highlights) ────────────────
  gold: '#F5C451',
  goldDeep: '#DCA633',
  goldSoft: '#FBEFCB',

  // ── Text ─────────────────────────────────────────────────
  textPrimary: '#1A1A1A',
  textSecondary: '#6B6B66',
  textMuted: '#A2A29B',
  textInverse: '#FFFFFF',

  // ── Lines (soft, never dark) ─────────────────────────────
  border: 'rgba(20,20,20,0.06)',
  divider: 'rgba(20,20,20,0.045)',
  inputBorder: 'rgba(20,20,20,0.08)',
  inputBackground: '#F5F6F3',
  overlay: 'rgba(20,20,20,0.45)',

  // ── Semantic ─────────────────────────────────────────────
  success: GREEN,
  warning: '#F5C451',
  error: '#FF6B57',

  // ── Legacy aliases (remapped so every screen updates) ────
  brand: GREEN,
  brandSoft: GREEN_SOFT,
  brandMid: '#A9DBA2',
  brandDeep: GREEN_DEEP,
  primary: '#FF6B57', // SOS / danger primary — stays coral
  primaryDeep: '#E8553F',
  secondary: '#FFFFFF',
  accent: GREEN,
  dark: '#1A1A1A',
  darkSoft: '#1A1A1A',
  background: '#F5F6F3',
  surfaceMuted: GREEN_SOFT,
} as const;

export type ColorKey = keyof typeof colors;
