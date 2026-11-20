# Laptop (primary) + desktop (GPU / HYDI host) — topology B

**Operator model:** You live on the **laptop** day to day. The **big desktop** is the compute host: Ollama (GPU), Docker/Supabase, PM2 fleet, and the canonical `HYDI-System-v2` tree in production.

Physical docking or KVM does **not** replace network control plane. “Connected” means **Tailscale + explicit roles**, not only a cable.

## Role split

| Concern | Laptop (primary) | Desktop (compute / Frank) |
|---------|------------------|---------------------------|
| Daily UI, Cursor, Claude, Devin | **Yes** | Optional second screen only |
| Canonical git tree for **live** PM2 | Edit/pull here OK; **exec cwd must be desktop** | **`C:\Users\Owner\HYDI-System-v2`** on `clean-main` |
| PM2 / `npm run boot` / auto-deploy | **Do not** run as second fleet | **Yes** — single source of truth |
| Ollama / heavy inference | Thin client or API to desktop | **Bind 127.0.0.1**; expose via `tailscale serve` only |
| Supabase local (Docker) | Optional dev-only; not prod | **Prod-local** data plane on desktop |
| Tailscale | Always-on when operating HYDI | Always-on; MagicDNS name e.g. `heidi-pc` |
| Phone PWA / Heidi mobile | Browser → **desktop** tailnet URL | Serves `:3000` / `:3006` |

Confirm live tree on desktop:

```powershell
pm2 describe hydi-boot | findstr "exec cwd"
# MUST show C:\Users\Owner\HYDI-System-v2
```

## Tailscale tags (recommended)

| Machine | Hostname | Tag | Why |
|---------|----------|-----|-----|
| Desktop | `heidi-pc` (existing) | `tag:hydi-host` | HYDI, MCP :8470, Ollama serve |
| Laptop | e.g. `owner-laptop` | `tag:laptop-primary` or member only | Full member access to `tag:hydi-host` |

**Cloud agents:** keep `tag:agent` → `tag:hydi-host` **tcp:8470 only** (read-only MCP). Agents do not attach to the laptop unless you add a deliberate second role.

Example grants (admin console — merge with existing policy in `docs/TAILSCALE.md`):

```json
"tagOwners": {
  "tag:hydi-host": ["autogroup:admin"],
  "tag:agent": ["autogroup:admin"]
},
"grants": [
  { "src": ["autogroup:member"], "dst": ["tag:hydi-host"], "ip": ["*"] },
  { "src": ["tag:agent"], "dst": ["tag:hydi-host"], "ip": ["tcp:8470"] }
]
```

Your laptop is covered by `autogroup:member` for Heidi PWA, SSH (if enabled), and diagnostics.

## What “desktop connected to laptop” means in software

1. **Tailscale** on both machines — same account, both **Connected**.
2. From laptop: resolve `heidi-pc.tailc50af2.ts.net` (MagicDNS).
3. **Desktop** runs `tailscale serve` for heidi-web (`443` → `3000`) and MCP (`8470` → `3470`) per `scripts/tailscale/serve-heidi-web.ps1` and `serve-mcp.ps1`.
4. **Laptop** uses tailnet URLs only — not `192.168.x.x` leftovers in Termux or thin-client env.
5. **One** active PM2 process list — on desktop only.

### Quick verification (run on laptop)

```powershell
# PowerShell on laptop (Tailscale connected)
curl.exe -s -o NUL -w "heidi-web %{http_code}`n" https://heidi-pc.tailc50af2.ts.net/api/health
curl.exe -s https://heidi-pc.tailc50af2.ts.net:8470/healthz
```

Expect HTTP 200 (or documented degraded health with body), not timeout/DNS failure.

### Quick verification (run on desktop)

```powershell
cd C:\Users\Owner\HYDI-System-v2
powershell -ExecutionPolicy Bypass -File scripts\tailscale\diagnose-phone-access.ps1
tailscale serve status
```

## Development workflow (laptop primary, desktop executes)

| Task | Where |
|------|--------|
| Edit code, branch, push, open PR | Laptop (or cloud agent) |
| Merge to `clean-main` | GitHub |
| Pull + build + `frank-auto-deploy` | **Desktop only** |
| Local integration test with real Ollama | Desktop, or laptop calling desktop Ollama URL |
| PROJECT OMEGA live audit | Cloud agent via MCP → desktop |

Avoid `npm run boot` on the laptop while desktop PM2 is up — port conflicts and split brain.

## Ollama on desktop (laptop as client)

Desktop: keep Ollama on **localhost**; do not bind `0.0.0.0` on the public LAN.

Optional tailnet serve (laptop + phone use HTTPS to desktop):

```powershell
# On desktop — tailnet only, see docs/TAILSCALE.md
tailscale serve --bg --https=11434 http://127.0.0.1:11434
```

Laptop env (example): `OLLAMA_BASE_URL=https://heidi-pc.tailc50af2.ts.net:11434` for tools that support it; HYDI ecosystem on desktop still prefers local `127.0.0.1:11434`.

## Remote agents (PROJECT OMEGA / cloud)

See `docs/CURSOR_CLOUD_AGENT.md` and `/opt/cursor/artifacts/REMOTE_TUNNEL_STRATEGY.md` (artifact).

- **Tier A (now):** `TS_AUTHKEY` + `PROTOFORGE_MCP_TOKEN` → live read-only Frank state on **desktop**.
- **Tier C (mission E2E):** Self-hosted Cursor worker installed on **desktop**, not laptop — matches where PM2 runs.

## Anti-patterns (topology B)

| Mistake | Risk |
|---------|------|
| PM2 on laptop and desktop with same repo | Duplicate processes, wrong health, OOM |
| Laptop `HYDI_System` stale clone treated as canonical | Code/reality drift |
| Auto-deploy on laptop | Builds competing with desktop RAM |
| Funnel on MCP or Postgres | Public exposure of ops/financial tools |
| Assuming dock = networked | No tailnet → phone/agents cannot reach HYDI |

## Unfreeze / ops from laptop

When Claude or Devin is stuck on **desktop** (Task Manager on desktop, or KVM to desktop):

1. End Devin + Claude on the machine where they run (often desktop if sessions live there).
2. Reopen Claude on **laptop** if that is your control surface.
3. Continue via tailnet to desktop HYDI — not by starting a second stack on the laptop.

For Frank RAM steps and merge discipline, see `docs/runbooks/FRANK_OPERATOR_CARD.md`.

## Related docs

- `ACTIVE_TREE.md` — canonical path on desktop
- `docs/TAILSCALE.md` — serve, ACL, agent join
- `docs/CURSOR_CLOUD_AGENT.md` — cloud MCP to desktop