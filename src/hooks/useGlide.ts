import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Makes circle members glide instead of teleport.
 *
 * THE PROBLEM. Location fixes arrive every 60 seconds, and the marker's
 * coordinate comes straight out of state, so a member vanishes from one point
 * and reappears 400 metres away. That single jump is most of the difference
 * between this map and Life360's, and it is not a rendering problem: the map
 * is already native MapLibre drawing GPU vector tiles. It is that nothing sits
 * between the data and the marker.
 *
 * WHY 25 FPS AND NOT 60. Every frame of this animation is a React render, and
 * a render per frame is the most reliable way to make a React Native screen
 * stutter. There is no way around that here: a MapLibre Marker is positioned by
 * a prop, so moving it means re-rendering it.
 *
 * So the question is how few frames buy the effect. A dot crossing 400 metres
 * of screen over a second is slow motion; at 25fps the eye cannot separate it
 * from 60, and we spend a third of the renders. Reaching for 60 here would cost
 * three times the work to move a dot two pixels further per frame.
 *
 * AND IT IS FREE WHEN NOTHING MOVES. The interval only exists while a glide is
 * in flight. A circle standing still costs exactly zero renders, which matters
 * because this screen is often open for a long time with nobody moving.
 */

export type GlidePoint = { id: string; lat: number; lng: number };

/** ~25fps. See above: the cheapest rate the eye cannot tell from 60 here. */
const FRAME_MS = 40;

/** How long a marker takes to travel to its new fix. */
export const GLIDE_MS = 900;

/**
 * Below this, snap. Moving a marker three metres over a second reads as drift
 * rather than travel, and it would keep the interval alive for GPS noise.
 */
export const SNAP_DEG = 0.00002;

/** Strong ease-out, matching the curve used everywhere else in the app. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Snap, or glide?
 *
 * Pure and exported because it is the one rule here worth protecting. A
 * stationary phone still reports fixes that wander by a few metres, and
 * animating that wander would keep the frame timer alive forever to render
 * drift as travel.
 */
export function shouldSnap(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): boolean {
  return Math.abs(a.lat - b.lat) < SNAP_DEG && Math.abs(a.lng - b.lng) < SNAP_DEG;
}

export function useGlide(targets: GlidePoint[]): Record<string, { lat: number; lng: number }> {
  const [, tick] = useState(0);

  // All animation state lives in refs. Putting it in state would re-render on
  // every write, which is the thing this hook exists to ration.
  const shown = useRef<Record<string, { lat: number; lng: number }>>({});
  const from = useRef<Record<string, { lat: number; lng: number }>>({});
  const to = useRef<Record<string, { lat: number; lng: number }>>({});
  const startedAt = useRef<Record<string, number>>({});
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reduced = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        reduced.current = v;
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const now = Date.now();
    let needsRun = false;

    for (const t of targets) {
      const current = shown.current[t.id];

      // First sighting, or reduced motion, or a move too small to be travel.
      if (!current || reduced.current || shouldSnap(current, t)) {
        shown.current[t.id] = { lat: t.lat, lng: t.lng };
        delete startedAt.current[t.id];
        continue;
      }

      const target = to.current[t.id];
      if (target && target.lat === t.lat && target.lng === t.lng) {
        // Already gliding here. Restarting would stutter the marker.
        needsRun = needsRun || startedAt.current[t.id] !== undefined;
        continue;
      }

      // A new fix mid-glide starts from where the marker actually IS, not from
      // the old fix. Otherwise it snaps backwards before setting off again.
      from.current[t.id] = { ...current };
      to.current[t.id] = { lat: t.lat, lng: t.lng };
      startedAt.current[t.id] = now;
      needsRun = true;
    }

    // Someone left the circle, or stopped sharing.
    const live = new Set(targets.map((t) => t.id));
    for (const id of Object.keys(shown.current)) {
      if (!live.has(id)) {
        delete shown.current[id];
        delete from.current[id];
        delete to.current[id];
        delete startedAt.current[id];
      }
    }

    if (!needsRun || timer.current) return;

    timer.current = setInterval(() => {
      const t = Date.now();
      let moving = false;

      for (const id of Object.keys(startedAt.current)) {
        const a = from.current[id];
        const b = to.current[id];
        if (!a || !b) {
          delete startedAt.current[id];
          continue;
        }
        const p = Math.min(1, (t - startedAt.current[id]) / GLIDE_MS);
        const f = easeOutCubic(p);
        shown.current[id] = {
          lat: a.lat + (b.lat - a.lat) * f,
          lng: a.lng + (b.lng - a.lng) * f,
        };
        if (p >= 1) delete startedAt.current[id];
        else moving = true;
      }

      tick((n) => n + 1);

      // Nothing left in flight: stop paying for frames.
      if (!moving && timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    }, FRAME_MS);
  }, [targets]);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    },
    [],
  );

  return shown.current;
}
