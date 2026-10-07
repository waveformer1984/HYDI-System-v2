# protoforge-mcp

One MCP tool surface over ProtoForge (HYDI/Heidi on Frank, Supabase, Stripe),
so any agent — Claude Code on Frank, Claude on the phone, Heidi, a scheduled
task — acts on the business through the same audited tools instead of
bespoke scripts.

**v0.1 is read-only.** Every tool declares a risk tier and the registry
refuses to expose anything but `read`. Write tiers (`reversible`, `gated`)
arrive together with the Heidi triple gate (see "Roadmap").

## Tools

| Tool | Reads | Needs |
|------|-------|-------|
| `system_health` | protoforge-core `/health`, heidi-web `/api/health`, heidi-mobile-chat `/api/health` | services running |
| `mobile_status` | heidi-web `/api/mobile-status` (health + revenue per stream + pipeline latency) | `HYDI_SERVICE_SECRET` |
| `pending_approvals` | heidi-web `GET /api/actions` (ProtoForge escalations awaiting a human) | `HYDI_SERVICE_SECRET` |
| `recent_actions` | Supabase `actions` (no payloads) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `heidi_events` | Supabase `heidi_events` (verdict log) | same |
| `decision_bounds` | Supabase `heidi_decision_bounds` + lease state + `HEIDI_ALLOW_EXEC` | same |
| `stripe_balance` | Stripe `GET /v1/balance`, platform or one stream's Connect account | `STRIPE_SECRET_KEY`, `STRIPE_ACCOUNT_<STREAM>` |
| `boot_plan` | `boot.config.json` → enabled modules in boot order | — |

heidi-web calls are signed with an `x-hydi-service-token` minted from
`HYDI_SERVICE_SECRET` (same format `lib/auth/verifyServiceToken.js` checks),
so they authenticate as `owner`. Env comes from the repo root's `.env.local`
then `.env`, exactly like `scripts/health-check.js` — no second secret store.

> `boot_plan` deliberately does **not** run `boot-agent.js --dry-run`. That
> command claims the canonical boot lease before it checks `--dry-run`, which
> makes the PM2-supervised runtime stand down (exit 75, not respawned). The
> tool orders `boot.config.json` itself with the same Kahn sort instead.

## Run on Frank

```powershell
cd C:\Users\Owner\HYDI-System-v2\mcp\protoforge-mcp
npm install
npm test                     # 19 hermetic tests, no network
```

**Claude Code / Claude desktop on Frank (stdio)** — the repo's `.mcp.json`
already registers it as `protoforge`; open the repo and approve the server.

**Over the tailnet (HTTP)** — for Heidi, scripts, or other agents:

```powershell
# generate a token straight into .env.local (never echo it)
node -e "process.stdout.write('PROTOFORGE_MCP_TOKEN='+require('crypto').randomBytes(32).toString('hex')+'\n')" >> ..\..\.env.local
npm run start:http           # 127.0.0.1:3470, refuses to start without the token
tailscale serve --bg --https=8470 http://127.0.0.1:3470
```

Clients call `https://heidi-pc.tailc50af2.ts.net:8470/mcp` with
`Authorization: Bearer <token>`. `GET /healthz` is unauthenticated and returns
only name and version. The HTTP transport is stateless (JSON responses, POST
only).

Not done yet: a claude.ai custom connector reaches servers from Anthropic's
cloud, so a tailnet-only URL isn't reachable from it. That needs a public
HTTPS endpoint (e.g. Tailscale Funnel) plus an auth scheme the connector
supports — tracked as the next step rather than opened up here.

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `PROTOFORGE_MCP_HEIDI_WEB_URL` | `HYDI_API_URL` or `http://127.0.0.1:3000` | heidi-web base |
| `PROTOFORGE_CORE_URL` | `http://127.0.0.1:3005` | protoforge-core base |
| `PROTOFORGE_MCP_MOBILE_CHAT_URL` | `http://127.0.0.1:3006` | heidi-mobile-chat base |
| `PROTOFORGE_MCP_TIMEOUT_MS` | `8000` | per-call timeout |
| `PROTOFORGE_MCP_HOST` / `PROTOFORGE_MCP_PORT` | `127.0.0.1` / `3470` | HTTP bind |
| `PROTOFORGE_MCP_TOKEN` | — | required for `--http` |

## Roadmap

1. **v0.1 (this)** — read-only tools, stdio + tailnet HTTP.
2. **Reversible writes** — e.g. task status, labels, drafts; every call logged
   to `heidi_events`.
3. **Gated writes** — approve/reject via `POST /api/actions/[id]`, payments,
   restarts. Each must pass `HEIDI_ALLOW_EXEC` + AUTO-APPROVE ≥ 0.85 + within
   `heidi_decision_bounds`, or an explicit human approval from the phone.
4. **Public connector** — Funnel + connector-compatible auth so the Claude
   mobile app can attach it directly.
