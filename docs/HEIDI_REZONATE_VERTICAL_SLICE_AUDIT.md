# Heidi → Rezonate Vertical Slice Audit

Branch: `feat/hydi-system-wide-audit`  
Commit: `78ec4bbd7d6e73b4d89597852129f1dbf97046a3`  
Date: 2026-08-14

## Scope

This audit inspects only the first operational vertical slice introduced in `78ec4bb`. It does not rate the rest of HYDI.

## What the Slice Actually Is

The canonical data path is:

```
User message
  → api/chat/route.js
  → getHeidiController().processUserEvent('REZONATE_CREATE_PROJECT', { name })
  → pao-system/core/heidi.controller.ts
  → pao-system/core/task.router.ts
  → pao-system/agents/execution/rezonate.agent.ts
  → lib/rezonate/rezonate-client.js
  → protoforge-applications/rezonate/src/repository.js
  → local JSON store (protoforge-applications/rezonate/data/heidi-db.json)
  → RezonateAgent emits REZONATE_PROJECT_CREATED
  → Heidi response text
```

## Evidence

| Check | Command | Result |
|---|---|---|
| Rezonate chat handler (existing) | `npx jest tests/unit/chat-route-rezonate.test.js` | 7/7 PASS |
| Rezonate canonical test suite | `node --test protoforge-applications/rezonate/tests/*.test.js` | 128/128 PASS |
| TypeScript | `npm run typecheck` | PASS |
| Next.js build | `npm run build` | PASS |
| Capability contract | `npm run validate:rezonate-contract` | PASS |

## Capability Classification

| Capability | State | Evidence | Notes |
|---|---|---|---|
| **REZONATE_CREATE_PROJECT** | **VERIFIED** | `tests/unit/chat-route-rezonate.test.js` line ~126 proves `create a project called Demo` reaches `lib/rezonate/rezonate-client.js` and returns `proj-test-1` | Full slice works; returns project id and name |
| **REZONATE_LIST_PROJECTS** | **FUNCTIONAL** | `RezonateAgent.handle_event()` implements `listProjects()` and returns count; no chat or integration test exercises it | Code present, unit not yet run end-to-end |
| **Local persistence** | **VERIFIED** | `ensureRepo()` uses `dbFile: 'heidi-db.json'` in `protoforge-applications/rezonate/data`; repository `createProject()` writes to the store and emits `project.created` | No cloud, file lives in canonical data dir |
| **Event emission** | **FUNCTIONAL** | `RezonateAgent` calls `emit_event('REZONATE_PROJECT_CREATED', ...)` and `heidi_controller` is the target. `BaseAgent.emit_event` prints to `console.log`. | Emission is observable in logs but **not persisted** to disk or Supabase |
| **Heidi response generation** | **VERIFIED** | Chat test confirms response contains `created project "Demo"` and `proj-test-1` | Result flows from agent back through `HeidiController.processUserEvent()` |
| **Authentication boundary** | **PARTIAL** | `api/chat/route.js` calls `verifyServiceToken()` on `x-hydi-service-token`. Service token treated as `owner` in `lib/auth/rbac.js`. | Passes at the chat surface; no per-mission `requireAuth` for `rezonate:manage` inside the slice |
| **Authorization boundary** | **PARTIAL** | `lib/auth/rbac.js` defines `rezonate:manage` for `operator`/`owner`, but `HeidiController`, `RezonateAgent`, and `api/chat/route.js` do not check it. | Any valid service token can create a project today |
| **Error propagation** | **PARTIAL** | `api/chat/route.js` `catch` returns `🎵 Rezonate: create project failed — ${e.message}`. `HeidiController` returns `{ ok: false, reason }`. | No false success, but malformed input currently caught by regex failure before reaching repository; no test for failed repository call in this flow |
| **Auditability** | **SCAFFOLD** | `RezonateAgent` emits an event object with `task_type`, `project`, `routed_by`, `timestamp`. | Event is logged to console only; no durable audit log, no failure event, no success/failure flag, no entity id on failure |
| **REZONATE_CREATE_TRACK** | **PLANNED** | `taskRoutingMatrix` lists it, `RezonateAgent` emits `REZONATE_TASK_ROUTED` but does not call `createTrack` | No implementation, no test |
| **REZONATE_GET_JOB** / **CREATE_JOB** / **START_JOB** | **PLANNED** | Same as above | No canonical operations reached |
| **REZONATE_EXPORT_PROJECT** | **PLANNED** | Same as above | No canonical operations reached |

## Security Gaps

1. **No `rezonate:manage` enforcement inside the slice.** A service token is treated as `owner` by default, but a device token with `viewer` role would also succeed because the slice does not call `hasPermission`.
2. **No durable audit store.** `REZONATE_PROJECT_CREATED` only prints to stdout.
3. **No structured health surface.** Only the existing `getRezonateHealth()` covers the canonical engine, not the Heidi control path.
4. **No input normalization.** `api/chat/route.js` uses a regex on raw text: `/create(?:\s+a)?\s+project(?:\s+called)?\s+['"]?(.+?)['"]?$/i`. This is fragile and not testable as a discrete component.

## Recommendations for the Next Phase

1. Enforce `rezonate:manage` on mutating Rezonate operations through the slice.
2. Replace the chat regex with an explicit `normalizeIntent()` step that returns `{ taskType, parameters }` and rejects ambiguity.
3. Implement `REZONATE_CREATE_TRACK`, `REZONATE_LIST_TRACKS`, `REZONATE_GET_PROJECT` using the canonical client.
4. Make `RezonateAgent` emit durable, success/failure-tagged audit events.
5. Add a local health endpoint for the Heidi → Rezonate control plane.
