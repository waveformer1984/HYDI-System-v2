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
Any `Tailscale-Funnel*` header also forces the public classification, even
if every visible address is internal.

**Limit.** A client that reaches port 3000 directly with no proxy in
between (an open router port forward) could claim `Host: localhost`. Don't
port-forward 3000. Put a public URL in front of heidi-web only through a
proxy that sets `X-Forwarded-For`, such as ngrok or Cloudflare Tunnel.

## Public allowlist (maximum)

- Galactic Bytes pages: `/galactic-bytes` and `/galactic-bytes/*`
- Galactic Bytes Checkout: `/api/galactic-bytes/checkout`
- Its signature-verified Stripe endpoint: `/api/billing/webhook`
- `/_next/*` build assets, `/favicon.ico`, and `/robots.txt`

Everything else is blocked from the outside, including `/`, `/heidi`,
`/board`, `/api/chat`, `/api/phone/*`, `/api/mobile-ops/*`, billing admin,
status, devices, approvals, proposals, the revenue service switch and
credentials.

## Settings

| Variable | Effect |
|---|---|
| `HYDI_PUBLIC_PATHS` | May narrow the hard-coded maximum allowlist. It cannot expose another path. |
| `HYDI_TRUSTED_HOSTS` | Extra host names treated as internal, for example a LAN name. |

## Rules that go with it

- Funnel is enabled or disabled only by a human running
  `scripts/frank-funnel.ps1` (or its printed command). Nothing installs it as
  an automatic startup task.
- Funnel publishes the narrow Galactic Bytes surface, never HYDI operator
  routes. Tailnet Serve remains the private access path.
