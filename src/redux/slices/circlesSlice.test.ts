import { describe, it, expect } from 'vitest';
import reducer, {
  circlesErrored,
  circlesHydrated,
  circlesLoaded,
  circlesLoading,
} from './circlesSlice';
import type { Circle } from '@/services/circles';

/**
 * These lock down the one rule the whole stale-while-revalidate change rests
 * on: ONCE THERE IS DATA ON SCREEN, NOTHING PUTS THE SCREEN BACK INTO A
 * LOADING STATE.
 *
 * It is worth testing rather than asserting because the failure is invisible
 * in review. Every one of these reducers looks correct in isolation; the bug
 * is a `status = 'loading'` in a path that runs while a roster is already
 * rendered, and the symptom is a list that blinks empty for 300ms on a screen
 * nobody profiles. That is exactly the complaint that started this work.
 */

const circle = (id: string, isDefault = false): Circle =>
  ({ id, name: id, isDefault } as Circle);

const withCircles = (ids: string[]) =>
  reducer(undefined, circlesHydrated({
    circles: ids.map((id) => circle(id)),
    activeCircleId: ids[0] ?? null,
  }));

describe('circlesHydrated', () => {
  it('restores circles, the active id and members from cache', () => {
    const s = reducer(undefined, circlesHydrated({
      circles: [circle('a'), circle('b')],
      activeCircleId: 'b',
      membersByCircle: { a: [], b: [] },
    }));
    expect(s.circles).toHaveLength(2);
    expect(s.activeCircleId).toBe('b');
    expect(Object.keys(s.membersByCircle)).toEqual(['a', 'b']);
  });

  it('does NOT claim ready when the cache was empty', () => {
    // A first-run user has nothing cached. Reporting 'ready' here would show
    // them an empty circle list as though it were the answer, with no skeleton
    // and no spinner, which reads as "you have no circles".
    const s = reducer(undefined, circlesHydrated({ circles: [], activeCircleId: null }));
    expect(s.status).toBe('idle');
  });

  it('claims ready when the cache had something to show', () => {
    expect(withCircles(['a']).status).toBe('ready');
  });
});

describe('circlesLoading', () => {
  it('blanks to a loading state ONLY on a cold start', () => {
    const s = reducer(undefined, circlesLoading());
    expect(s.status).toBe('loading');
    expect(s.revalidating).toBe(false);
  });

  it('never blanks a screen that already has circles', () => {
    // The regression this exists to catch.
    const s = reducer(withCircles(['a', 'b']), circlesLoading());
    expect(s.status).toBe('ready');
    expect(s.revalidating).toBe(true);
    expect(s.circles).toHaveLength(2);
  });
});

describe('circlesErrored', () => {
  it('shows the error screen when there is nothing to fall back on', () => {
    const s = reducer(reducer(undefined, circlesLoading()), circlesErrored('offline'));
    expect(s.status).toBe('errored');
    expect(s.error).toBe('offline');
  });

  it('keeps cached circles on screen when a background refresh fails', () => {
    // A parent looking at their roster on a train should not lose it because
    // one poll timed out in a tunnel. The error is recorded, not rendered over
    // the data.
    const hydrated = withCircles(['a', 'b']);
    const s = reducer(reducer(hydrated, circlesLoading()), circlesErrored('timeout'));
    expect(s.status).toBe('ready');
    expect(s.circles).toHaveLength(2);
    expect(s.revalidating).toBe(false);
    expect(s.error).toBe('timeout');
  });
});

describe('circlesLoaded', () => {
  it('clears the sync line when the refresh lands', () => {
    const s = reducer(reducer(withCircles(['a']), circlesLoading()), circlesLoaded([circle('a')]));
    expect(s.revalidating).toBe(false);
    expect(s.status).toBe('ready');
  });

  it('repairs an active id that the cache kept but the server dropped', () => {
    // The cache can outlive the circle it points at: leave a circle on another
    // device, open this one offline, and activeCircleId names something the
    // server will not return. Without the repair the app sits on a circle that
    // does not exist and every member fetch comes back empty.
    const stale = reducer(undefined, circlesHydrated({
      circles: [circle('gone')],
      activeCircleId: 'gone',
    }));
    const s = reducer(stale, circlesLoaded([circle('real', true)]));
    expect(s.activeCircleId).toBe('real');
  });
});
