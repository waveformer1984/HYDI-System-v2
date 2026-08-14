# Heidi Apex + Rezonate Autonomy Boundary

## Principle

Heidi must never exceed the authority it has been explicitly granted. This document classifies every current Apex/Rezonate operation as GREEN, YELLOW, or RED based on the actual code, capability states, and policy.

## Classification

### GREEN — Heidi may execute autonomously

These are read-only or safe local creation/observation tasks. They do not modify external systems, do not spend money, do not publish, and are fully reversible by deleting local files.

- `APEX_PROJECT_CREATED` — creates local project mapping and a local Rezonate project.
- `APEX_EPISODE_CREATED` — records an episode in the local append-only log.
- `APEX_EVENT_RECORDED` — records a generic observation in the local append-only log.
- `APEX_EPISODE_APPROVED` — records an approval observation (no external action).
- `APEX_EPISODE_ARCHIVED` — records an analytics observation.
- `APEX_EPISODE_FAILED` — records a failure observation.
- `GET_APEX_PROJECT_STATUS` — read-only local status.
- `GET_APEX_HEALTH` — read-only local metrics.
- `GET_APEX_REZONATE_STATUS` — read-only unified status.
- `REZONATE_CREATE_PROJECT` — creates a local music project.
- `REZONATE_LIST_PROJECTS` — read-only.
- `REZONATE_GET_PROJECT` — read-only.
- `REZONATE_CREATE_TRACK` — creates a local track under a project.
- `REZONATE_LIST_TRACKS` — read-only.

### YELLOW — Heidi may prepare/validate but must request approval

These are not fully implemented or have operational implications that require human confirmation before execution. Heidi may surface information, draft a request, or perform validation, but it must not autonomously complete the action.

- `APEX_UPLOAD` — YouTube upload is scaffolded; the agent rejects it with `SCAFFOLD`.
- `APEX_PUBLISH` — publication is rejected; J must explicitly approve publishing.
- `REZONATE_EXPORT_PROJECT` — export is routed but not executed; requires J approval before enabling.
- `REZONATE_CREATE_JOB`, `REZONATE_START_JOB` — not yet wired; Heidi must not autonomously start audio rendering jobs until verified.
- Any destructive or production-impacting Rezonate operation (currently `REZONATE_DELETE` is not routed, but if ever added it must be YELLOW/RED).

### RED — Heidi must never execute autonomously

These are forbidden by policy or absent from the canonical repository. Heidi is hardcoded to reject them.

- `APEX_PUBLISH` — autonomous publication is forbidden.
- `REZONATE_NFT` — forbidden.
- `REZONATE_MARKETPLACE` — forbidden.
- `REZONATE_MASTERING` — forbidden.
- `REZONATE_BLOCKCHAIN` — forbidden.
- `REZONATE_DELETE` — forbidden.
- `REZONATE_GET_TRACK` — missing; Heidi cannot invent this.
- `REZONATE_UPDATE_PROJECT` — missing; Heidi cannot invent this.
- `REZONATE_UPDATE_TRACK` — missing; Heidi cannot invent this.
- Any action that would:
  - expose secrets
  - bypass authorization
  - disable capability guards
  - write directly to cloud systems
  - perform destructive database operations
  - spend money or sign transactions

## Enforcement

| Layer | How it is enforced |
|---|---|
| Authorization | `lib/auth/rbac.js` `hasPermission` in `HeidiController.processUserEvent` |
| Capability state | `lib/apex/apex-capability-guard.js` and `lib/rezonate/capability-guard.js` |
| Intent validation | Agent `handle_event` validates required payload fields |
| Idempotency | `HeidiController.checkIdempotency` for mutations |
| Audit | `pao-system/core/audit.log.ts` records every received/denied/completed/failed task |
| Forbidden-word guard | `lib/rezonate/intent.js` rejects `remove`, `drop`, `publish`, `mint`, `sell` |

## Human approval points

- Any `FORBIDDEN` or `SCAFFOLD` capability must be explicitly promoted by J before use.
- Any new task type must be added to the routing matrix, capability guard, and RBAC by an `owner`.
- Any local-only subsystem may be extended with new `GREEN` reads/creates, but not `YELLOW` or `RED` writes without explicit review.
