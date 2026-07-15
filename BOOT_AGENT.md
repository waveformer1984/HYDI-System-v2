# HYDI Boot Agent

A single command that boots **Heidi** (the Next.js web layer) and **all subsequent
ProtoForged modules** in dependency order, with preflight checks, health gating,
live colorized logs, and graceful shutdown.

```bash
npm run boot          # development (next dev)
npm run boot:prod     # production (next start -- run `npm run build` first)
npm run boot:plan     # print the resolved boot plan and exit (starts nothing)
```

## What it boots

The boot set is data-driven and lives in [`boot.config.json`](./boot.config.json).
Out of the box:

| # | Module | What it is | Port | Health gate |
|---|--------|-----------|------|-------------|
| 1 | `protoforge-core` | `src/server.js` — CASCADE V2 / KILO / ProtoForge pipeline + Universal Agent Bus | 3005 | `GET /health` |
| 2 | `heidi-web` | Next.js web + API routes (Heidi, Ursula, revenue, Stripe webhooks) | 3000 | `GET /api/health` |
| 3 | `hydi-orchestrator` | In-process `HYDISystem` core loop (Observe→Decide→Act) | — | start()/shutdown() |

Two more are pre-registered but **disabled** (`"enabled": false`) so you can flip
them on when the hardware is attached: `hardware-agent` (Python HID safety
orchestrator) and `trading-loop`.

Boot order is computed from each module's `dependsOn`, and the agent waits for a
module to report **healthy** before starting anything that depends on it. This
respects the V2 principle of anchoring ground truth (ProtoForge core) before the
layers on top come online.

## Flags

| Flag | Effect |
|------|--------|
| `--prod` | Use each module's `argsProd` (e.g. `next start` instead of `next dev`). |
| `--only=a,b` | Boot only these module ids, plus their dependencies. |
| `--skip=a,b` | Skip these module ids. |
| `--no-health` | Spawn everything without waiting on health checks. |
| `--dry-run` | Print the resolved plan and exit. |
| `--json` | Emit machine-readable status lines (for an external supervisor). |
| `--config=PATH` | Use an alternate config file. |

Examples:

```bash
node scripts/boot-agent.js --only=protoforge-core      # backend only
node scripts/boot-agent.js --skip=hydi-orchestrator    # skip the core loop
node scripts/boot-agent.js --prod                      # production commands
```

## Preflight

Before booting, the agent checks: Node ≥ 20, presence of `.env`/`.env.local`,
and the env vars listed under `settings.requiredEnv` (boot is aborted if any are
missing) and `settings.warnEnv` (warning only). Adjust those lists in
`boot.config.json`.

If a module's port is already in use, the agent assumes that service is already
running and skips spawning it (marked `external`) instead of crashing.

## Lifecycle

- **Required module crashes** → the agent fails fast, tears everything down, and
  exits non-zero (good for a service wrapper / `nssm` / Task Scheduler restart).
- **Ctrl+C / SIGTERM** → graceful shutdown in reverse order: in-process modules get
  their `stopMethod` (`HYDISystem.shutdown()`), child processes get `SIGTERM`, then
  `SIGKILL` after `settings.shutdownTimeoutMs`.

## Adding a new ProtoForged module

Append an entry to `boot.config.json` — no code change required.

A child process with an HTTP health endpoint:

```json
{
  "id": "my-module",
  "label": "My ProtoForged Module",
  "type": "process",
  "enabled": true,
  "required": false,
  "command": "node",
  "args": ["modules/my-module.js"],
  "env": { "PORT": "3010" },
  "port": 3010,
  "health": { "url": "http://127.0.0.1:3010/health", "graceMs": 60000 },
  "dependsOn": ["protoforge-core"]
}
```

An in-process module (a class with a `start()` method):

```json
{
  "id": "my-inproc",
  "label": "My In-Process Module",
  "type": "module",
  "module": "modules/my-thing.js",
  "construct": true,
  "config": {},
  "method": "start",
  "stopMethod": "stop",
  "dependsOn": ["protoforge-core"]
}
```

`construct: true` means the export is a class the agent will `new` (passing
`config`); omit it if the file exports an already-constructed object. Use
`export` to pick a named export instead of the default.

## Auto-start on `heidi-pc` (recommended: scheduled task, no admin)

Run the installer once. It registers a **per-user Scheduled Task that fires at
logon** — no administrator/UAC prompt, because it runs as you at Limited run
level, which means it inherits your PATH, your `.env`, and your Tailscale user
context (a SYSTEM-level service would have none of those):

```powershell
# install (dev mode = next dev)
powershell -ExecutionPolicy Bypass -File scripts\install-boot-service.ps1

# or production mode (run `npm run build` first)
powershell -ExecutionPolicy Bypass -File scripts\install-boot-service.ps1 -Mode prod

# start it now without waiting for a reboot
Start-ScheduledTask -TaskName "HYDI Boot Agent"

# check it
Get-ScheduledTask -TaskName "HYDI Boot Agent" | Get-ScheduledTaskInfo

# remove it
powershell -ExecutionPolicy Bypass -File scripts\install-boot-service.ps1 -Remove
```

The task calls `scripts\run-boot.cmd`, which runs the boot agent and appends all
output to `logs\boot-agent.log`. It restarts up to 3× (1 min apart) if it dies.

`tailscale serve` persists across reboots on its own, so once the stack is up the
tailnet endpoint `https://heidi-pc.tailc50af2.ts.net/` comes back automatically.

### Alternative: run before logon (Windows service, needs admin)

A logon task only starts after you sign in. If `heidi-pc` must serve while
signed out, run the agent as a true service with [`nssm`](https://nssm.cc/) from
an **elevated** prompt (this requires administrator rights):

```powershell
nssm install HeidiBoot "C:\Program Files\nodejs\node.exe" "C:\Users\Owner\HYDI_System\scripts\boot-agent.js"
nssm set HeidiBoot AppDirectory "C:\Users\Owner\HYDI_System"
nssm start HeidiBoot
```

Note that a SYSTEM-context service won't see your user `.env` or Tailscale login
unless you configure those explicitly.
