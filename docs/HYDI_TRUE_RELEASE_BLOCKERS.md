# HYDI True Release Blockers

## Classification

| Priority | Definition |
|---|---|
| **P0** | Prevents safe local operation of the defined operational core. |
| **P1** | Prevents a confident production deployment, but local operation can proceed. |
| **P2** | Missing capability, but core remains usable. |
| **P3** | Cleanup, technical debt, or documentation. |

## P0 — Prevents Safe Local Operation

| Blocker | Evidence | Why it is P0 | Path to resolve |
|---|---|---|---|
| `tsconfig.json` includes `vendor/` | `npm run build` and `npm run typecheck` fail on Deno `.ts` imports | A local core that cannot `next build` is not releasable | Exclude `vendor/` from `tsconfig.json` (completed during this phase) |

No other P0 blockers were identified. The local core (persistence, health, Ursula, Rezonate, workers, ProtoForge, CASCADE, KILO, revenue) exercised or has unit tests that pass with the local-first configuration.

## P1 — Prevents Production Deployment

| Blocker | Evidence | Why it is P1 | Path to resolve |
|---|---|---|---|
| Packet-level network isolation proof | `netsh trace` requires Administrator; only `netstat`/`Get-NetTCPConnection` evidence exists | Production release needs packet-level certainty before external trust | Re-run Phase 10 with an elevated PowerShell session and convert `.etl` to text |
| 42 Supabase Edge Functions not runtime-verified | Imports are vendored (`vendor/`, `deno.json`) but `supabase functions serve` was not exercised | Production may depend on these for billing/auth async paths | Start `supabase functions serve` and invoke each function offline |
| `/api/chat` conversational pipeline incomplete | `POST /api/chat` returned schema errors in the runtime session; `/api/heidi/route` returned a 500 render error | The full six-agent chat pipeline is not proven end-to-end | Debug request schema and local Ollama integration |
| `make_operational` acceptance mission | Not run end-to-end against a deliberately stopped safe local service (per `docs/HEIDI_OPERATIONAL_READINESS.md`) | Autonomous recovery is a central claim of the executive | Execute `scripts/hydi-cli.js readiness` and the acceptance mission |

## P2 — Missing Capability

| Blocker | Evidence | Why it is P2 | Path to resolve |
|---|---|---|---|
| `HealthAggregator` not wired to live probes | `docs/HEIDI_OPERATIONAL_CONTROL_PLANE.md` lists this as remaining work | Local operation works, but real-time health is `UNKNOWN` for many components | Register Ollama, Docker, Supabase, and worker health collectors |
| `AuditLog` / `ApprovalManager` in-memory only | Tests use in-memory instances; persistent storage path not integrated | Approval records and audit trails are not durable across restarts | Implement Supabase-backed `AuditLog` and `ApprovalManager` |
| `ControlledExecutor` real executors not demonstrated | `docker.local`, `wsl.local`, `database.local` are MEDIUM capabilities with no live executor | Heidi cannot actually restart/recover a stopped local service | Implement `DockerExecutor`, `WslExecutor`, `DatabaseExecutor` |
| Live dashboard polling | `dashboard/heidi-control-plane.html` has no live API polling | Executive dashboard is static | Add WebSocket or polling to `/api/heidi/executive` |

## P3 — Cleanup / Technical Debt

| Blocker | Evidence | Why it is P3 |
|---|---|---|
| Archive / legacy directories | `archive/`, `cleanup/`, stale `.md` reports | Should not ship to production but do not affect core |
| `api/traces.js` disabled/deleted in working tree | `api/traces.js.disabled` remains | Confusing; should be committed or removed |
| Mixed unrelated working tree changes | `git status` shows many M/D/?? files outside Phase 11 | These are not part of the local-first migration and should be isolated |
| `.env`/`.env.local` with cloud values | Untracked, but present | Environment hygiene; not a runtime blocker when local env is set |

## Verdict

**No P0 blockers remain after `tsconfig.json` was fixed to exclude `vendor/`.** HYDI can operate locally. **P1 blockers** are verification gaps that must be closed before a production release claim is safe.
