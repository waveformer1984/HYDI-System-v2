# Ursula operator security

Ursula is a **loopback-only operator console**, not a public ingress surface.

## Bind

- Production: PM2 `ursula-local` runs `next start --hostname 127.0.0.1 --port 3100` (`ecosystem.config.js`).
- Local scripts: `npm run start` / `npm run dev` use `-H 127.0.0.1` in `apps/ursula-frontend/package.json`.
- Do not bind `0.0.0.0` unless you accept LAN/tailnet Host-header forgery; state-changing routes still require `URSULA_ADMIN_TOKEN`.

## URSULA_ADMIN_TOKEN

Set in `.env.local` (Frank) and PM2 `ursula-local --update-env`. Never expose to the browser.

Routes under `/api/devices`, `/api/heidi/*`, job-scout mutations, and `POST /api/apps/*/start` require:

1. Loopback Host (and no untrusted proxy headers) via `isLocalRequest`, and
2. `Authorization: Bearer <URSULA_ADMIN_TOKEN>` **or** the HttpOnly `ursula_operator_session` cookie (HMAC — not the raw token) set by the root layout on loopback page loads.

## Off-box access

Use Heidi Mobile (`:3006`, device login) or SSH port-forward to `127.0.0.1:3100` — do not expose Ursula via Tailscale Funnel.
