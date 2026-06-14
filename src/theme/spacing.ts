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
// iOS-style shadows: neutral, tight, very subtle. Cards read as lifted
// paper, not glowy. (Replaced the old warm-brown diffuse glow.)
export const shadows = {
  card: {
    shadowColor: '#1C1C1E',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  sheet: {
    shadowColor: '#1C1C1E',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 8,
  },
  hero: {
    shadowColor: '#E9B084',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 5,
  },
  icon: {
    shadowColor: '#1C1C1E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
} as const;
