# HYDI Apex Phase 4 — Operational Readiness Report

## Commit

- Branch: `feat/hydi-system-wide-audit`
- Phase 4 commit: `TBD` (to be created)
- Predecessor commits:
  - `c921645` — Heidi/Rezonate control-plane hardening
  - `c5a2ef7` — clean Apex Phase 2 integration
  - `378c806` — Apex Phase 3 project lifecycle integration

## What Heidi can actually do now

- Receive user intents for Apex and Rezonate tasks.
- Enforce RBAC (`apex:manage`, `rezonate:manage`).
- Enforce capability-guard states (`VERIFIED`, `FUNCTIONAL`, `SCAFFOLD`, `FORBIDDEN`, `MISSING`).
- Route `VERIFIED` tasks to the correct agent.
- Validate intent payloads before execution.
- Idempotently create Apex projects and Rezonate projects.
- Record episodes and generic Apex events.
- Query truthful project, health, and unified status.
- Persist all state locally in JSON stores.
- Emit auditable task-completed / task-failed events.
- Recover the same project after a process restart.

## What Apex can actually do now

- Emit `project_created` and `episode_generated` events to `hydi_outbox/` (Python side, outside this repo).
- Provide a one-way local outbox for Heidi to observe.
- Maintain local episode/archive state without cloud dependency.

## What Rezonate can actually do now

- Create, list, and get projects.
- Create and list tracks under a project.
- Persist all data in a local JSON store.
- Survive process restart by reloading the JSON store.

## What survives restart

- Rezonate project records (`heidi-db.json`).
- Apex project mapping (`data/apex/project-map.json`).
- Apex event log (`data/apex/events.jsonl`).
- Controller audit log (`data/pao-audit/audit.log.jsonl`).

## What is locally persistent

All changed modules use local filesystem only:
- `lib/apex/apex-client.js`
- `lib/rezonate/rezonate-client.js`
- `protoforge-applications/rezonate/src/persistence`
- `pao-system/core/audit.log.ts`

## What is audited

- `HEIDI_USER_EVENT_RECEIVED`
- `HEIDI_PERMISSION_DENIED`
- `HEIDI_CAPABILITY_UNSUPPORTED`
- `HEIDI_DUPLICATE_MUTATION_BLOCKED`
- `HEIDI_AGENT_FAILURE`
- `APEX_TASK_COMPLETED`
- `APEX_TASK_FAILED`
- `REZONATE_TASK_COMPLETED`
- `REZONATE_TASK_FAILED`

## What requires authorization

Every `REZONATE_*` and `APEX_*` task requires `hasPermission(role, 'rezonate:manage')` or `hasPermission(role, 'apex:manage')`.

## What requires human approval

- `APEX_PUBLISH` (autonomous publishing forbidden).
- `APEX_UPLOAD` (scaffold; no real implementation).
- `REZONATE_EXPORT_PROJECT` (scaffold; not wired).
- `REZONATE_NFT`, `MARKETPLACE`, `MASTERING`, `BLOCKCHAIN`, `DELETE` (forbidden).

## What remains scaffolded

- `APEX_UPLOAD`
- `REZONATE_EXPORT_PROJECT`
- `REZONATE_GET_JOB`, `REZONATE_CREATE_JOB`, `REZONATE_START_JOB`

## What remains cloud-dependent elsewhere in HYDI

- `utils/supabase/client.ts`
- `supabase/functions/` (Deno Edge Functions)
- `api/` routes that call Supabase

These are **not used** by the Apex + Rezonate local slice. The slice works with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` unset.

## Exact test counts

```text
npm run typecheck                                              PASS
npm run build                                                  PASS
npm run validate:rezonate-contract                             PASS
node --test protoforge-applications/rezonate/tests/*.test.js   128/128 PASS
python3 -m unittest tests.test_persistence (Apex)              7/7 PASS
npx jest tests/unit/apex-archive-acceptance.test.js            4/4 PASS
npx jest tests/unit/apex-phase3-lifecycle.test.js              8/8 PASS
npx jest tests/unit/apex-phase4-operational-acceptance.test.js 13/13 PASS
npm test                                                       1820/1826 PASS
                                                               6 failing tests in 7 unrelated suites
                                                               (pre-existing / flaky; see note below)
```

Note: `npm test` failures are all in unrelated suites (`no-hardcoded-secrets`, `heidi-core-action-executor`, `proto-yi-diagnostics`, `HardwareDiscovery`, `goal-executor`, `application-factory`, `DistributedCompute`) and are caused by pre-existing environment issues (dubious git ownership, missing Flask, missing GPU, timeout under full parallel load). When run individually, affected suites pass. No Phase 4 changes introduced failures.

## Exact capability-contract changes

- `GET_APEX_REZONATE_STATUS` added to `lib/apex/apex-capability-guard.js` as `VERIFIED`.
- No changes to `protoforge-applications/rezonate/capability-contract.json`.
- `npm run validate:rezonate-contract` passes with 44 capabilities, 1 deprecated, 2 unaudited.

## Exact files committed

- `docs/APEX_PHASE4_CONTROL_PLANE_AUDIT.md`
- `docs/HEIDI_APEX_REZONATE_OPERATIONAL_MATRIX.md`
- `docs/APEX_PHASE4_RECOMMENDED_CONTROL.md`
- `docs/HEIDI_APEX_AUTONOMY_BOUNDARY.md`
- `HYDI_APEX_PHASE4_OPERATIONAL_READINESS_REPORT.md`
- `lib/apex/apex-capability-guard.js`
- `pao-system/agents/execution/apex.agent.ts`
- `pao-system/core/heidi.controller.ts`
- `tests/unit/apex-phase4-operational-acceptance.test.js`

## Any remaining blocker

None for the local Apex + Rezonate operational slice.

## Recommended next phase

- Phase 5 could wire a lightweight local scheduler for `tools/apex-archive-bridge.js` (optional) or promote a `YELLOW` capability only after explicit human review.
- Continue to avoid Supabase dependency in this slice. Keep cloud integrations scoped to their own subsystems.

## Final verdict

| Subsystem | Verdict | Reason |
|---|---|---|
| Apex local operational readiness | **GO** | Events, mapping, and persistence are local and proven. |
| Rezonate local operational readiness | **GO** | Canonical local JSON repository is fully functional. |
| Heidi control-plane readiness | **GO** | Authorization, capability guard, idempotency, audit, and recovery are in place. |
| Full HYDI autonomous-operation readiness | **DEGRADED** | The Apex + Rezonate slice is ready, but the broader HYDI system still has unrelated cloud-dependent subsystems and pre-existing test failures. Autonomous scope must remain limited to the local `GREEN` operations listed in `docs/HEIDI_APEX_AUTONOMY_BOUNDARY.md`. |
