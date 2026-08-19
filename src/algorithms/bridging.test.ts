import { describe, expect, it } from 'vitest';
import { fit, type Rating } from './bridging';

// These are the tests that matter most in this repo.
//
// Everything else here checks that a function does what its name says. These
// check that the community ranking has the PROPERTY we claim it has in the
// deck, on the website, and in sql/76: that a post rises because people who
// normally disagree both found it useful, not because one group liked it a lot.
//
// If bridging does not hold, ORBII is running a popularity contest on a safety
// feed while telling everyone it isn't. That is the failure worth catching.

/**
 * Two camps who disagree about almost everything.
 *
 * Camp A (a1..a4) and camp B (b1..b4) rate `divisive` in opposite directions,
 * which is what teaches the model that they hold opposing viewpoints. Without
 * this history there are no camps and no bridge to cross.
 */
function withCamps(extra: Rating[]): Rating[] {
  const A = ['a1', 'a2', 'a3', 'a4'];
  const B = ['b1', 'b2', 'b3', 'b4'];
  const base: Rating[] = [];
  for (const p of ['divisive1', 'divisive2', 'divisive3']) {
    for (const u of A) base.push({ post_id: p, user_id: u, value: 1 });
    for (const u of B) base.push({ post_id: p, user_id: u, value: 0 });
  }
  for (const p of ['divisive4', 'divisive5']) {
    for (const u of A) base.push({ post_id: p, user_id: u, value: 0 });
    for (const u of B) base.push({ post_id: p, user_id: u, value: 1 });
  }
  return [...base, ...extra];
}

const scoreOf = (out: { id: string; intercept: number }[], id: string) =>
  out.find((r) => r.id === id)!.intercept;

describe('bridging fit', () => {
  it('scores a cross-camp post above a one-camp post', () => {
    const ratings = withCamps([
      // Loved by everyone, both camps.
      ...['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'b4'].map((u) => ({
        post_id: 'bridged',
        user_id: u,
        value: 1,
      })),
      // Loved just as hard, but only by camp A. Same count of "helpful"
      // ratings as the bridged post gets from A, and nothing from B.
      ...['a1', 'a2', 'a3', 'a4'].map((u) => ({
        post_id: 'partisan',
        user_id: u,
        value: 1,
      })),
    ]);

    const out = fit(ratings);
    expect(scoreOf(out, 'bridged')).toBeGreaterThan(scoreOf(out, 'partisan'));
  });

  it('flags a brigaded post as partisan through its factor', () => {
    // The important correction, and the reason this test exists.
    //
    // A post rated helpful by 8 accounts from ONE camp legitimately earns a
    // HIGHER intercept than a post rated by 4 people from both camps: more
    // ratings is more evidence, and the intercept measures exactly that. It is
    // not the intercept that catches brigading.
    //
    // The FACTOR does. A one-camp post lands far out on the viewpoint axis,
    // and community_bridge_status refuses 'helpful' to anything whose
    // abs(factor) is too large no matter how good its intercept looks. So the
    // property worth asserting is separation on the factor, not ordering on
    // the intercept.
    const bigCampA = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'];
    const ratings = withCamps([
      ...bigCampA.map((u) => ({ post_id: 'brigaded', user_id: u, value: 1 })),
      // Teach the model that a5..a8 belong to camp A too.
      ...bigCampA.slice(4).flatMap((u) => [
        { post_id: 'divisive1', user_id: u, value: 1 },
        { post_id: 'divisive4', user_id: u, value: 0 },
      ]),
      ...['a1', 'a2', 'b1', 'b2'].map((u) => ({
        post_id: 'bridged',
        user_id: u,
        value: 1,
      })),
    ]);

    const out = fit(ratings);
    const partisan = Math.abs(out.find((r) => r.id === 'brigaded')!.factor);
    const crossing = Math.abs(out.find((r) => r.id === 'bridged')!.factor);

    // Asserted as a ratio rather than against a fixed number, so the test
    // survives threshold tuning and still fails if viewpoints stop separating.
    expect(partisan).toBeGreaterThan(crossing * 3);
  });

  it('ranks a disliked post below a liked one', () => {
    const ratings = withCamps([
      ...['a1', 'a2', 'b1', 'b2'].map((u) => ({ post_id: 'good', user_id: u, value: 1 })),
      ...['a1', 'a2', 'b1', 'b2'].map((u) => ({ post_id: 'bad', user_id: u, value: 0 })),
    ]);
    const out = fit(ratings);
    expect(scoreOf(out, 'good')).toBeGreaterThan(scoreOf(out, 'bad'));
  });

  it('ignores a zero-weight rater, which is what BDSM restriction means', () => {
    // sql/77 hands a suspected sock puppet trust 0. The fit must then produce
    // the same answer as if that account had never rated at all, otherwise
    // restriction is cosmetic and the bridge stays forgeable.
    const honest = withCamps([
      ...['a1', 'b1'].map((u) => ({ post_id: 'target', user_id: u, value: 1 })),
    ]);
    const withPuppets = withCamps([
      ...['a1', 'b1'].map((u) => ({ post_id: 'target', user_id: u, value: 1 })),
      ...['sock1', 'sock2', 'sock3'].map((u) => ({
        post_id: 'target',
        user_id: u,
        value: 1,
        weight: 0,
      })),
    ]);

    const a = scoreOf(fit(honest), 'target');
    const b = scoreOf(fit(withPuppets), 'target');
    expect(Math.abs(a - b)).toBeLessThan(0.02);
  });

  it('is deterministic, so a demotion can always be explained', () => {
    const ratings = withCamps([
      ...['a1', 'b1', 'a2', 'b2'].map((u) => ({ post_id: 'p', user_id: u, value: 1 })),
    ]);
    expect(scoreOf(fit(ratings), 'p')).toBe(scoreOf(fit(ratings), 'p'));
  });

  it('produces finite scores and never NaN', () => {
    // A NaN intercept would silently fail every threshold comparison in
    // community_bridge_status and quietly park a post in 'needs_more' forever.
    const out = fit(withCamps([{ post_id: 'lonely', user_id: 'a1', value: 1 }]));
    for (const r of out) {
      expect(Number.isFinite(r.intercept)).toBe(true);
      expect(Number.isFinite(r.factor)).toBe(true);
    }
  });
});
