import { guardianLevel, type GuardianLevel, type HelperProfile } from '@/services/helper-profile';

// TrustScoreService, maps a helper's recognition tier to the reward multiplier.
// Mirrors trust_multiplier() in sql/33 so the preview UI matches what the server
// will actually apply. The server value is authoritative.

const MULTIPLIER: Record<GuardianLevel, number> = {
  Bronze: 1.0,
  Silver: 1.1,
  Gold: 1.2,
  Elite: 1.5,
};

export const TrustScoreService = {
  levelFor(profile: HelperProfile): GuardianLevel {
    return guardianLevel(profile);
  },
  multiplierFor(profile: HelperProfile): number {
    return MULTIPLIER[guardianLevel(profile)] ?? 1.0;
  },
  multiplierForLevel(level: GuardianLevel): number {
    return MULTIPLIER[level] ?? 1.0;
  },
};
