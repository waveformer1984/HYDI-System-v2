# HYDI Runtime Recovery Gate

## Scope

Recover and validate the HYDI runtime without modifying the dashboard/bridge architecture. Supabase remains intentionally not repaired.

## Gate 1 — Supabase Recovery

- Project: `akbnfovjdcobifeupvbn`
- Status: `INACTIVE`
- DNS: fails (`getaddrinfo ENOTFOUND`)
- HTTPS: unreachable
- Credential/project ref: match

**Action required:** Reactivation cannot be performed from this environment.

The Supabase CLI (`v2.90.0`) only supports `projects list`, `create`, and `delete`; it has no `resume` or `unpause` subcommand. The canonical recovery workflow is a manual dashboard action at:

```text
https://supabase.com/dashboard/project/akbnfovjdcobifeupvbn
```

**Verdict:** BLOCKED — human Supabase dashboard action required.

## Gate 2 — Supabase Schema

Schema validation is blocked by the same lack of connectivity. The intended objects are:

- `system_dashboard` (used by `api/health.js` and `api/ursula/status.js`)
- `system_health` (used by `api/health.js`)
- `infrastructure_health` (used by `api/ursula/status.js`)

The code expects a `system_dashboard` row with `current_status`, `trend_status`, `escalation_level`, and queue columns. These objects cannot be verified against a live schema until the project is reactivated.

**Verdict:** NOT TESTED (Supabase INACTIVE)

## Gate 3 — AI Runtime

- Configured runtime: **Ollama**
- Configured URL: `http://localhost:11434` (Windows default)
- Configured model: `llama3` (per `services-manifest.json`)
- Provider: `ollama`
- `memory-engine.js` also uses `process.env.OLLAMA_URL` defaulting to `http://localhost:11434`

**Issue found:** The Next.js dev server runs inside WSL. WSL `localhost` did not resolve to the Windows Ollama service. Ollama was also bound only to `127.0.0.1` on Windows.

**Recovery performed:**
1. Stopped the Windows Ollama process.
2. Restarted Ollama with `OLLAMA_HOST=0.0.0.0:11434 ollama serve` so it listens on all interfaces.
3. Added `LOCAL_MODEL_URL`, `LOCAL_MODEL_NAME=llama3`, `LOCAL_MODEL_PROVIDER=ollama`, and `OLLAMA_URL` to `.env.local` pointing at the WSL-visible Windows host IP (`192.168.48.1:11434`).
4. Restarted the Next.js dev server on port 3001.

**Verdict:** GO — AI runtime reachable from the HYDI server.

## Gate 4 — Heidi

After AI runtime recovery:

```bash
curl -X POST -d '{"action":"status"}' http://localhost:3001/api/heidi
```

Result:

```json
{
  "initialized": true,
  "available": true,
  "currentModel": "llama3",
  "provider": "ollama",
  "initError": null
}
```

Basic inference test:

```json
{
  "response": "...",
  "model": "llama3",
  "provider": "ollama",
  "fallback": false
}
```

The collector now reports:

```text
Heidi = healthy
```

**Verdict:** PASS

## Gate 5 — Ursula

`api/ursula/status.js` authoritative source:

- `supabase.from('system_dashboard').select('*').single()`
- `supabase.rpc('auto_heal_from_trends')`
- `supabase.from('infrastructure_health')...`

Direct test result:

```json
{
  "status": "error",
  "message": "Unable to retrieve system status"
}
```

The endpoint returns `error` because Supabase is `INACTIVE`. It does not provide a meaningful status while the cloud project is down. The collector maps this as `unknown` (timeout) or `down` (when the response is captured).

**Verdict:** BLOCKED (depends on Supabase)

## Gate 6 — CASCADE / KILO / ProtoForge / Hyve

Discovery performed:

- `services-manifest.json`: no separate services for these agents.
- `docker ps`: no separate containers.
- `api/agent-manager/agents.js`: lists them in a registry, all routed to `api/chat/route.js`.
- `api/chat/route.js`: universal chat router; requires `x-hydi-service-token` and executes agent logic. No status-only endpoint.

These agents are in-process logic, not independently running services. There is no authoritative health signal that can be checked without executing a chat request.

| Agent | Runtime | Health Source | Verdict |
|---|---|---|---|
| CASCADE | `api/chat/route.js` | none | UNKNOWN |
| KILO | `api/chat/route.js` | none | UNKNOWN |
| ProtoForge | `api/chat/route.js` | none | UNKNOWN |
| Hyve | `api/chat/route.js` | none | UNKNOWN |

## Gate 7 — Dependency Graph

```text
Ollama (Windows: 0.0.0.0:11434)
  ↓
api/heidi.js (LOCAL_MODEL_URL)
  ↓
Heidi → healthy

Supabase cloud (akbnfovjdcobifeupvbn) — INACTIVE
  ↓
api/ursula/status.js → auto_heal_from_trends RPC
  ↓
Ursula → error

Supabase cloud (akbnfovjdcobifeupvbn) — INACTIVE
  ↓
api/health.js → system_dashboard view
  ↓
Pipeline → unavailable

CASCADE / KILO / ProtoForge / Hyve
  ↓
api/chat/route.js (requires service token)
  ↓
No status signal → UNKNOWN

Local Supabase containers (Docker) — all healthy
  ↓
Not the same project as the cloud Supabase dependency
```

Critical dependencies:
- Ollama — RECOVERED
- Supabase cloud — BLOCKED

Optional dependencies:
- Ursula display — degraded while Supabase down
- Pipeline health view — degraded while Supabase down

## Gate 8 — Operational Verification

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | PASS |
| Unit tests | `npm test` | PASS |
| Readiness | `npm run hydi:readiness` | READY |

## Gate 9 — No-Go Protection

The system should not be declared fully operational because Supabase cloud is still `INACTIVE`. `api/health` and `api/ursula/status` still fail. The dashboard is honest about this (`supabase: down`, `pipeline: unknown`).

## Final Verdict

| Area | Verdict |
|---|---|
| Supabase cloud | BLOCKED |
| Supabase schema | NOT TESTED |
| AI runtime (Ollama) | GO |
| Heidi | PASS |
| Ursula | BLOCKED (Supabase) |
| CASCADE | UNKNOWN |
| KILO | UNKNOWN |
| ProtoForge | UNKNOWN |
| Hyve | UNKNOWN |
| `npm run typecheck` | PASS |
| `npm test` | PASS |
| `npm run hydi:readiness` | READY |
| Security scan | PASS |

**Overall:** NO-GO due to the inactive Supabase cloud project.

## Required Next Step

Reactivate the Supabase project `akbnfovojdcobifeupvbn` via the Supabase dashboard at:

```text
https://supabase.com/dashboard/project/akbnfovjdcobifeupvbn
```

After reactivation, re-run `api/health`, `api/ursula/status`, the collector, and the poller to validate end-to-end status.
