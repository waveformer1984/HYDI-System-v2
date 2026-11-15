# HEIDI integration status

**Updated:** 2026-11-15 | **SHA:** `c881f0c` baseline

| Integration | Status | Evidence |
|-------------|--------|----------|
| Pipeline → mobile metrics | **CODE** | `api/mobile-status.js` ← protoforge-core |
| Chat → heidi-core memory | **CODE** | `lib/heidi-core-chat.js` |
| Missions → approval → verify | **CODE** | `HEIDI_TASK_LIFECYCLE.md`, hermetic tests |
| Mobile BFF → HYDI | **CODE** | `pages/api/heidi-mobile/*` |
| Execution fabric → mobile ops | **PARTIAL** | `lib/execution-fabric/gateway.js`; not all actions |
| CapabilityRegistry → verification | **GAP** | Audit: 77× VERIFICATION_ABSENT |
| Model router (NCM) | **EXPERIMENTAL** | PR #599; env-gated |
| Distributed workers | **SIMULATED** | Acceptance tests; no Frank worker |
| Resource acquisition → Heidi | **PARTIAL** | Executors stubbed |
| Ursula Python suite | **SEPARATE** | Not in Heidi delegation graph |
| Frank local-ci → GitHub | **BROKEN** | Lint infra; fix in flight |
| Cloud agent → Frank | **BLOCKED** | Tailnet / tokens |
| GHA CI | **GREEN** | Recent PR heads |

See `HEIDI_FULL_ECOSYSTEM_AUDIT.md` for detail.