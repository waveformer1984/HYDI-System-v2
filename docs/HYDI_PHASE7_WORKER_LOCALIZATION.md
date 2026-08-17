# HYDI Phase 7A — Worker Localization

## Scope

Migrate the HYDI worker queue and worker status tracking from a required Supabase dependency to a local-first JSON store. Workers still support Supabase when explicitly configured, but they no longer require it.

## Data contract

### Job

```json
{
  "id": "uuid",
  "queue_name": "string",
  "payload": "any",
  "status": "pending | processing | completed | failed",
  "priority": 0,
  "attempts": 0,
  "max_attempts": 3,
  "created_at": "ISO 8601",
  "started_at": "ISO 8601 | null",
  "completed_at": "ISO 8601 | null",
  "error_message": "string | null",
  "worker_id": "string | null"
}
```

### Worker status

```json
{
  "worker_id": "string",
  "worker_type": "string",
  "status": "idle | busy | error | stopped",
  "last_heartbeat": "ISO 8601",
  "processed_count": 0,
  "error_count": 0
}
```

## Implementation

| File | Change |
|---|---|
| `workers/lib/local-job-store.js` | New local JSON job store: `enqueue`, `dequeue`, `completeTask`, `getTask`, `getQueueStats`, `retry`. |
| `workers/lib/local-worker-status.js` | New local JSON worker status: `registerWorker`, `updateHeartbeat`, `listWorkers`, `markProcessed`, `markError`. |
| `workers/QueueManager.js` | Refactored to choose Supabase or local at `initialize()` based on env. All existing methods preserved. |
| `lib/health/collectors/workers.ts` | Now reads from local worker status when Supabase is not configured. |
| `tests/unit/queue-manager-local.test.js` | New tests. |

## Behavior

- If `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are present and `HYDI_QUEUE_SOURCE` is not `'local'`, `QueueManager` uses Supabase RPCs.
- Otherwise, it uses `data/hydi-local/jobs/worker-queues.json` and `worker-status.json`.
- Jobs are durable across process restart.
- Worker status is durable across process restart.
- Concurrent `dequeue` is protected by reading the file, marking `processing`, and writing atomically. For the single-process local-first case, this is sufficient.
- Failed jobs retry until `max_attempts`, then become `failed`.

## Persistence

- `data/hydi-local/jobs/worker-queues.json`
- `data/hydi-local/jobs/worker-status.json`

## Failure / recovery

| Scenario | Behavior |
|---|---|
| Missing local files | Empty queues and empty worker list returned. |
| Corrupt local files | Log and reset to empty. |
| No Supabase env | Transparently uses local store. |
| Supabase configured and available | Uses Supabase. |
| Process restart | Jobs and worker status reload from JSON. |

## Tests

`tests/unit/queue-manager-local.test.js` — 6/6 PASS:

- enqueue, dequeue, complete a task
- failed task retries and eventually fails
- duplicate tasks are distinct
- concurrent claim protection
- process restart recovery
- no cloud credentials required

## Known limitations

- `WorkerOrchestrator.js` still uses `agent_control_commands` from Supabase. Worker lifecycle (start/stop/supervision) is not yet fully local. Worker queue operations are GO; orchestrator is DEGRADED.
