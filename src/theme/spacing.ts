export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 10,
  md: 16,
  // Cards in the warm design rest on a generous 24–28 curve; the big
  // feature container + bottom sheets use 32 (`xxl`). CTAs are full pills.
  lg: 24,
  xl: 28,
  xxl: 32,
  pill: 999, // fully-rounded CTA buttons
  circle: 9999,
} as const;

export const touchTarget = {
  min: 44,
  comfortable: 56,
} as const;

// Soft, warm, diffuse shadows — the warm canvas reads better with a
// brown-tinted shadow than a cold grey/black one. Four presets:
//   • card  — everyday resting card elevation
//   • sheet — upward shadow under the Home bottom sheet
//   • hero  — stronger lift for the peach CTA / pressed primary
//   • icon  — tiny soft pop under the round icon badges
export const shadows = {
  card: {
    shadowColor: '#9A7B53',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 3,
  },
  sheet: {
    shadowColor: '#9A7B53',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 8,
  },
  hero: {
    shadowColor: '#E9B084',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 22,
    elevation: 6,
  },
  icon: {
    shadowColor: '#9A7B53',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 2,
  },
} as const;
