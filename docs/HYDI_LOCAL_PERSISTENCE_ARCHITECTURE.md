# HYDI Local Persistence Architecture

## Principle

Local-first HYDI must not invent a new persistence system for every subsystem. It reuses the strongest existing local mechanisms and bounds each one to a canonical data directory.

## Existing local persistence already in use

| Subsystem | Mechanism | Path | Notes |
|---|---|---|---|
| Rezonate canonical repository | `JsonStore` | `protoforge-applications/rezonate/data/heidi-db.json` | Proven, durable, restart-safe |
| Apex mapping / events | JSON files | `data/apex/project-map.json`, `events.jsonl`, `processed-event-ids.json` | Proven, append + atomic write |
| Pao audit log | JSONL | `data/pao-audit/audit.log.jsonl` | Proven |
| ProtoForge examples | `MemoryStore` / `JsonStore` / `SupabaseStore` | `protoforge-applications/rezonate/src/persistence` | Factory pattern, opt-in Supabase |

## Proposed canonical local data directory

```text
<REPO>/data/hydi-local/
  ├── health/
  │     ├── dashboard.json
  │     ├── infrastructure.json
  │     ├── subsystems.json
  │     ├── status-events.jsonl
  │     └── workers.json
  ├── jobs/
  │     ├── queues.json
  │     ├── worker-status.json
  │     └── commands.jsonl
  ├── protoforge/
  │     ├── policies.json
  │     ├── decisions.jsonl
  │     ├── raw-ledger.jsonl
  │     └── actions.jsonl
  ├── cascade/
  │     └── ledger.jsonl
  ├── session/
  │     ├── sessions.json
  │     ├── work-sessions.json
  │     └── chat-state.json
  ├── memory/
  │     ├── semantic-memories.jsonl
  │     └── episodic-memories.jsonl
  └── revenue/
        └── ledger.jsonl   (optional, high-risk, leave BLOCKED by default)
```

## Per-subsystem store selection

### Health / status

- **Store:** JSON files (small, read-mostly, status shape is known).
- **Durability:** Atomic `fs.writeFileSync` with temp + rename.
- **Restart:** Load from `data/hydi-local/health/*.json`.
- **Failure:** If a file is missing, report `status: 'unknown'` rather than crash.
- **Cloud:** When `SUPABASE_URL` is set, a `SupabaseDashboardStore` adapter may be used; otherwise default to `LocalDashboardStore`.

### Workers / job queue

- **Store:** Existing `MemoryJobQueue` plus durable JSONL for job log.
- **Durability:** Jobs are held in memory for processing; a `jobs.jsonl` keeps an append-only record. Worker status is in a JSON file.
- **Restart:** Workers are not expected to be stateful across restarts; the queue is rebuilt from `jobs.jsonl` if needed.
- **Failure:** Missing `SUPABASE_URL` switches `QueueManager` and `WorkerOrchestrator` to local maps.

### ProtoForge policy / decisions

- **Store:** JSON files.
- **Durability:** `policies.json` is written once per update; `decisions.jsonl` is append-only.
- **Restart:** Load `policies.json` into engine.
- **Failure:** If no policies file exists, engine defaults to fail-closed `reject` for every hypothesis.
- **Cloud:** Optional `SupabaseStore` adapter for rule hot-reload.

### CASCADE raw ledger

- **Store:** Append-only JSONL (`raw-ledger.jsonl`).
- **Durability:** Every append is `fs.appendFileSync`.
- **Restart:** Index `fingerprint` → offset on load.
- **Failure:** Corrupted line is skipped and logged.
- **Cloud:** Optional `SupabaseStore` adapter for cross-instance replication.

### Chat / memory

- **Store:** JSONL for semantic/episodic memories, JSON for sessions/work-sessions.
- **Durability:** Atomic write for session updates; append for memories.
- **Search:** Local full-text for MVP. Vector search is optional and can degrade.
- **Privacy:** All data remains on local filesystem.

### Revenue

- **Store:** Leave BLOCKED. If a local ledger is needed later, use SQLite with explicit schema and Stripe reconciliation. Not in Phase 6 scope.

## Transactions and concurrency

- Local HYDI is single-process in the first phase; no multi-node concurrency is required.
- Atomic writes use `writeFileSync` to a temp file then `renameSync`.
- JSONL append is `appendFileSync` (Node fs append is atomic on POSIX for lines < PIPE_BUF).

## Backup / recovery

- Each data directory can be copied as a whole for backup.
- Corruption is handled by skipping unparseable JSONL lines and logging the count.
- Missing files are recreated with empty defaults; this is not a silent error but a degraded state.

## Audit / events

- Every local write must emit an audit event to `data/pao-audit/audit.log.jsonl`.
- Health writes emit `HYDI_HEALTH_DASHBOARD_UPDATED`.
- Job writes emit `HYDI_JOB_ENQUEUE` / `HYDI_JOB_COMPLETE` / `HYDI_JOB_FAIL`.
- Policy decisions emit `HYDI_POLICY_DECISION`.
- Raw ledger appends emit `HYDI_LEDGER_APPEND`.

## Migration strategy

1. Implement `LocalDashboardStore` and migrate health/status first.
2. Implement `LocalJobQueue`/`LocalWorkerRegistry` and switch workers.
3. Implement `LocalPolicyStore`/`LocalDecisionStore` and ProtoForge.
4. Implement `LocalRawLedger` for CASCADE.
5. Implement `LocalSessionStore`/`LocalMemoryStore` for chat.
6. Leave revenue explicitly BLOCKED.

## Optional cloud sync boundary

Each store is an interface. A `SupabaseStore` adapter can be injected at construction. If `SUPABASE_URL` is set and a `useCloud` flag is true, the adapter is used. Otherwise, the local store is authoritative. Cloud is never a hidden fallback.
