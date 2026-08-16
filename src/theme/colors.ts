// ORBII, Warm Editorial design system (v32).
//
// The app now shares the website's palette, so orbii.in and the phone in your
// hand look like the same company. That is the whole point of the change: a
// violet-on-white app is indistinguishable from every family-tracker on the
// store, and we were starting to look like a copy of one.
//
//   • CREAM   (#FAF9EC), the ground. Warm ivory, never grey, never white.
//   • INK     (#17161C), near-black text and dark editorial bands.
//   • LAVENDER(#8672CE), the one accent. CTAs, "protected", links, emphasis.
//   • CORAL   (#EF605E), SOS / danger only. Never used for anything calm.
//   • GOLD    (#D6A64F), premium (ORBII Plus) + highlights.
//   • SAGE    (#4FA383), "all clear" / verified confirmations.
//
// Every screen reads these tokens, so retinting here restyles the whole app.
// Nothing brand-related is hardcoded in screens, always reference a token.

const LAV = '#8672CE';
const LAV_DEEP = '#6E58B6';
const LAV_SOFT = '#E8DBF7';

export const colors = {
  // ── Canvas (warm ivory cream, the website ground) ────────
  cream: '#FAF9EC', // app background
  creamDeep: '#F3F0DF', // pressed / alt surface / tint band
  surface: '#FFFFFF', // cards
  surfaceAlt: '#FFFFFF', // insets

  // ── Lavender (primary accent / CTA / safe) ───────────────
  peach: LAV, // legacy name, now the brand lavender (drives most CTAs)
  peachDeep: LAV_DEEP,
  peachSoft: LAV_SOFT,

  // ── Sage (success / safe / all-clear). Green is the one colour everyone
  // reads as "you're okay". Keeping the `sage*` names so every existing screen
  // picks this up untouched.
  sage: '#4FA383',
  sageDeep: '#3E8268',
  sageSoft: '#E6F1EC',

  // ── Coral (SOS / alarm / danger) ─────────────────────────
  coral: '#EF605E',
  coralDeep: '#D14A48',
  coralSoft: '#FBE3E2',

  // ── Lavender tints (Voice SOS / trusted network) ─────────
  lavender: '#A493DC',
  lavenderDeep: LAV_DEEP,
  lavenderSoft: '#EADFF6',

  // ── Gold (premium / highlights) ──────────────────────────
  gold: '#D6A64F',
  goldDeep: '#B4842F',
  goldSoft: '#F5EAD3',

  // ── Text (warm neutrals, so type sits on cream not on grey) ──
  textPrimary: '#17161C',
  textSecondary: '#6B6560',
  textMuted: '#9A948C',
  textInverse: '#FFFFFF',
  /** Cream type for use on ink bands. */
  textOnInk: '#F3F0E4',

  // ── Lines (warm, soft, never dark) ───────────────────────
  border: '#E9E2CF',
  divider: 'rgba(50,42,20,0.09)',
  inputBorder: '#E9E2CF',
  inputBackground: '#FAF9EC',
  overlay: 'rgba(23,22,28,0.45)',

  // ── Semantic ─────────────────────────────────────────────
  success: '#4FA383',
  warning: '#D6A64F',
  error: '#EF605E',

  // ── Legacy aliases (remapped so every screen updates) ────
  brand: LAV,
  brandSoft: LAV_SOFT,
  brandMid: '#C0B2E8',
  brandDeep: LAV_DEEP,
  primary: '#EF605E', // SOS / danger primary, stays coral
  primaryDeep: '#D14A48',
  secondary: '#FFFFFF',
  accent: LAV,
  dark: '#17161C',
  darkSoft: '#201F27',
  background: '#FAF9EC',
  sectionBand: '#F3F0DF',
  surfaceMuted: '#F5F2E4',
} as const;

export type ColorKey = keyof typeof colors;
