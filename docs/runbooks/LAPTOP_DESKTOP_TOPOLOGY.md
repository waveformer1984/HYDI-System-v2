# Laptop (primary) + desktop (GPU / HYDI host) — topology B

> **Ground truth (2026-11-20, operator-reported):** Windows name **`DESKTOP-I719OIN`** may
> be a **laptop** (built-in display, battery, ~15.7 GB RAM, no dGPU) — not the GPU tower.
> PM2, Devin, and `C:\Users\Owner\HYDI-System-v2` may therefore run on the **weaker**
> machine today. Tailscale name **`heidi-pc`** might still point at that laptop until
> you re-home it. **Verify before acting on any step below.**

This runbook describes the **target** layout: laptop = control plane; **GPU tower** =
compute host. It is **not** a claim about current production until the discovery
checklist passes.

**Operator model (target):** You live on the **laptop** day to day. The **GPU tower** is
the compute host: Ollama, Docker/Supabase, PM2 fleet, and the canonical tree.

Physical docking or KVM does **not** replace network control plane. “Connected” means
**Tailscale + explicit roles**, not only a cable.

## Discovery checklist (run first on every machine)

Run on **each** Windows box (laptop and tower). Paste results into a note; do not trust
the `DESKTOP-*` hostname alone.

```powershell
$env:COMPUTERNAME
systeminfo | findstr /B /C:"OS Name" /C:"System Model" /C:"Total Physical Memory"
Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object EstimatedChargeRemaining, BatteryStatus
Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM
pm2 jlist 2>$null | ConvertFrom-Json | Select-Object name, pm2_env | Format-Table
Test-Path C:\Users\Owner\HYDI-System-v2
```

**Tailscale admin / app:** which device is named **`heidi-pc`**? Note the machine model
next to that entry.

| Question | Laptop expected | Tower expected (target host) |
|----------|-----------------|------------------------------|
| Battery API present? | Often yes | Usually no |
| dGPU in `Win32_VideoController`? | Often iGPU only | Discrete NVIDIA/AMD |
| PM2 `hydi-boot` running? | **Today: possibly yes** | Target: **yes after migration** |
| `heidi-pc` MagicDNS | Today: may be laptop | Target: tower |

**Do not merge topology docs or run “confirm desktop” curls until this table is filled.**

## Tower: check remotely before login or reset

**Do not reset the tower** until you know what is on it. A Windows reset removes apps and
services (PM2, Docker, Ollama) and may destroy unverified HYDI data. **You do not need the
tower for daily HYDI today** — production may run on the laptop; the tower is the
**upgrade path**, not an emergency.

### 1. From the phone (~2 min, no tower login)

1. **Tailscale admin** ([login.tailscale.com](https://login.tailscale.com) → **Machines**):
   find the tower (not the laptop). Note name, **online/offline**, and **last seen**.
   Online ⇒ something on the machine is up and on the tailnet.
2. If online, try (MagicDNS): `https://<tower-hostname>.tailc50af2.ts.net/api/health` or
   `http://<tower-name>:3000/api/health` in the phone browser **with Tailscale on**. Any
   HTTP response suggests HYDI or another web stack on that box.

### 2. Regain access (official paths before reset)

At the tower lock screen:

| What you see | Action |
|--------------|--------|
| **Email address** on sign-in | Microsoft account — reset at [account.live.com/password/reset](https://account.live.com/password/reset), then sign in on the tower |
| **PIN** | “I forgot my PIN” → Microsoft account flow |
| **Local account** (name only, no email) | “Reset password” under the box (security questions if configured) |

Also: [account.microsoft.com/devices](https://account.microsoft.com/devices) — if the tower is
listed, save any **BitLocker recovery key** before recovery or reset.

### 3. Reset (last resort only)

Only if Tailscale shows **nothing important** on the tower and you accept wiping services:

Sign-in screen → hold **Shift** → Power → **Restart** → Troubleshoot → **Reset this PC**.
Even **Keep my files** removes installed apps (PM2, Docker, Ollama). If BitLocker asks for a
key you do not have, **stop** — do not proceed.

A **clean tower** after verified wipe is acceptable: install HYDI host role from scratch (PM2,
Ollama with GPU, Supabase, Tailscale as `heidi-pc`) and **restore laptop data from a backup**
— preferable to untangling unknown legacy nodes.

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

## Planned migration (tower becomes host — not a quick switch)

Only after discovery confirms the tower has **more RAM + GPU** and you have a **DB backup**:

1. **Backup** Supabase/Docker volume and `heidi-core/data/*.db` from the current host.
2. **Freeze** merges/auto-deploy on the current host until cutover plan is written.
3. **Install** stack on tower: Node 22, PM2, Docker, repo at same path if possible.
4. **Restore** database; run `supabase db` / migration parity check.
5. **Retarget** Tailscale: rename nodes so **`heidi-pc`** = tower; run `serve-mcp.ps1` / `serve-heidi-web.ps1` on tower only.
6. **Stop** PM2 fleet on old laptop host (after tower health green).
7. **Re-run** `npm run runtime:audit` and production-truth collector on **new** host.

Repo has no recent automated “clone host” script — treat as an operator RFC before execution.

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

For Frank handoff and merge discipline, see `docs/reports/FRANK_CLOUD_TO_PRODUCTION_HANDOFF.md` and `artifacts/proof-of-value/OPERATIONAL_BLOCKERS.md`.

## Related docs

- `ACTIVE_TREE.md` — canonical path on desktop
- `docs/TAILSCALE.md` — serve, ACL, agent join
- `docs/CURSOR_CLOUD_AGENT.md` — cloud MCP to desktop