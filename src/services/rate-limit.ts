// Client-side rate limiter. Two layers per action key:
//
// • cooldown: a hard minimum between consecutive uses (e.g. SOS can't
//   re-fire for 15s after the previous one).
// • windowed quota: max N uses inside a rolling window (e.g. 5 SOS
//   per hour, 20 friend-requests per hour).
//
// State is in-memory only. A page reload / app restart resets the limit
//, that's intentional. Server-side enforcement is the authoritative
// throttle; this guard is here to stop accidental spam (double-tap,
// runaway code) and to give the user a clear "you're going too fast"
// message before the request even leaves the device.

type RuleKey = 'sos.fire' | 'friend.request' | 'support.message' | 'profile.update';

type Rule = {
  // Minimum ms between uses. 0 = no cooldown layer.
  cooldownMs: number;
  // Max uses inside `windowMs`. 0 = no quota layer.
  maxInWindow: number;
  windowMs: number;
};

const RULES: Record<RuleKey, Rule> = {
  // SOS: stop accidental double-fires; 5 real SOS in an hour is already
  // a stretch, anything more is almost certainly noise / abuse.
  'sos.fire': { cooldownMs: 15_000, maxInWindow: 5, windowMs: 60 * 60_000 },
  // Friend requests: 20 / hour caps social spam.
  'friend.request': { cooldownMs: 1_500, maxInWindow: 20, windowMs: 60 * 60_000 },
  // Support chat: 60 / hour. Generous, but blocks runaway scripts.
  'support.message': { cooldownMs: 600, maxInWindow: 60, windowMs: 60 * 60_000 },
  // Profile update: 1 per 5s, 10 per hour.
  'profile.update': { cooldownMs: 5_000, maxInWindow: 10, windowMs: 60 * 60_000 },
};

const lastFire: Map<RuleKey, number> = new Map();
const history: Map<RuleKey, number[]> = new Map();

export type RateLimitResult =
  | { ok: true }
  | { ok: false; reason: 'cooldown'; retryAfterMs: number }
  | { ok: false; reason: 'quota'; retryAfterMs: number };

// Check whether `key` is allowed RIGHT NOW. If yes, atomically records
// the use and returns ok. If no, returns the reason + how long until the
// next attempt would succeed.
export function checkRateLimit(key: RuleKey, now: number = Date.now()): RateLimitResult {
  const rule = RULES[key];
  if (!rule) return { ok: true };

  // Cooldown: hard minimum between consecutive uses.
  if (rule.cooldownMs > 0) {
    const prev = lastFire.get(key) ?? 0;
    if (now - prev < rule.cooldownMs) {
      return {
        ok: false,
        reason: 'cooldown',
        retryAfterMs: rule.cooldownMs - (now - prev),
      };
    }
  }

  // Windowed quota: prune expired entries, then count.
  if (rule.maxInWindow > 0) {
    const list = history.get(key) ?? [];
    const cutoff = now - rule.windowMs;
    const recent = list.filter((t) => t >= cutoff);
    if (recent.length >= rule.maxInWindow) {
      // Caller should retry once the oldest entry falls out of the window.
      const oldest = recent[0];
      return {
        ok: false,
        reason: 'quota',
        retryAfterMs: oldest + rule.windowMs - now,
      };
    }
    recent.push(now);
    history.set(key, recent);
  }

  lastFire.set(key, now);
  return { ok: true };
}

// Human-readable message for the failure path. Keeps UX consistent
// across every caller.
export function rateLimitMessage(result: RateLimitResult): string {
  if (result.ok) return '';
  const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  if (result.reason === 'cooldown') {
    return `Slow down. Try again in ${seconds}s.`;
  }
  if (seconds > 60) {
    const minutes = Math.ceil(seconds / 60);
    return `You've hit the hourly limit. Try again in about ${minutes} min.`;
  }
  return `Limit reached. Try again in ${seconds}s.`;
}

// Test/debug only, wipe in-memory state.
export function _resetRateLimits(): void {
  lastFire.clear();
  history.clear();
}
