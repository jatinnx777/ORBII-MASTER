// Bridging fit, extracted so it can be tested.
//
// The edge function (supabase/functions/score-community) is the deployment
// target, but the maths is pure and belongs somewhere a test can reach it.
// Keep the two in sync: this file is the reference.

export type Rating = { post_id: string; user_id: string; value: number; weight?: number };

const LAMBDA_I = 0.15; // intercept regularisation
const LAMBDA_F = 0.03; // factor regularisation
const LR = 0.2;
// 300 was not converged. Factor separation on a two-camp fixture keeps growing
// until ~1000 epochs (|f| 0.217 -> 0.295) and is flat by 3000, so the extra
// passes are the difference between detecting a partisan post and not. The fit
// is a few thousand ratings at most, so this still runs in well under a second.
const EPOCHS = 1000;


function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}



export function fit(ratings: Rating[]) {
  const posts = [...new Set(ratings.map((r) => r.post_id))];
  const users = [...new Set(ratings.map((r) => r.user_id))];
  const pIdx = new Map(posts.map((p, i) => [p, i]));
  const uIdx = new Map(users.map((u, i) => [u, i]));

  let mu = 0.5;
  const iN = new Float64Array(posts.length);
  const fN = new Float64Array(posts.length);
  const iU = new Float64Array(users.length);
  const fU = new Float64Array(users.length);

  // Factor initialisation has to be BIG enough to escape its own gradient.
  //
  // The gradient for a factor is proportional to the opposing factor
  // (dL/df_n includes f_u), so if both start near zero they stay near zero:
  // the updates are ~1e-4 while lambda_f pulls them straight back. The model
  // then collapses into a plain weighted average, viewpoints are never
  // separated, and "bridging" silently becomes the popularity contest it was
  // supposed to replace. A first pass here used +/-0.03 and did exactly that;
  // the test in bridging.test.ts is what caught it.
  //
  // Seeded rather than random, so the same ratings always produce the same
  // ranking. That matters the first time someone asks why their post was
  // demoted.
  for (let i = 0; i < posts.length; i++) fN[i] = (((i * 7) % 11) / 10 - 0.5) * 0.8;
  for (let u = 0; u < users.length; u++) fU[u] = (((u * 5) % 9) / 8 - 0.5) * 0.8;

  const n = ratings.length;
  const pi = ratings.map((r) => pIdx.get(r.post_id)!);
  const ui = ratings.map((r) => uIdx.get(r.user_id)!);
  const y = ratings.map((r) => r.value);
  // Per-rating trust from BDSM (sql/77). A suspected script contributes a
  // fraction of a real reader, or nothing at all. Without this the bridge is
  // forgeable: fifty sock puppets can be built to look like a diverse crowd,
  // and a manufactured consensus is exactly how a lie about a named person
  // reaches the top of a campus safety feed.
  const w = ratings.map((r) => (typeof r.weight === 'number' ? Math.max(0, Math.min(1, r.weight)) : 1));
  const wSum = w.reduce((a, b) => a + b, 0) || 1;

  for (let epoch = 0; epoch < EPOCHS; epoch++) {
    let gMu = 0;
    const gIN = new Float64Array(posts.length);
    const gFN = new Float64Array(posts.length);
    const gIU = new Float64Array(users.length);
    const gFU = new Float64Array(users.length);

    for (let k = 0; k < n; k++) {
      const p = pi[k];
      const u = ui[k];
      const pred = mu + iU[u] + iN[p] + fU[u] * fN[p];
      const e = (pred - y[k]) * w[k];
      gMu += e;
      gIN[p] += e;
      gIU[u] += e;
      gFN[p] += e * fU[u];
      gFU[u] += e * fN[p];
    }

    // Regularisation pulls every parameter toward zero.
    mu -= LR * ((gMu / wSum) + LAMBDA_I * mu);
    for (let p = 0; p < posts.length; p++) {
      iN[p] -= LR * ((gIN[p] / wSum) + LAMBDA_I * iN[p]);
      fN[p] -= LR * ((gFN[p] / wSum) + LAMBDA_F * fN[p]);
    }
    for (let u = 0; u < users.length; u++) {
      iU[u] -= LR * ((gIU[u] / wSum) + LAMBDA_I * iU[u]);
      fU[u] -= LR * ((gFU[u] / wSum) + LAMBDA_F * fU[u]);
    }
  }

  return posts.map((id, i) => ({ id, intercept: iN[i], factor: fN[i] }));
}
