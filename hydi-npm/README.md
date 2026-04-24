# hydi-health-check

Production health monitoring for Supabase — trend analysis, auto-heal, and escalation logic. By **ProtoForge Industries**.

[![npm version](https://img.shields.io/npm/v/hydi-health-check.svg)](https://npmjs.com/package/hydi-health-check)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## What it does

HYDI gives your Supabase project a self-aware health system:

- **Queue health** — monitors `worker_jobs` for failures, dead jobs, and backlogs
- **Event flow** — tracks `event_bus_events` throughput and last-event time
- **Revenue signals** — detects payment droughts via `webhook_events`
- **Automation uptime** — heartbeat detection via `system:heartbeat` events
- **Trend analysis** — classifies recent runs as `stable | degrading | critical_trend`
- **Auto-heal** — can trigger recovery functions like `retry_failed_jobs()` and `flag_dead_jobs()`
- **Escalation logic** — emits escalation signals when thresholds are breached

---

## Install

Global CLI:

```bash
npm install -g hydi-health-check
```

Project dependency:

```bash
npm install hydi-health-check
```

---

## Quick start

```bash
# 1. Initialize (creates .env template)
hydi init

# 2. Fill in your Supabase credentials in .env

# 3. Run a health check
hydi check

# 4. View dashboard snapshot
hydi dashboard
```

---

## CLI commands

### `hydi init`

Creates .env template and prints command guide.

### `hydi check`

Runs full health check. Exits 1 on CRITICAL; exits 0 on OK or WARNING.

### `hydi trends`

Analyzes recent runs (requires SQL functions installed).

### `hydi heal`

Triggers auto_heal_from_trends() (privileged).

### `hydi dashboard`

Returns dashboard snapshot.

### `hydi ursula`

Returns natural-language summary.

All commands support `--json` for CI/Grafana/log ingestion.

---

## Security model

HYDI supports two credential modes:

**Safe default (recommended for checks/read paths):**
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

**Privileged mode (server-side only):**
- `SUPABASE_SERVICE_ROLE_KEY`

Required for write/escalation/heal flows depending on your SQL/RLS design.

**Important:**
- Never expose service role keys in browsers or untrusted clients.
- Run privileged operations in trusted backend jobs or protected Edge Functions.

---

## Node.js API

### Read-only / safe default

```js
const { HydiClient } = require('hydi-health-check');
const hydi = new HydiClient({
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_ANON_KEY,
});

const health = await hydi.check();
console.log(health.overall_status); // OK | WARNING | CRITICAL
```

### Privileged (server-only)

```js
const { HydiClient } = require('hydi-health-check');
const hydi = new HydiClient({
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY, // server only
});

const healed = await hydi.autoHeal();
console.log(healed);
```

---

## CI/CD integration

### Health checks (recommended with anon key)

```yaml
# .github/workflows/health.yml
- name: HYDI health check
  run: npx hydi-health-check check --json
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
```

### Privileged heal job (trusted environments only)

```yaml
- name: HYDI auto-heal
  run: npx hydi-health-check heal --json
  env:
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

---

## SQL functions (required for trends + auto-heal)

Trend analysis and auto-heal require PostgreSQL functions installed in your Supabase project.

**Installer source:** https://hydi.protoforgeindustries.com/install

**CLI installer:**

```bash
hydi install
```

If using hosted installer SQL:
- Review SQL before running.
- Run only in trusted environments.
- Prefer least-privilege execution where possible.

---

## Environment variables

**SUPABASE_URL** (required)
Your project URL (example: https://<project-ref>.supabase.co)

**SUPABASE_ANON_KEY** (recommended default)
For read-only monitoring paths.

**SUPABASE_SERVICE_ROLE_KEY** (privileged only)
For write/heal/escalation operations.

**HYDI_TOKEN** (Pro only)
Token from ProtoForge Industries.

**HYDI_ENV** (optional)
`production` or `staging` (default: production).

---

## Exit codes

- **0** → OK or WARNING
- **1** → CRITICAL
- **2** → runtime/config error (recommended convention)

---

## License

MIT © ProtoForge Industries
