# Heidi autonomy governance

**Risk tiers:** LOW (read/draft) · MEDIUM (isolated dev jobs) · HIGH (money, creds, prod, external submit) — HIGH requires human approval.

**Enforcement points:**

| Mechanism | Location |
|-----------|----------|
| Mission approval | `heidi-core/missions/lifecycle.js` |
| Unattended bounds | `heidi_decision_bounds`, `AuthorityBounds.js` |
| Paid LLM | `lib/cost/paid-llm-gate.js` |
| Action refuse evidence | `lib/heidi/DecisionEvidence.ts` |
| ProtoForge policy | fail-closed `reject` default |
| Pipeline | KILO cannot execute |
| Ingress | `lib/security/ingressGate.js` |

**RFC:** `GOVERNANCE.md` for pipeline/schema changes.

**Boundaries:** `docs/HEIDI_APEX_AUTONOMY_BOUNDARY.md`.