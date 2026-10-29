# Heidi task lifecycle

Every task in Heidi's queue (the `missions` table in
`heidi-core/data/heidi_memory.db`) now moves through one state machine.
Each step is recorded: who made it, why, and what evidence it left.

```
queued ─▶ planning ─▶ awaiting_approval ─▶ running ─▶ verifying ─▶ completed
             │  │             │                 │            └──▶ failed
             │  └─▶ running ──┼─────────────────┘   (no approval needed)
             ├─▶ blocked ──▶ queued   (re-check after a fix)
             └─▶ failed           └─▶ cancelled (rejected, expired or cancelled)
```

| State | Meaning |
|---|---|
| `queued` | Waiting for the worker. Tasks with no action stay here until someone closes them. |
| `planning` | The worker is checking the agent's permission level and `ActionExecutor.isSafe()`. |
| `awaiting_approval` | Waiting for you. Nothing has run. |
| `running` | Executing, or a dry run when `HEIDI_AUTONOMOUS_ACTIONS` isn't `true`. |
| `verifying` | Checking the result against the task's success criteria. |
| `completed` | Verified, with evidence. A dry run completes with outcome `dry_run`, and the evidence says nothing ran. |
| `failed` | The action errored, the criteria weren't met, or a restart interrupted it. |
| `blocked` | A gate refused it (no agent, level too low, unsafe). It can be re-queued. |
| `cancelled` | Rejected, expired unanswered, or cancelled. |

The older names still work as aliases: `pending` means `queued` and
`active` means `running`. Existing rows are renamed the first time
heidi-core starts.

Code: `heidi-core/missions/lifecycle.js` (states, transitions, approval
policy, verification, chat commands) and `heidi-core/missions/mission-worker.js`
(the worker that drives tasks).

## Rules

- **Only listed transitions happen.** Each is a conditional update (`WHERE
  status = <expected>`), so two writers can't both claim a task. Each one
  appends a row to `mission_events`.
- **Approval is yours.** Only an actor named `human:<owner>` can approve or
  reject. That means you, in chat, through the REST route, or with
  `mission-cli`. The model's `update_mission` tool can only:
  - cancel a task;
  - re-queue a blocked task;
  - close an informational task, one that has no action.
- **A task with an action completes only by verification.** Nobody can mark
  it completed by hand.
- **Approval doesn't skip the gates.** After you approve, the worker re-runs
  planning before anything executes. If the agent's level dropped while the
  task waited, the task becomes blocked instead of running.
- **Requests expire.** A request nobody answers is cancelled after
  `HEIDI_APPROVAL_TTL_HOURS` (default 24).
- **After a crash or restart:**
  - A task caught in `planning` goes back to `queued`, since nothing had run.
  - A task caught in `running` or `verifying` is failed and not retried,
    since it may have partly run.
- **Execution is still off by default.** It needs `HEIDI_AUTONOMOUS_ACTIONS=true`.
  This change does not set it.

### What needs approval

Approval depends on the action itself, never on who proposed it.

| Action | Approval |
|---|---|
| `log_event`, `read_file` | Not needed (read-only) |
| `run_script` of `scripts/restart-module.js` with exactly one module id from `boot.config.json` | Not needed (standing approval, so `health-observer` recovery keeps working). Set `HEIDI_AUTO_APPROVE_RESTARTS=false` to require it |
| Anything else (`run_command`, other scripts) | Needed |
| `write_file`, `api_call` | Never autonomous: `isSafe()` refuses them, so they are blocked |

### Success criteria and evidence

A task can carry `context.success`:

- `{ "exitCode": 0 }`, or
- `{ "outputIncludes": "text" }`.

The default is: no error, and exit code 0 when there is one.

Evidence is stored on the task. It contains:
- the outcome (`success`, `dry_run` or `failed`);
- each check, with whether it passed;
- up to 1,500 characters of output;
- the duration.

Any output line that looks like a credential is replaced with
`[line hidden: looked like a credential]`.

## Using it

Type these in Heidi's chat. The 📋 Tasks button sends `tasks`. They answer
from the database without a model call.

| Command | What it does |
|---|---|
| `tasks` | Open tasks first, plus the 10 most recent finished ones, and which ones wait for you |
| `task 12` | Goal, action, plan, approval, evidence and history |
| `task approve 12 [note]` | Approve. The worker starts it within seconds |
| `task reject 12 [reason]` | Reject (cancelled) |
| `task cancel 12 [reason]` | Cancel. Not possible while it is running or verifying |
| `task done 12 [note]` | Close an informational task, such as a reviewed escalation. A task with an action finishes only by verification |

On Frank's terminal, `node scripts/mission-cli.js
show|approve|reject|cancel <id>` does the same, as `human:cli:<user>`.

### HTTP (heidi-core, same auth as every route)

| Route | Result |
|---|---|
| `GET /missions?state=a,b&limit=` | Tasks with parsed `context`/`plan`/`approval`/`evidence`, plus counts per state |
| `GET /missions/:id` | The task, its events, and the same text as `task <id>` |
| `POST /missions/:id/approve` \| `reject` \| `cancel`, body `{ note }` | `200`; `404` if it doesn't exist; `409` if the state doesn't allow it |

`launch-heidi-mobile.js` relays these routes as `/api/missions*`, behind the
device login (`HEIDI_MOBILE_TOKEN`).

### In the system report

`task-queue` shows how many tasks are awaiting approval, queued, in
progress and blocked. It reports DEGRADED when a task has sat in planning,
running or verifying for more than 10 minutes.

## Trace correlation: ProtoForge pipeline → Heidi task

A ProtoForge escalation becomes a Heidi task carrying the pipeline's
`trace_id`. That one id then links:
- the RAW LEDGER fingerprint;
- the CASCADE classification;
- KILO's hypotheses;
- the ProtoForge decision and rule;
- the Heidi task and its history.

```
event → ingestion → ledger → CASCADE → KILO → ProtoForge = escalate → emission
                                                                        │ trace_id
                         lib/pipeline/heidi-task-link.js ───────────────┘
                                   │ POST /missions { trace_id, trace }
                                   ▼
                     Heidi task (queued, priority 2, no action)
```

- **Who opens it.** protoforge-core subscribes the linker to the pipeline's
  emission layer.
  - It never changes a pipeline result.
  - A dead heidi-core is logged and counted. It is never thrown.
- **What the task is.** An informational task with no action. KILO's
  hypotheses aren't executable, so nothing can run from it.
  - You review it and close it with `task done <id> [note]` or
    `task cancel <id>`.
  - `heidi-core POST /missions` refuses any action.
- **No duplicates.** The route is idempotent on `trace_id`. A replayed
  event is a ledger duplicate, so it doesn't escalate again.
- **Switches.**
  - `HEIDI_TRACE_LINK=false` turns linking off.
  - `HEIDI_TRACE_LINK_OUTCOMES` sets which outcomes link (comma list,
    default `escalate`).
  - `HEIDI_CORE_URL` sets where tasks are opened (default
    `http://127.0.0.1:3459`). `HEIDI_SECRET` is sent when set.
- **The escalation row in `actions`** (`lib/protoforge/auto-gate.js`) now
  carries `trace_id` too.

### Looking a trace up

| Where | What |
|---|---|
| chat `trace <id or first 8+ chars>` | Every pipeline stage, from protoforge-core while it still holds the trace (the last 50 runs since it started), plus the Heidi tasks it opened. Afterwards it uses the snapshot stored on the task. No model call. |
| chat `task <id>` | Shows a `Trace:` line for a linked task |
| heidi-core `GET /traces/:id` (`/api/traces/:id` via :3006) | The same view, as JSON |
| heidi-core `GET /missions?trace_id=<id or prefix>` | Tasks for a trace |
| protoforge-core `GET /pipeline/traces`, `GET /pipeline/traces/:id` | Recent runs, plus the link status. Stage results only, never the event payload |

## Database changes and rollback

The migration is additive and idempotent, and runs in `sqlite-store.js` on
start:
- adds the `plan`, `approval`, `evidence` and `trace_id` columns (and an
  index on `trace_id`) to `missions`;
- adds the `mission_events` table;
- renames `pending` → `queued` and `active` → `running`.

To roll back, revert the PR. Older code then sees `queued`/`running` as
unknown states, so set them back first:

```sql
UPDATE missions SET status='pending' WHERE status IN ('queued','planning','awaiting_approval');
UPDATE missions SET status='active' WHERE status IN ('running','verifying');
```

The extra columns and table are ignored by old code. Back up
`heidi_memory.db` before either step.

## Verification status

| Check | Status |
|---|---|
| `tests/unit/mission-worker.test.js`, 39 tests, on both the SQLite and the in-memory store: transitions, races, approval, rejection, expiry, re-check after approval, verification, redaction, restart recovery, legacy migration, command parsing | PASSED locally |
| `tests/unit/heidi-task-routes.test.js`: chat commands and REST through a real heidi-core, no model calls; tool restrictions | PASSED locally |
| Related suites (`heidi*`, `mission*`, health observer, control plane, mobile chat; 48 suites, 784 tests), `npm run typecheck`, eslint, change-safety | PASSED locally |
| `tests/unit/heidi-trace-correlation.test.js`: a real pipeline escalates, a real heidi-core opens one task, then `trace`/`task`/REST read it back, live and after protoforge-core loses it; plus linker failure modes and route validation | PASSED locally |
| On Frank after deploy: `tasks`, then `system report` (look for `task-queue`) | NOT YET |
| On Frank: an escalated event opening a task (needs a real escalation from protoforge-core) | NOT YET |
