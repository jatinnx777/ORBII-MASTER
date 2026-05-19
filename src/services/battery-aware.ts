import * as Battery from 'expo-battery';
import { useEffect, useState } from 'react';

// Battery-aware mode.
//
// The moment of greatest physical danger is often the same moment your
// phone is about to die — long walk home, screen-on for navigation,
// camera flash for visibility, etc. This module:
//
//   • Exposes a `useBatteryStatus()` hook that components can subscribe
//     to for live battery level + plugged-in state.
//   • Surfaces a derived `isLow` flag when level <= LOW_THRESHOLD AND
//     the phone is not charging.
//   • Exposes a global function `shouldDampenWork()` for non-React code
//     paths (timers, presence updates) to call when deciding whether to
//     skip a tick to save juice.
//
// Why we don't reduce GPS frequency centrally: location.ts is consumed
// by the SOS critical path. We intentionally never throttle SOS work —
// even on a 3% battery, the user pressing the button must broadcast.
// We only dampen the AMBIENT chatter (presence pings, route refresh)
// where one missed tick is invisible.

export type BatteryStatus = {
  level: number; // 0..1
  isCharging: boolean;
  isLow: boolean;
};

const LOW_THRESHOLD = 0.20;

let cached: BatteryStatus = {
  level: 1,
  isCharging: false,
  isLow: false,
};

function deriveLow(level: number, isCharging: boolean): boolean {
  return !isCharging && level > 0 && level <= LOW_THRESHOLD;
}

// One-shot read, no subscription. Useful for cold-start checks.
export async function readBatteryStatus(): Promise<BatteryStatus> {
  try {
    const [level, state] = await Promise.all([
      Battery.getBatteryLevelAsync(),
      Battery.getBatteryStateAsync(),
    ]);
    const isCharging =
      state === Battery.BatteryState.CHARGING
      || state === Battery.BatteryState.FULL;
    const next: BatteryStatus = {
      level,
      isCharging,
      isLow: deriveLow(level, isCharging),
    };
    cached = next;
    return next;
  } catch {
    return cached;
  }
}

// True when we should skip non-essential background work to save juice.
// Callable from anywhere — uses the cached value rather than racing a
// native read every time the call is made.
export function shouldDampenWork(): boolean {
  return cached.isLow;
}

export function useBatteryStatus(): BatteryStatus {
  const [status, setStatus] = useState<BatteryStatus>(cached);

  useEffect(() => {
    let mounted = true;
    readBatteryStatus().then((s) => {
      if (mounted) setStatus(s);
    });

    const levelSub = Battery.addBatteryLevelListener(({ batteryLevel }) => {
      cached = {
        level: batteryLevel,
        isCharging: cached.isCharging,
        isLow: deriveLow(batteryLevel, cached.isCharging),
      };
      if (mounted) setStatus(cached);
    });
    const stateSub = Battery.addBatteryStateListener(({ batteryState }) => {
      const isCharging =
        batteryState === Battery.BatteryState.CHARGING
        || batteryState === Battery.BatteryState.FULL;
      cached = {
        level: cached.level,
        isCharging,
        isLow: deriveLow(cached.level, isCharging),
      };
      if (mounted) setStatus(cached);
    });

    return () => {
      mounted = false;
      levelSub.remove();
      stateSub.remove();
    };
  }, []);

  return status;
}
