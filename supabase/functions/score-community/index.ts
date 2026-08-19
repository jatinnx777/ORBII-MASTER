// score-community — bridging-based ranking for the community feed.
//
// Fits the matrix factorization X publishes for Community Notes:
//
//     r̂_un = μ + i_u + i_n + f_u · f_n
//
// and writes each post's intercept (i_n) and factor (f_n) back, from which SQL
// derives the helpful / needs-more / not-helpful verdict.
//
// The point of the model, in one line: a post scores well only if raters who
// normally DISAGREE with each other both found it helpful. Net upvotes reward
// whatever the biggest group already believes, which on a safety feed means a
// real warning can be voted down by the people it inconveniences.
//
// Why the regularisation is lopsided (λ_i = 0.15, λ_f = 0.03): the intercept is
// penalised five times harder than the factors, so when the model can explain a
// rating either as "this post is good" (i) or "this post appeals to one camp"
// (f), it prefers the camp explanation. A post therefore has to be genuinely
// cross-cutting before its intercept can climb. That asymmetry is the bridge.
//
// Fit by plain gradient descent. The dataset here is a campus feed, thousands
// of ratings at most, so this runs in well under a second and needs no
// libraries.
//
// Deploy:  supabase functions deploy score-community

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const LAMBDA_I = 0.15; // intercept regularisation
const LAMBDA_F = 0.03; // factor regularisation
const LR = 0.2;
const EPOCHS = 300;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Rating = { post_id: string; user_id: string; value: number; weight?: number };

function fit(ratings: Rating[]) {
  const posts = [...new Set(ratings.map((r) => r.post_id))];
  const users = [...new Set(ratings.map((r) => r.user_id))];
  const pIdx = new Map(posts.map((p, i) => [p, i]));
  const uIdx = new Map(users.map((u, i) => [u, i]));

  let mu = 0.5;
  const iN = new Float64Array(posts.length);
  const fN = new Float64Array(posts.length);
  const iU = new Float64Array(users.length);
  const fU = new Float64Array(users.length);

  // Small deterministic spread. Factors initialised at exactly zero have zero
  // gradient and would never separate the viewpoints, so the whole bridge would
  // collapse into a plain average. Seeded rather than random so the same
  // ratings always produce the same ranking, which matters when someone asks
  // why their post was demoted.
  for (let i = 0; i < posts.length; i++) fN[i] = ((i % 7) - 3) * 0.01;
  for (let u = 0; u < users.length; u++) fU[u] = ((u % 5) - 2) * 0.01;

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

Deno.serve(async () => {
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Behaviour first, opinions second. If a ring is detected now, its ratings
    // must already be down-weighted by the time the bridge is fitted.
    await admin.rpc('bdsm_score_all').catch(() => undefined);

    const { data, error } = await admin.rpc('community_rating_matrix');
    if (error) return json({ error: error.message }, 500);

    const ratings = (data ?? []) as Rating[];
    if (ratings.length === 0) return json({ scored: 0, reason: 'no ratings' });

    const scores = fit(ratings);
    const { data: applied, error: applyErr } = await admin.rpc('community_apply_scores', {
      p_scores: scores,
    });
    if (applyErr) return json({ error: applyErr.message }, 500);

    return json({ scored: applied, ratings: ratings.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
