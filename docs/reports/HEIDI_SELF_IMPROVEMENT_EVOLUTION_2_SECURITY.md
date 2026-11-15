# Self-improvement Evolution 2.0 — security review (implementation)

**Scope:** new modules under `lib/heidi/self-improvement/`, loop integration, dashboard API.

| Control | Status |
|---------|--------|
| Owner-requested execution | Enforced in loop |
| One active mission | `loadActiveMission` gate |
| Step limit 5 | `LIMITS.maxSteps` |
| No autonomous merge/deploy | brief labels false; no git write |
| Patch gate | `SELF_IMPROVE_ALLOW_PATCH` unchanged |
| Paid LLM | not introduced |
| History redaction | `redactRecord` on persist |
| Dashboard auth | `x-hydi-service-token` |
| Frank-only gaps | stop with `operator_frank`; not fabricated |

**Finding:** History files live in `.runtime/` (gitignored) — acceptable; operators must protect disk backups like any local evidence store.

**Finding:** Jest invocation is limited to `tests/unit/operational-supervisor.test.js` — narrow path; do not expand without allowlist review.