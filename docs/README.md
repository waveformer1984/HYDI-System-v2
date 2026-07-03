# HYDI Mobile Chat (GitHub Pages)

A free, static, installable mobile chat client for HYDI. No app store, no hosting
bill — it's plain HTML/JS served by GitHub Pages and it talks directly to your
existing HYDI API on Vercel.

## What's in here

| File | Purpose |
|------|---------|
| `index.html` | The entire chat app (UI, HMAC token minting, health badge) |
| `manifest.webmanifest` | PWA manifest — makes it installable on a phone |
| `sw.js` | Service worker — instant loads + offline app shell |
| `icons/` | App icons (SVG + 192/512 PNG) |

## One-time setup

1. **Enable GitHub Pages** — the `deploy-pages.yml` workflow publishes `docs/`
   automatically on push to `clean-main`. In the repo settings under
   **Pages → Source**, choose **GitHub Actions** (first run only). You can also
   trigger it manually from the Actions tab (`workflow_dispatch`).
2. **Open the site on your phone**:
   `https://<your-username>.github.io/<repo-name>/`
3. Tap **⚙️** and enter:
   - **API base URL** — your HYDI Vercel deployment, e.g. `https://your-hydi.vercel.app`
   - **Service secret** — the value of `HYDI_SERVICE_SECRET` on that deployment
4. (Optional) **Add to Home Screen** — Chrome/Android will offer to install it
   as an app (standalone window, app icon, offline shell).

## How auth works

`/api/chat` requires an HMAC-SHA256 service token (`x-hydi-service-token`).
This client mints that token **on-device** with the Web Crypto API using the
secret you enter in settings. The secret is stored only in your browser's
localStorage and never transmitted — only the short-lived (5-minute window)
signature is sent with each request.

> ⚠️ Only enter the service secret on a device you own and trust. Anyone with
> the secret can talk to your HYDI chat API.

Optionally pin CORS to your Pages origin by setting `MOBILE_CHAT_ORIGIN`
(e.g. `https://<your-username>.github.io`) on the Vercel project; it defaults
to `*` since the HMAC token is what actually gates access.

## Endpoints used

- `POST {API}/api/chat` — `{ message, system }`, systems: heidi, ursula,
  cascade, kilo, protoforge, hyve, infrastructure, rezonate
- `GET {API}/api/mobile-status` — powers the health dot in the header
