# Heidi Apex + Rezonate Operational Capability Matrix

## Supported Operations

### APEX

| Task | Domain | Canonical Implementation | Persistence | Authorization | Capability State | Idempotency | Audit Event | Restart Recovery | Human Approval | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| `APEX_PROJECT_CREATED` | Apex | `pao-system/agents/execution/apex.agent.ts` → `lib/rezonate/rezonate-client.js` | `data/apex/project-map.json` + Rezonate `heidi-db.json` | `apex:manage` | VERIFIED | Check local `project-map.json` and Rezonate list before create | `HEIDI_USER_EVENT_RECEIVED`, `APEX_TASK_COMPLETED`/`APEX_TASK_FAILED` | Yes: mapping + project reloaded from disk | No | `tests/unit/apex-phase3-lifecycle.test.js` |
| `APEX_EPISODE_CREATED` | Apex | `pao-system/agents/execution/apex.agent.ts` | `data/apex/events.jsonl` | `apex:manage` | VERIFIED | Requires existing mapping; records append-only | `APEX_TASK_COMPLETED`/`APEX_TASK_FAILED` | Yes: events re-readable | No | `tests/unit/apex-phase3-lifecycle.test.js` |
| `GET_APEX_PROJECT_STATUS` | Apex | `pao-system/agents/execution/apex.agent.ts` | Read-only | `apex:manage` | VERIFIED | N/A (read) | `APEX_TASK_COMPLETED`/`APEX_TASK_FAILED` | Yes | No | `tests/unit/apex-phase3-lifecycle.test.js` |
| `GET_APEX_HEALTH` | Apex | `lib/apex/apex-client.js` | Read-only | `apex:manage` | VERIFIED | N/A (read) | `APEX_TASK_COMPLETED` | Yes | No | `tests/unit/apex-phase3-lifecycle.test.js` |
| `APEX_EVENT_RECORDED` | Apex | `pao-system/agents/execution/apex.agent.ts` | `data/apex/events.jsonl` | `apex:manage` | VERIFIED | Append-only | `APEX_TASK_COMPLETED`/`APEX_TASK_FAILED` | Yes | No | `tests/unit/apex-archive-acceptance.test.js` |
| `APEX_UPLOAD` | Apex | none | N/A | N/A | SCAFFOLD | N/A | `HEIDI_CAPABILITY_UNSUPPORTED` | N/A | N/A | `tests/unit/apex-archive-acceptance.test.js` |
| `APEX_PUBLISH` | Apex | none | N/A | N/A | FORBIDDEN | N/A | `HEIDI_CAPABILITY_UNSUPPORTED` | N/A | Yes (J) | `tests/unit/apex-archive-acceptance.test.js` |

### REZONATE

| Task | Domain | Canonical Implementation | Persistence | Authorization | Capability State | Idempotency | Audit Event | Restart Recovery | Human Approval | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| `REZONATE_CREATE_PROJECT` | Rezonate | `protoforge-applications/rezonate/src/repository.js` | `heidi-db.json` | `rezonate:manage` | VERIFIED | Heidi 5s duplicate window; repository always creates, so caller must guard | `REZONATE_TASK_COMPLETED`/`REZONATE_TASK_FAILED` | Yes | No | `protoforge-applications/rezonate/tests/*.test.js`, `lib/rezonate/control-health.js` |
| `REZONATE_LIST_PROJECTS` | Rezonate | `protoforge-applications/rezonate/src/repository.js` | Read-only | `rezonate:manage` | VERIFIED | N/A | `REZONATE_TASK_COMPLETED`/`REZONATE_TASK_FAILED` | Yes | No | above |
| `REZONATE_GET_PROJECT` | Rezonate | `protoforge-applications/rezonate/src/repository.js` | Read-only | `rezonate:manage` | VERIFIED | N/A | `REZONATE_TASK_COMPLETED`/`REZONATE_TASK_FAILED` | Yes | No | above |
| `REZONATE_CREATE_TRACK` | Rezonate | `protoforge-applications/rezonate/src/repository.js` | `heidi-db.json` | `rezonate:manage` | VERIFIED | 5s duplicate window | `REZONATE_TASK_COMPLETED`/`REZONATE_TASK_FAILED` | Yes | No | above |
| `REZONATE_LIST_TRACKS` | Rezonate | `protoforge-applications/rezonate/src/repository.js` | Read-only | `rezonate:manage` | VERIFIED | N/A | `REZONATE_TASK_COMPLETED`/`REZONATE_TASK_FAILED` | Yes | No | above |

## Unsupported / Forbidden Operations

| Task | Domain | State | Reason |
|---|---|---|---|
| `REZONATE_GET_TRACK` | Rezonate | MISSING | No canonical repository method |
| `REZONATE_UPDATE_PROJECT` | Rezonate | MISSING | No canonical repository method |
| `REZONATE_UPDATE_TRACK` | Rezonate | MISSING | No canonical repository method |
| `REZONATE_EXPORT_PROJECT` | Rezonate | SCAFFOLD | Not wired through Heidi |
| `REZONATE_NFT` | Rezonate | FORBIDDEN | Policy |
| `REZONATE_MARKETPLACE` | Rezonate | FORBIDDEN | Policy |
| `REZONATE_MASTERING` | Rezonate | FORBIDDEN | Policy |
| `REZONATE_BLOCKCHAIN` | Rezonate | FORBIDDEN | Policy |
| `REZONATE_DELETE` | Rezonate | FORBIDDEN | Policy |
| `APEX_UPLOAD` | Apex | SCAFFOLD | YouTube upload not implemented |
| `APEX_PUBLISH` | Apex | FORBIDDEN | Autonomous publishing not allowed |

## Capability State Legend

- `VERIFIED` — routed, implemented, tested, and persisted locally.
- `FUNCTIONAL` — canonical method exists, but not fully wired through Heidi.
- `PLANNED` — declared, not implemented.
- `SCAFFOLD` — stub or partial; not operational.
- `MISSING` — no canonical implementation.
- `FORBIDDEN` — disallowed by policy.
