# Heidi Autonomy Boundary

## Principle

Heidi is a bounded local orchestrator. It may execute only predefined, allowlisted, authorized, and audited operations. It does not have a generic shell, admin rights, or cloud-side authority.

## Operation Classes

| Class | Examples | Heidi Authority | Requires Approval |
|---|---|---|---|
| `READ` | `health.read`, `test.run`, `git status` | auto | no |
| `SAFE_LOCAL_MUTATION` | `health.recover` for `supabase_inbucket` | auto (LOW) | no |
| `SERVICE_RESTART` | `docker.local restart_service` for allowlisted containers | auto or approval | no for `health.recover` safe list; MEDIUM requires approval if invoked directly as `docker.local` |
| `DATA_REPAIR` | `database.local` non-destructive ops | approval | yes |
| `DESTRUCTIVE_OPERATION` | `database.destructive` | approval | yes |
| `EXTERNAL_SIDE_EFFECT` | `deploy.production`, `financial.transaction` | approval | yes |

## Permission Boundaries

- `rezonate:manage` remains enforced by `api/rezonate/route.js` via `requireAuth`.
- `apex:manage` does not apply; no Apex subsystem is defined.
- Stripe remains `mock-by-default`; `STRIPE_MODE=live` + `STRIPE_SECRET_KEY` required for live.
- Cloud credentials are optional for local mode.

## What Heidi Cannot Execute

- Arbitrary shell commands.
- Unbounded `exec(command)` or `powershell(command)`.
- `rm -rf`, `mkfs`, `dd`, `format`.
- Any `CRITICAL` or `HIGH` operation without approval.
- Production deployments without explicit override.
- Cloud provider calls without credentials.

## Allowlisted Local Operations

`ControlledExecutor.js` allowlist:

| target | allowed operation | allowed resource |
|---|---|---|
| `docker.local` | `status` | `supabase_db`, `supabase_kong`, `supabase_inbucket`, `supabase_auth`, `supabase_rest` |
| `docker.local` | `restart_service` | `supabase_inbucket` only |
| `database.local` | `status` | `supabase` |
| `health.recover` | `restart` | `supabase_inbucket` only |

## Audit Requirement

Every executed or denied operation is recorded in `data/audit.jsonl`:

- actor
- capability
- inputs (redacted)
- authorization state
- execution result or denial reason
- timestamp
