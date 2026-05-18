export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  // `lg` (24) is the premium card radius — pairs with `shadows.card` to
  // give surfaces an Apple-grade softness. Use it for the major resting
  // surfaces (action cards, list rows, info panels). Use `xl` (28) for
  // bottom sheets where a stronger curve reads better.
  lg: 24,
  xl: 28,
  circle: 9999,
} as const;

export const touchTarget = {
  min: 44,
  comfortable: 56,
} as const;

// Soft diffuse shadows only — per the premium design spec. Three
// presets: `card` is the everyday resting elevation, `sheet` is the
// upward-facing shadow for the bottom panel, and `hero` is a slightly
// stronger lift for primary CTAs / pressed states.
export const shadows = {
  card: {
    shadowColor: '#0F1115',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 3,
  },
  sheet: {
    shadowColor: '#0F1115',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 6,
  },
  hero: {
    shadowColor: '#0F1115',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10,
    shadowRadius: 22,
    elevation: 6,
  },
} as const;
