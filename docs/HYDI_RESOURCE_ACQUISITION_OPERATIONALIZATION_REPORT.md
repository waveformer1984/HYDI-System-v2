# HYDI Resource Acquisition — Operationalization Report (Mission 2)

**Date:** 2026-11-15  
**Branch:** `Cusor_agent01resource-acquisition-master-7718` (stacked on #593)  
**Baseline commit (Mission 2 start):** `736346c2`  
**Dependencies:** PR [#593](https://github.com/waveformer1984/HYDI-System-v2/pull/593), PR [#594](https://github.com/waveformer1984/HYDI-System-v2/pull/594)  
**Distributed coordination (read-only):** PR [#590](https://github.com/waveformer1984/HYDI-System-v2/pull/590), issue [#587](https://github.com/waveformer1984/HYDI-System-v2/issues/587)

---

## Executive status

| Area | Status | Evidence |
|------|--------|----------|
| Heidi capability dispatch | **COMPLETE (simulated)** | `CapabilityRegistry` + `CognitiveCore.wireCapabilityExecutors` → `heidi-executors.js` |
| Verification adapters | **PARTIAL** | Live pass 48 URLs; `benefits_confirmed` stays false by design in v1 |
| Coverage targets (10×4 verified) | **NOT MET** | Program-probe only; no benefit-verified opportunities |
| Weekly scheduling | **COMPLETE (opt-in)** | `hydi-schedulers` job + `resource-discovery-scheduler.js`, default off |
| Owner profile governance | **COMPLETE** | `profile-validator.js` + questionnaire doc |
| Distributed multi-node execution | **BLOCKED** | Audit only — no live multi-node proof |
| Frank production activation | **NOT RUN** | Handoff procedure below; cloud VM verified |

---

## Phase 1 — Merge readiness

See `docs/partnerships/PR593_594_MERGE_READINESS.md`.

---

## Phase 2 — Heidi capability registration

Registered capabilities (provider `partnerships_coordinator`):

- `resource.discover`, `resource.validate`, `resource.qualify`, `resource.rank`
- `resource.prepare_application`, `resource.request_approval`, `resource.record_submission`
- `resource.track_application`, `resource.record_award`, `resource.integrate`
- `resource.validate_profile`

**Invocation path:** `CognitiveCore` wires executors at init; `invokeResourceCapability` delegates to `createResourceActionRunner` (same fabric as CLI/mobile).

**Verification:** `tests/unit/heidi-resource-capabilities.test.js` — registry lists descriptors; `resource.discover` executes and returns intake.

---

## Phase 3 — Verification (not HTTP = benefits)

**Modules:** `lib/resource-acquisition/verify/` (`fetch-page.js`, `adapters.js`, `run-pass.js`, `store.js`).

**Flags (conservative):**

| Flag | Meaning in v1 |
|------|----------------|
| `source_reachable` | HTTP response received (2xx–3xx body) |
| `program_confirmed` | Official host + weak page signal only |
| `benefits_confirmed` | Always **false** from automation |
| `eligibility_confirmed` | **false** without owner profile + operator review |
| `application_ready` | **false** until operator pipeline gates pass |

Evidence files: `.runtime/resource-discovery/evidence/<opportunityId>_<hash>.json`

**Bugfix this mission:** `fetch-page.js` wall-clock timeout — hung TLS hosts no longer block the pass.

---

## Phase 4 — Live verified counts (2026-11-15, cloud egress)

Command:

```bash
HYDI_VERIFY_LIMIT=48 node scripts/run-verification-sample.js
node scripts/bucket-verify-summary.js .runtime/resource-discovery/last-verification-sample.json
```

**Global (n=48 curated seeds):**

| Metric | Count |
|--------|------:|
| `source_reachable` | 18 |
| `program_confirmed` | 7 |
| `benefits_confirmed` | 0 |
| `eligibility_confirmed` | 0 |
| `application_ready` | 0 |

**By intelligence bucket (program_probe_confirmed / target 10):**

| Bucket | Checked | Source reachable | Program probe confirmed |
|--------|--------:|-----------------:|------------------------:|
| AI / developer | 14 | 6 | **4** |
| Compute | 12 | 5 | **0** |
| Grants / funding | 8 | 4 | **3** |
| Commercial | 13 | 3 | **0** |

**Classification mix:** `REACHABLE_UNKNOWN` 35, `PROGRAM_PROBE_CONFIRMED` 7, `REACHABLE_ONLY` 6.

Artifact copies: `/opt/cursor/artifacts/verify-48-full.json`, `verify-48-by-bucket.json`.

---

## Phase 5 — Scheduling

- **No new PM2 app:** job `hydi-resource-discovery` added to existing `scripts/hydi-schedulers.js` (9 supervised children).
- **Opt-in:** `HYDI_ENABLE_WEEKLY_RESOURCE_DISCOVERY=1` required; otherwise `resource-discovery-scheduler.js --once` returns `{ skipped: true }`.
- **Lock:** `MissionRunLock` on `.runtime/resource-discovery.lock`.
- **Records:** `.runtime/resource-discovery/last-cycle.json`, append to `logs/resource-discovery-scheduler.log`.
- **Bounded verification:** `HYDI_VERIFY_LIMIT` (default 12 when automated verification enabled).
- **Manual:** `node scripts/resource-discovery-cycle.js weekly` unchanged.

---

## Phase 6 — Owner profile

- Questionnaire: `docs/partnerships/OWNER_PROFILE_QUESTIONNAIRE.md`
- Validator: `lib/partnerships-funding/profile-validator.js` — rejects repo paths / template; requires `approved_by_owner`; `redactProfileForLogs()` for safe logging.
- Loader: `HYDI_ORG_PROFILE_PATH` (existing `profile-loader.js`).
- **No committed private profile.**

---

## Phase 7 — Distributed execution (#590 / #587)

| Criterion | Assessment |
|-----------|------------|
| Job ownership | Resource discovery remains **single-coordinator** JSON store; not registered as distributed cloud job |
| Idempotency | Dedup keys in partnerships store; verification pass is upsert-safe on flags |
| Leases | `MissionRunLock` for scheduler; Heidi `heidi_operator_lease` separate |
| Multi-node live | **Not validated** — #590 unmerged; smoke fixtures under `.runtime/distributed-cloud/` are simulated only |

**Recommendation:** run discovery on Frank only until distributed hardening merges and a dedicated RFC covers cross-node opportunity store.

---

## Phase 8 — Frank / Windows activation (procedure, not executed here)

1. **Deploy:** merge #593 then #594; `git pull` on Frank; `npm ci`; no new PM2 app if `hydi-schedulers` already runs.
2. **Environment:**
   - `HYDI_ORG_PROFILE_PATH` → approved private JSON (outside repo)
   - `HYDI_PARTNERSHIPS_OPERATOR_SECRET` → submit/award auth
   - Optional: `HYDI_ENABLE_WEEKLY_RESOURCE_DISCOVERY=1`, `HYDI_ALLOW_AUTOMATED_VERIFICATION=1`, `HYDI_ALLOW_LIVE_DISCOVERY=1` (reachability only)
3. **Health:** `npm run boot:plan`; Postgres/Supabase if qualification uses DB; `GET /api/health`
4. **Mobile:** authenticated `GET /api/heidi-mobile/partnerships` — dashboard sections present
5. **Manual cycle:** `node scripts/resource-discovery-cycle.js weekly`
6. **Verification sample:** `node scripts/run-verification-sample.js`
7. **Evidence inspect:** `.runtime/resource-discovery/evidence/`
8. **Rollback:** unset weekly env vars; restore `.runtime/partnerships-funding/opportunities.json` from backup; `git checkout` prior commit on Frank

**Claim:** production activation **not** performed on Frank in this run.

---

## Phase 9 — Test matrix (this run)

| Command | Result |
|---------|--------|
| `npm run typecheck` | PASS |
| Partnerships + resource unit suites | PASS (36 tests) |
| `tests/integration/resource-acquisition-fabric.test.js` | PASS |
| Live verification 48 URLs | PASS (see counts) |
| `resource-discovery-scheduler.js --once` (disabled) | PASS skip |

---

## Security findings

- Operator auth and fail-closed prepare/submit paths from #593 preserved.
- Automated verification **cannot** promote reachability to `benefits_confirmed`.
- Profile validator blocks in-repo profile paths.
- **Gap:** operator-driven `resource.validate` still required for source verification status used in prepare gates.

---

## Remaining gaps

1. **Benefit verification** — requires operator evidence bundles and/or structured provider APIs (not HTML scraping).
2. **Coverage targets** — 0/10 per bucket on `benefits_confirmed`; program probe below target on compute/commercial.
3. **CI** — refresh GitHub checks after push.
4. **Frank live** — operator must run activation checklist.
5. **Distributed** — blocked on #590 + design for shared opportunity store.

---

## Human approvals required

- Merge #593 then #594 (manual).
- Approve org profile file (`approved_by_owner`).
- Enable weekly discovery env on Frank (optional).
- Authorize any external application submission (never automatic).

---

## Key files (Mission 2 delta)

- `lib/heidi/CapabilityRegistry.ts`, `lib/heidi/CognitiveCore.ts`
- `lib/resource-acquisition/heidi-executors.js`, `lib/resource-acquisition/verify/**`
- `lib/partnerships-funding/profile-validator.js`
- `scripts/resource-discovery-scheduler.js`, `scripts/run-verification-sample.js`, `scripts/bucket-verify-summary.js`
- `scripts/hydi-schedulers.js` (job entry)
- Tests: `heidi-resource-capabilities`, `resource-verification`, `profile-validator`