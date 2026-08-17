# HYDI Mobile Chat (GitHub Pages)

A free, static, installable mobile chat client for HYDI. No app store, no hosting
bill — it's plain HTML/JS served by GitHub Pages and it talks directly to your
HYDI server (per `CLAUDE.md`'s Local-First Architecture decision, that's a
self-hosted Next.js instance reachable over Tailscale, not a Vercel deployment
— Vercel is deliberately unused).

## What's in here

| File | Purpose |
|------|---------|
| `index.html` | The entire chat app (UI, HMAC token minting, health badge, Ops tab) |
| `manifest.webmanifest` | PWA manifest — makes it installable on a phone |
| `sw.js` | Service worker — instant loads + offline app shell |
| `icons/` | App icons (SVG + 192/512 PNG) |
| `MOBILE_OPERATIONS.md` | Architecture/API reference for the Ops (mobile command center) tab |

## One-time setup

1. **Enable GitHub Pages** — the `deploy-pages.yml` workflow publishes `docs/`
   automatically on push to `clean-main`. In the repo settings under
   **Pages → Source**, choose **GitHub Actions** (first run only). You can also
   trigger it manually from the Actions tab (`workflow_dispatch`).
2. **Make your local HYDI server reachable over HTTPS.** GitHub Pages is
   HTTPS, and browsers block an HTTPS page from `fetch()`-ing a plain
   `http://` API, so a LAN IP alone won't work from this client. Use
   [Tailscale](https://tailscale.com) on the machine running `npm run dev` /
   `npm start`:
   ```bash
   tailscale cert <your-machine>.<tailnet>.ts.net
   ```
   then point the Next.js server at the resulting cert/key (see
   `launch-heidi-mobile.js`'s `HEIDI_TLS_CERT`/`HEIDI_TLS_KEY` for the same
   pattern used by the LAN chat bridge). Your phone reaches the server at
   `https://<your-machine>.<tailnet>.ts.net` as long as it's on the same
   tailnet — no port-forwarding or public exposure required.
3. **Open the site on your phone**:
   `https://<your-username>.github.io/<repo-name>/`
4. Tap **⚙️** and enter:
   - **API base URL** — your Tailscale HTTPS URL, e.g.
     `https://heidi-pc.your-tailnet.ts.net`
   - **Service secret** — the value of `HYDI_SERVICE_SECRET` on that server
     (leave blank for a local/Termux node that doesn't enforce auth)
5. (Optional) **Add to Home Screen** — Chrome/Android will offer to install it
   as an app (standalone window, app icon, offline shell).

Tap **🛰️** (Ops) after connecting for live health, worker fleet control,
memory search, and notifications — see `MOBILE_OPERATIONS.md` for the full
API surface it uses.

## How auth works

`/api/chat` requires an HMAC-SHA256 service token (`x-hydi-service-token`).
This client mints that token **on-device** with the Web Crypto API using the
secret you enter in settings. The secret is stored only in your browser's
localStorage and never transmitted — only the short-lived (5-minute window)
signature is sent with each request.

> ⚠️ Only enter the service secret on a device you own and trust. Anyone with
> the secret can talk to your HYDI chat API.

Optionally pin CORS to your Pages origin by setting `MOBILE_CHAT_ORIGIN`
(e.g. `https://<your-username>.github.io`) as an env var on the HYDI server;
it defaults to `*` since the HMAC token is what actually gates access.

## Endpoints used

- `POST {API}/api/chat` — `{ message, system }`, systems: heidi, ursula,
  cascade, kilo, protoforge, hyve, infrastructure, rezonate
- `GET {API}/api/mobile-status` — powers the health dot in the header
- The Ops tab additionally uses `/api/status/system`, `/api/agent-manager/control`,
  `/api/notifications`, `/api/memory/search` — see `MOBILE_OPERATIONS.md`

<!-- pages-deploy: v2 (auto-enablement) -->
