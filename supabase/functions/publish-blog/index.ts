// publish-blog — lets the founder publish a blog post from the ORBII admin.
//
// The admin page calls this with the signed-in user's JWT. We verify the caller
// is the admin (via the existing is_admin() RPC, which is locked to the founder
// email), then commit a Markdown file into the website repo using a GitHub token
// that lives ONLY here as a Supabase secret. The commit triggers Vercel's
// rebuild, so the new post is a real, crawlable static page within ~1-2 minutes.
//
// Deploy:  supabase functions deploy publish-blog
// Secrets: supabase secrets set GITHUB_TOKEN=ghp_xxx   (repo contents write)
//          (optional) supabase secrets set BLOG_REPO=jatinnx777/ORBII-WEBSITE-
// SUPABASE_URL + SUPABASE_ANON_KEY are provided automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .replace(/-$/g, '');
}

// UTF-8 safe base64 (GitHub contents API wants base64).
function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader) return json({ error: 'Not signed in' }, 401);

  // Gate to the founder using the SAME check the admin dashboard uses.
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: isAdmin, error: adminErr } = await userClient.rpc('is_admin');
  if (adminErr || !isAdmin) return json({ error: 'Not authorized' }, 403);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Bad request body' }, 400);
  }

  const title = String(payload.title ?? '').trim();
  const description = String(payload.description ?? '').trim();
  const bodyMd = String(payload.body ?? '').trim();
  const tags: string[] = Array.isArray(payload.tags)
    ? payload.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 6)
    : [];

  if (title.length < 8) return json({ error: 'Title is too short.' }, 400);
  if (description.length < 20) return json({ error: 'Description is too short (it is your SEO snippet).' }, 400);
  if (bodyMd.length < 200) return json({ error: 'Body is too short to be a real post.' }, 400);
  if (bodyMd.includes('—')) return json({ error: 'Please remove em dashes (—) before publishing.' }, 400);

  const slug = slugify(title);
  if (!slug) return json({ error: 'Could not build a URL from that title.' }, 400);

  const today = new Date().toISOString().slice(0, 10);
  const fmTags = (tags.length ? tags : ['safety'])
    .map((t) => `"${t.replace(/"/g, '')}"`)
    .join(', ');

  const md = `---
title: "${title.replace(/"/g, "'")}"
description: "${description.replace(/"/g, "'")}"
pubDate: ${today}
author: "ORBII Safety"
tags: [${fmTags}]
---

${bodyMd}
`;

  const GH = Deno.env.get('GITHUB_TOKEN');
  if (!GH) return json({ error: 'Server not configured: missing GITHUB_TOKEN.' }, 500);
  const REPO = Deno.env.get('BLOG_REPO') || 'jatinnx777/ORBII-WEBSITE-';
  const path = `src/content/blog/${slug}.md`;
  const apiUrl = `https://api.github.com/repos/${REPO}/contents/${path}`;
  const ghHeaders = {
    Authorization: `Bearer ${GH}`,
    'User-Agent': 'orbii-admin',
    Accept: 'application/vnd.github+json',
  };

  // Don't overwrite an existing post.
  const head = await fetch(apiUrl, { headers: ghHeaders });
  if (head.status === 200) {
    return json({ error: 'A post with this title already exists. Change the title.' }, 409);
  }

  const put = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...ghHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `blog: ${title}`,
      content: toBase64(md),
      branch: 'main',
    }),
  });

  if (!put.ok) {
    const t = await put.text();
    return json({ error: `Publish failed (${put.status}). ${t.slice(0, 180)}` }, 502);
  }

  return json({ ok: true, slug, url: `https://orbii.in/blog/${slug}` });
});
