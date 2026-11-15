# HEIDI 90-day evolution roadmap

Aligns with master directive Part XV. **Target windows**, not permission to skip quality gates.

**Baseline:** `docs/reports/HEIDI_FULL_ECOSYSTEM_AUDIT.md` (`c881f0c`)

---

## Phase 1 — Foundation and reliability (days 1–30)

| ID | Workstream | Deliverable | Status |
|----|------------|-------------|--------|
| P1-1 | H — CI recovery | Frank local-CI ESLint env fix + Frank verify | **In PR prep** |
| P1-2 | H — Production truth | `frank-production-truth-collect.ps1` artifact in every agent run | **Blocked** (tailnet) |
| P1-3 | H — RAM | Measured allocation plan from Frank snapshot | **Blocked** |
| P1-4 | B — Execution | Unify job lifecycle with missions (`EXECUTION_FABRIC_UNIFICATION_PLAN.md`) | Not started |
| P1-5 | A — Control plane | Extend operations snapshot for mobile | Partial |
| P1-6 | Security | Mobile token + ingress audit on Frank | Not verified |
| P1-7 | C — Memory | Inventory five layers vs `heidi-core` SQLite + Supabase | Documented in audit |

**Phase 1 acceptance:** Existing capabilities **demonstrably operational on Frank** (health report + green local-ci + one mission approve/verify path).

---

## Phase 2 — Intelligence and expansion (days 31–60)

| ID | Workstream | Deliverable |
|----|------------|-------------|
| P2-1 | C — Routing | Single opt-in router path (Ollama default; NCM behind flags) |
| P2-2 | C — NCM | Benchmark gate per `docs/NCM_EXPERIMENTAL_INTEGRATION.md` |
| P2-3 | Multi-agent | Ursula + PAO agents behind capability registry |
| P2-4 | D — Distributed | Authenticated Frank worker + one cloud worker job |
| P2-5 | E — Resource acquisition | Opportunity lifecycle in DB + approval missions |
| P2-6 | G — Mobile | Command center: jobs, approvals, evidence |
| P2-7 | B — Background | Persistent mission worker under PM2 with bounds |

**Phase 2 acceptance:** Multi-stage objective with delegation + evidence on verified infrastructure.

---

## Phase 3 — Bounded autonomy (days 61–90)

| ID | Workstream | Deliverable |
|----|------------|-------------|
| P3-1 | F — ProtoForge | Branch-isolated dev pipeline → PR (no auto-merge) |
| P3-2 | IX — Revenue | Freelance pipeline missions (approval-gated) |
| P3-3 | XI — Recovery | Approved auto-restart patterns only |
| P3-4 | Learning | Outcome feedback into procedural memory |
| P3-5 | Tests | Part XVI acceptance suite — **live** tier on Frank |

**Phase 3 acceptance:** End-to-end objective with stored evidence, not plans only.

---

## Workstream ownership (Part XIV)

| Stream | Owner focus | Conflicts to avoid |
|--------|-------------|-------------------|
| A Architecture | `docs/architecture/*` contracts | Don't rewrite pipeline |
| B Execution | `mobile-ops`, missions, jobs | Single run ID schema |
| C Memory / models | heidi-core memory, inference | Don't enable paid LLM by default |
| D Distributed | `lib/distributed-cloud` | No public worker endpoints |
| E Acquisition | `lib/resource-acquisition` | No auto-submit |
| F ProtoForge | MCP, agents, CI | No merge without human |
| G Mobile | `heidi-mobile`, BFF | No secrets in client |
| H Reliability | local-ci, Frank observer, RAM | Infra-only CI fixes |
| I Verification | Acceptance tests | Label simulated vs live |

---

## Backlog template (Part XIX)

Each item: **Priority | Impact | Dependencies | Scope | Risk | Acceptance | Status | Evidence link**

Example:

```text
P1-1 | HIGH | Unblocks merge | none | local-ci env | Low | Frank green local-ci | IN_PROGRESS | frank-windows-local-ci-root-cause.md
```