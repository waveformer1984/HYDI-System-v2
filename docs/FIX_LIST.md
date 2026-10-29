# fix-list (v1)

One ranked, read-only list of what is wrong on Frank — evidence plus a
proposed fix, produced by `lib/observation/fix-list.js` inside the existing
`frank-observer` pass. **v1 produces the list only**: it creates no
missions, runs no commands, and changes nothing.

## Where it lives

| Piece | File |
|---|---|
| Pure module (all logic, unit-testable) | `lib/observation/fix-list.js` |
| Thin IO collector | `lib/observation/fix-list-collector.js` |
| Pass step | `scripts/frank-observer.js` (inside `runObservationPass`) |
| Output | `.runtime/fixlist/current.json` (atomic tmp+rename) |
| Chat command | `fix list` / `fixlist` / `/fixlist` in heidi-core |
| Phone surface | `fixList` summary on `GET /api/phone/observe` |

No new PM2 app — it rides the 60s observer pass and adds a few ms.

## Inputs

- frank snapshot (`lib/observation/frank-snapshot.js`) — observatory,
  storage, daemon status, strays
- drift rows (`lib/runtime/collect.js` → `auditDrift`) — the same read-only
  `pm2 jlist` the runtime audit already does. An unreadable jlist is its
  own `UNKNOWN` item, not silence.
- `.heidi-daemon-status.json` — pid, cycle health, persistence. A status
  pid that differs from PM2's tracked pid is `daemon_pid_mismatch` (CRIT).
- `heidi_events` `action_refused` counts by verdict (24h) via the daemon's
  PG config. An unreachable DB is `UNKNOWN`, never zero.
- mission backlog — `missions` rows in `awaiting_approval` / `blocked`
  older than 30 min, from `heidi-core/data/heidi_memory.db` (sqlite3,
  read-only).

## Item shape

```json
{
  "id": "<sha1(kind:subject)[0:12]>",
  "kind": "drift | stray_pid | daemon_pid_mismatch | pm2_unreadable | db_unreachable | action_refused_spike | mission_backlog | <snapshot source>",
  "subject": "rezonate-app",
  "level": "CRIT | WARN | UNKNOWN | INFO",
  "detail": "human-readable evidence",
  "evidence": [ { "...": "raw rows/fields" } ],
  "proposedFix": { "type": "pm2_restart|pm2_start|pm2_recreate|stop_process|daemon_reconcile|human",
                   "command": "pm2 restart rezonate-app", "risk": "R1", "wouldNeedApproval": false },
  "blastRadius": 1,
  "firstSeen": 1698632400000, "lastSeen": 1698632400000, "passes": 3
}
```

`proposedFix` comes only from a fixed template table — no LLM, nothing
invented. Items without a template get `type: 'human'` and no command.

## Ranking

`level` (CRIT > WARN > UNKNOWN > INFO) → `passes` (persistence) →
`blastRadius` (count affected). `firstSeen`/`passes` carry forward from
the previous `current.json`, so long-lived problems rise.

## Boundary

- Never calls `ActionExecutor`, never calls `memory.createMission`, never
  shells out to pm2 beyond the read-only jlist the drift audit already
  runs. `tests/unit/fix-list.test.js` has a guard that fails if the module
  ever imports those paths.
- **v2 is NOT in this PR**: creating `awaiting_approval` missions via the
  health-observer path, so a proposed fix can be approved and executed
  under the existing governance. That lands separately.
