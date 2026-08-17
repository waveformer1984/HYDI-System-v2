# Apex Phase 4 — Recommended Minimum Control

## Decision

The Phase 3 control plane is functionally complete: Heidi can create, read, persist, and recover both Apex and Rezonate project state locally, with authorization, capability gating, and audit.

The single smallest gap preventing the claim "Heidi can operate the local Apex + Rezonate workflow" is the absence of a unified, truthful operational status command that lets Heidi report the combined subsystem state in one call.

## Missing Control

A `GET_APEX_REZONATE_STATUS` task that returns:

- Heidi controller health
- Apex local persistence health (mapping count, event count)
- Rezonate project count and availability
- Whether the local data directory is present and writable
- No cloud indicators

This is a read-only task, so it requires no new persistence, no human approval, and no idempotency window. It reuses existing `GET_APEX_HEALTH` and `lib/rezonate/rezonate-client.js` building blocks.

## Why this is the minimum

- It does not add a new database.
- It does not add a cloud dependency.
- It does not change the authorization model.
- It does not introduce a new agent.
- It does not duplicate persistence.
- It fits the existing pattern: `GET_APEX_HEALTH` and `GET_APEX_PROJECT_STATUS` already exist; `GET_APEX_REZONATE_STATUS` is a natural next-level read.

## Expected flow

```text
USER: "status of apex rezonate"
  ↓
HeidiController → GET_APEX_REZONATE_STATUS
  ↓
RBAC (apex:manage)
  ↓
Apex Capability Guard (VERIFIED)
  ↓
ApexAgent
  ↓
  ├── apexClient.getHealth()
  ├── rezonateClient.listProjects()
  └── return { ok, apex, rezonate, local, timestamp }
  ↓
APEX_TASK_COMPLETED
  ↓
USER
```

## Out of scope

- No automated YouTube publishing.
- No Supabase integration.
- No new worker or daemon.
- No dashboard UI.
- No new capabilities.

## Success criterion

The new task must be proven with a test that:

1. Creates a project through `APEX_PROJECT_CREATED`.
2. Calls `GET_APEX_REZONATE_STATUS`.
3. Asserts `ok: true`.
4. Asserts `rezonate.count >= 1`.
5. Asserts `apex.mappings >= 1`.
6. Asserts no `SUPABASE_*` environment was required.
7. Survives `resetRepo()` and a new `HeidiController`.
