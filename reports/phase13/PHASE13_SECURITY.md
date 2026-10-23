# Phase 13 — Security Qualification

## Invariants

- Unknown capabilities default to `FORBIDDEN`.
- `HeidiDecisionEngine` never directly executes shell, Docker, or WSL commands.
- All execution routes through `HeidiExecutive.run()` → `PolicyEngine` → `ControlledExecutor`.
- LLM or external recommendations cannot bypass `AutonomyPolicy`.
- Incident evidence cannot modify policy or capabilities.

## Unit-Tested Security Boundaries

| Attack | Test | Expected | Status |
|--------|------|----------|--------|
| LLM/unknown recommends `volume.delete` | `LLM recommendation cannot bypass policy` | rejected, escalation | PASS |
| Arbitrary shell capability `shell.arbitrary` | `arbitrary shell capability is forbidden by default` | `FORBIDDEN` | PASS |
| Destructive database `database.destructive` | `destructive database is forbidden` | `FORBIDDEN` | PASS |
| Database without approval `database.local` | `database operations require approval` | requires approval | PASS |
| Unknown capability | `arbitrary shell capability is forbidden by default` (same mechanism) | `FORBIDDEN` | PASS |

## Untested Boundaries

The following are not yet exercised against a live runtime:
- Forged observations injected into `RuntimeObserver` input
- Forged authorization tokens
- Replayed decision records
- Mission mutation mid-loop

These are reserved for `tests/integration/operational-integration` once the live harness is approved.
