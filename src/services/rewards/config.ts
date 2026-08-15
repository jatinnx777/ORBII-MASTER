// Reward config, a client-side MIRROR of sql/33 (reward_config) used only for
// transparency (showing helpers how a reward is made up) and preview UI. The
// server is the sole authority on the money; changing values here never grants
// a rupee. Keep in sync with reward_config if you retune the server.

export const REWARD = {
  basePaise: 5000, // ₹50 base per eligible helper
  distanceCapKm: 8,
  distanceMaxPaise: 5000, // ₹50 at/after the cap
  rewardCapPaise: 40000, // ₹400 hard cap (unless manually approved)
  fraudThreshold: 70, // > this → held for manual review
  sceneMinSeconds: 120, // < 2 min on scene → no reward
  maxPaidPerSos: 3, // only the first 3 arrivals are paid
  limits: { daily: 2, weekly: 10, monthly: 25 },

  // Fast-response bonus by accept latency (seconds → paise).
  responseTiers: [
    { maxSec: 30, paise: 1000 }, // ₹10
    { maxSec: 120, paise: 500 }, // ₹5
    { maxSec: 600, paise: 0 },
  ],
  // Time-on-scene bonus (seconds → paise). Under sceneMinSeconds = 0 (no reward).
  sceneTiers: [
    { maxSec: 600, paise: 1000 }, // stayed ≥2 min, <10 min → ₹10
    { maxSec: Infinity, paise: 500 }, // ≥10 min → ₹5
  ],
  ratingPaise: { 5: 500, 4: 300 } as Record<number, number>, // ★→paise
} as const;

// Geofence: a helper "arrives" only after dwelling inside this radius for the
// dwell time, no manual arrival tap is ever accepted for reward purposes.
export const GEOFENCE = {
  arriveRadiusM: 45,
  dwellMs: 20_000, // must stay ~20s inside before it counts as arrival
  departRadiusM: 80, // hysteresis so a wobble doesn't count as leaving
} as const;

// Movement sanity thresholds for the route verifier.
export const MOVEMENT = {
  teleportM: 250, // a single jump larger than this with no time = teleport
  maxSpeedMps: 45, // ~162 km/h, above this is impossible for a rescue
} as const;

export function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
