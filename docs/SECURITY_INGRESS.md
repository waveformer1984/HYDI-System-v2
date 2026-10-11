# Public-ingress gate

HYDI is meant to be reachable only from your own devices: this PC, the LAN
and the tailnet (`heidi-pc.tailc50af2.ts.net`). Selling still needs a few
public endpoints, such as Stripe webhooks and the customer checkout pages,
so a tunnel (ngrok today) points a public URL at heidi-web on port 3000.
Without a gate, that tunnel publishes everything heidi-web serves.

`proxy.ts` (Next.js 16 proxy, formerly "middleware") runs
`lib/security/ingressGate.js` on every request:

| Request comes from | It can reach |
|---|---|
| This PC, the LAN, the tailnet | everything (unchanged) |
| The public internet (ngrok, Funnel, a port forward) | only the allowlist below; everything else answers `404` |

## How "public" is detected

- **Forwarded hops.** Every `X-Forwarded-For` / `X-Real-IP` / `Forwarded`
  hop must be a loopback, private (RFC 1918), link-local or tailnet
  (`100.64.0.0/10`, `fd7a:…`) address. Tunnels append the real client IP,
  and a client can't remove a hop the tunnel appended. That makes the check
  hold even when the tunnel rewrites `Host` to `localhost`.
- **Host.** It must be loopback, a private-IP literal, a `*.ts.net` tailnet
  name, or listed in `HYDI_TRUSTED_HOSTS`. An ngrok domain or any real
  domain counts as public.

Tailscale Funnel uses the same `*.ts.net` host as tailnet serve, but its
forwarded hop is a public IP, so Funnel traffic is treated as public too.

**Limit.** A client that reaches port 3000 directly with no proxy in
between (an open router port forward) could claim `Host: localhost`. Don't
port-forward 3000. Put a public URL in front of heidi-web only through a
proxy that sets `X-Forwarded-For`, such as ngrok or Cloudflare Tunnel.

## Public allowlist (default)

- Stripe webhooks: `/api/webhooks/stripe`, `/api/stripe-connect-webhook`,
  `/api/billing/webhook`
- Customer billing: `/api/billing/{catalog,checkout,account,portal,subscription,ai/complete}`
  (not `/api/billing/admin/*`)
- Customer jobs: `POST /api/revenue/jobs`, `/api/revenue/jobs/<id>`,
  `/api/revenue/jobs/<id>/{delivery,download}` (not `approve` or `reconcile`)
- Customer pages: `/services/*`, `/pricing`, `/billing`, `/success`,
  `/cancel`, `/signup`
- `/api/ping`, `/_next/*` build assets, `/favicon.ico`, `/robots.txt`

Everything else is blocked from the outside, including `/`, `/heidi`,
`/api/chat`, `/api/health`, status, devices, approvals, proposals, the
revenue service switch and credentials.

## Settings

| Variable | Effect |
|---|---|
| `HYDI_PUBLIC_PATHS` | Replaces the allowlist. Comma-separated; an entry ending in `/` is a prefix, otherwise an exact path. |
| `HYDI_TRUSTED_HOSTS` | Extra host names treated as internal, for example a LAN name. |
| `HYDI_INGRESS_GATE=off` | Disables the gate. Not recommended. |

## Rules that go with it

- No agent may make HYDI public. `protoforge:stable-public-url` is an owner
  decision (R2), and the old Tailscale Funnel resolver is removed.
- Never enable Tailscale Funnel on heidi-pc (`docs/TAILSCALE.md`).
