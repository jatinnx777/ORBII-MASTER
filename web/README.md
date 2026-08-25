# orbii.app static landing pages

Self-contained HTML pages that ORBII deep-links reference (e.g. the
`https://orbii.app/join/<token>` URL embedded in the WhatsApp invite
message sent from the Circle Invite screen).

## Why this exists

When a user invites someone by phone, ORBII generates a share link of the
form `https://orbii.app/join/<token>`. If the recipient has ORBII
installed, Android intercepts the link and opens the app directly. If
they don't, they land on this page and see install buttons.

Without this page, the link is dead for anyone without the app — which
is most of the inviter's contacts. With this page, the join link works
universally.

## Files

```
web/
├── README.md          # this file
└── join/
    └── index.html     # /join/* route — handles invite tokens
```

## How to deploy

Pick any free static host. The directory structure already matches the
URL structure (`/join/index.html` serves at `/join/*`).

**Recommended: Cloudflare Pages.**

```bash
# One-time: install Wrangler if you haven't.
npm install -g wrangler
wrangler login

# Deploy the web/ directory.
cd web
wrangler pages deploy . --project-name orbii-app
```

Then in Cloudflare → Pages → orbii-app → Custom domains, point
`orbii.app` at the project. DNS happens once; deploys re-upload.

**Alternative: GitHub Pages.**

1. Push this repo to GitHub.
2. Settings → Pages → Source: `main` branch, `/web` folder.
3. Add a CNAME file inside `web/` pointing to `orbii.app`.

**Alternative: Vercel.**

```bash
npm i -g vercel
cd web
vercel --prod
```

Then alias your production deployment to `orbii.app`.

## Testing locally

```bash
cd web
python3 -m http.server 8080
# visit http://localhost:8080/join/abc123
```

You should see the invite landing page with the token displayed. The
auto-redirect to `orbii://join/abc123` will fail in desktop browsers
(no app installed), which is exactly the fallback flow real users will
see if they don't have ORBII.
