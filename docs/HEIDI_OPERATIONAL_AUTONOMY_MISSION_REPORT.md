# HEIDI Operational Autonomy — Mission Report (Phase 2 kickoff)

**STATUS: PARTIAL** — Repo audit and hermetic tests complete; **Frank production truth BLOCKED** from Cursor Cloud Agent (no tailnet).

**Branch:** `Cusor_agent01heidi-operational-autonomy-phase2-7718`  
**Collector added:** `scripts/frank-production-truth-collect.ps1`

---

## 1. Actual production health (Frank / heidi-pc)

| Item | Status | Evidence |
|------|--------|----------|
| PM2 inventory | **NOT COLLECTED** | Cloud VM: no `pm2`, no self-hosted worker |
| Service ports | **NOT COLLECTED** | `TS_AUTHKEY` / `PROTOFORGE_MCP_TOKEN` **unset**; Tailscale not joined |
| CPU/RAM/disk/GPU | **NOT COLLECTED** | Requires Frank |
| Ollama / Postgres / SQLite | **NOT COLLECTED** | Frank-only |
| Mobile :3006 | **NOT COLLECTED** | Frank-only |
| Auth / Tailscale | **NOT COLLECTED** | Frank-only |

**Operator action (Phase 1 gate):**

```powershell
cd C:\Users\Owner\HYDI-System-v2   # canonical tree per CLAUDE.md
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\frank-production-truth-collect.ps1
node scripts\heidi-assessment-crew.js --dry-run
```

Upload the JSON path printed by the collector into the next cloud agent run (or set `TS_AUTHKEY` on the cloud environment per `docs/CURSOR_CLOUD_AGENT.md`).

**Cloud VM partial snapshot (not production):** heidi-web :3000 answered in an earlier agent turn; stack was degraded without Ollama/heidi-core/DB — **do not treat as Frank truth.**

---

## 2. Architecture and dependency map

See mission canvas / prior analysis. Summary:

- **Chat:** `heidi-core` (:3459) Ollama + SQLite memory; Next `api/chat`; optional `lib/heidi-agent.ts` (paid, gated).
- **Executive:** `hydi-daemon` + `lib/heidi/CognitiveCore.ts` + `AgentControlPlane.ts`.
- **Health truth:** `heidi-core/status/system-status.js` → `system report`.
- **Maintenance producers:** `heidi-core/missions/health-observer.js` (missions only, no direct exec); `heidi-core/ops/ops-agent.js`.
- **Pipeline sibling:** protoforge-core :3005 (six layers).
- **Distributed:** `lib/distributed-cloud/*` + `config/distributed-cloud.json`.
- **Resource acquisition:** `lib/resource-acquisition/*` (dashboard snapshot partial).

---

## 3. Implementation matrix (Phases 2–7)

| Phase | Goal | Code / tests present | Production verified |
|-------|------|----------------------|---------------------|
| 2 Routing | Single authoritative model router | `lib/heidi/inference-route.js` (audit registry only), `paid-llm-enforcement-sites.js`, `inference-dispatch-proposal.js` (proposal) | **NOT consolidation** — execution paths unchanged; paid calls blocked only at `paidApiKey()` call sites |
| 3 Maintenance | Detect → propose → approve → verify | Health observer, mission lifecycle, ops agent, `restart-module.js` | **PARTIAL** — hermetic; Frank E2E **NO** |
| 4 Contracts | 77 capabilities + verification/undo | `CapabilityRegistry`, `capability-contract-audit.ts` | **FAIL audit** — 77× VERIFICATION_ABSENT, 19× NO_UNDO_PATH |
| 5 Distributed | Frank + cloud + mobile nodes | Control plane tests `[SIMULATED]`; GHA worker dispatch | **NO live Frank worker** |
| 6 Dashboard | Unified ops view | `GET /operations/snapshot` (heidi-core), `GET /api/heidi-operations/snapshot` | **PARTIAL** — JSON evidence hub; no full UI yet |
| 7 Acceptance | Degrade → repair → evidence | Distributed acceptance + mission tests (simulated) | **NOT E2E on Frank** |

---

## 4. Remaining capability gaps

- All **77** lifted legacy contracts: **verification absent** (blocking in audit).
- **19** contracts: **no undo path** (advisory/blocking per tier).
- **Unified model routing** not enforced at one service boundary.
- **Unified ops dashboard** not implemented (requirements in mission §6).

---

## 5. Security findings (repo-evidence)

- `HYDI_ALLOW_PAID_LLM` off by default (`npm run cost:audit`) — **verified on agent VM**.
- Mobile auth: `HEIDI_MOBILE_TOKEN` unset → open relay when :3006 exposed (`system-status` auth component).
- Cloud agent cannot reach Frank MCP (:8470) without tailnet — **reduces exfil risk, blocks audit**.
- Health observer **does not** bypass mission approval (grep-confirmed design).

---

## 6. Resource utilization

| Environment | CPU/RAM/disk/GPU |
|-------------|------------------|
| Frank | **UNKNOWN** — run collector |
| Cloud agent VM | Not mission-representative |

---

## 7. Distributed execution status

- **File-backed control plane:** tested — `[SIMULATED]` acceptance suite **PASS** (6 scenarios in `distributed-cloud-acceptance.test.js`).
- **Frank home worker:** **BLOCKED** — no tailnet from this run (`docs/DISTRIBUTED_CLOUD_RESOURCE_INVENTORY.md`).
- **Android Termux:** client libs exist; **not attached** this run.
- **GHA worker workflow:** configured, **live dispatch unverified**.

---

## 8. Test results (this run, clean-main + mission branch)

| Suite | Result |
|-------|--------|
| Heidi unit files (49 files / 677 tests) | **PASS** (prior full run on branch) |
| `distributed-cloud-acceptance` + security + system-status + resource-capabilities | **28 PASS** |
| Tier 2 cognitive / Postgres | **NOT RUN** — Supabase docker failed on VM |
| Frank production collector | **NOT RUN** — Windows/Frank only |

---

## 9. Acceptance criteria evidence

| Criterion | Evidence |
|-----------|----------|
| Detect unavailable service | **SIMULATED** — `health-observer.js` + unit tests; **NOT Frank live** |
| Identify dependency | **SIMULATED** — `system-status.js` tests |
| Propose repair | **SIMULATED** — missions from health observer |
| Operator approves | **PASS** — `hydi-operator-approval-flow.test.js` |
| Execute repair | **PARTIAL** — `HEIDI_AUTONOMOUS_ACTIONS` gate; Frank **not run** |
| Verify recovery | **PARTIAL** — mission `verifying` state; Frank **not run** |
| Record evidence | **PASS** — `heidi_events` / decision evidence tests |
| Mission persistence across restart | **PARTIAL** — SQLite missions; Frank restart **not run** |
| Distributed job execution | **SIMULATED** — distributed-cloud acceptance |
| Model fallback | **PARTIAL** — ModelManager logic; Frank **not run** |
| Mobile ↔ home | **NOT VERIFIED** |
| Auth enforcement | **PARTIAL** — unit tests; Frank token **unknown** |
| Capability permissions | **PARTIAL** — registry tests; 77 contracts unverified |

---

## 10. Evidence / auditability (PR follow-up to #597)

- `GET /operations/snapshot` (heidi-core) requires **`x-heidi-secret`** matching `HEIDI_SECRET` even on loopback — no open bypass of the heidi-web proxy.
- `GET /api/heidi-operations/snapshot` requires **`x-hydi-service-token`** and forwards the secret to core; returns 503 if `HEIDI_SECRET` unset.
- Snapshot bundle: per-block `collected_at`, `source`, `evidence_state` (`fresh` / `stale` / `missing` / `failed`); `live_probe_rollup` is **only** from live probes, not stale status files.
- Missions without memory store: **`missing`**, not zero counts.
- Capability labels: **77** = inventory descriptors; **96** = audit finding total; live execution verification is **`null`** on this endpoint.
- Frank operator JSON: `schema_version: 1`; mismatch → `failed` evidence block (timestamped, not permanent health proof).
- **No** `TS_AUTHKEY` in cloud for this step — attach sanitized collector JSON instead (separate decision if tailnet read access is approved later).

---

## 11. Remaining blockers and operator actions

1. **Run Phase 1 collector on Frank** (required before claiming OPERATIONAL) and **attach JSON** to the cloud run.
2. **Optional** tailnet/MCP — only if operator approves limited destinations; not a prerequisite for collector attachment.
3. **Choose Phase 2 RFC** — consolidate routing behind one service vs document matrix (audit-first).
4. **Phase 4** — prioritize contracts that mutate state above R2 (undo + verification).
5. **Phase 6 UI** — consume `GET /operations/snapshot` on Frank (service token); add canvas/dashboard page when Phase 1 JSON confirms live shape.

Do not merge operational claims into runbooks until (1) is attached.