'use strict';

/**
 * HUMAN-ACTION DB MIRROR — file store is truth, the row is evidence.
 *
 * data/human-actions.json is the authoritative store: it survives
 * database outages and every surface keeps working without Postgres.
 * But a file is not queryable — an operator cannot ask "which actions
 * are open, when did this one resolve, what refused it" without reading
 * JSON. human_action_mirror is the projection that answers those.
 *
 * Semantics:
 *   - one row per action id, upserted on every mutation (INSERT ON
 *     CONFLICT DO UPDATE — idempotent, replay-safe)
 *   - mirrorAllActions() bulk-refreshes everything the file holds —
 *     called once per resolver sweep, which is how a record written
 *     while the DB was dead materializes when it returns
 *   - fail-soft by contract: the file write already happened and is the
 *     truth; a mirror failure returns an error string for logging and
 *     never throws back into the governed path
 *   - secrets never cross: the record schema itself carries no secret
 *     fields — verifier evidence is already value-free by the store's
 *     own contract
 */

const COLUMNS = [
  'id', 'blocker_key', 'type', 'title', 'status', 'priority', 'owner',
  'source', 'source_mission_id', 'source_goal_id', 'source_agent_id',
  'boundary', 'verifier', 'verification', 'resolution', 'resolver',
  'expected_outcome', 'resume_capability', 'evidence', 'attempts',
  'last_error', 'resume_policy', 'context', 'transitions',
  'action_created_at', 'action_updated_at',
];

function rowFor(a) {
  return {
    id: a.id,
    blocker_key: a.blockerKey ?? null,
    type: a.type ?? null,
    title: a.title,
    status: a.status,
    priority: a.priority ?? null,
    owner: a.owner ?? null,
    source: a.source ?? null,
    source_mission_id: a.sourceMissionId ?? null,
    source_goal_id: a.sourceGoalId ?? null,
    source_agent_id: a.sourceAgentId ?? null,
    boundary: a.boundary ?? null,
    verifier: a.verifier ?? null,
    verification: a.verification ?? null,
    resolution: a.resolution ?? null,
    resolver: a.resolver ?? null,
    expected_outcome: a.expectedOutcome ?? null,
    resume_capability: a.resumeCapability ?? null,
    evidence: a.evidence ?? null,
    attempts: a.attempts ?? 0,
    last_error: a.lastError ?? null,
    resume_policy: a.resumePolicy ?? null,
    context: a.context ?? null,
    transitions: a.transitions ?? null,
    action_created_at: a.createdAt ?? null,
    action_updated_at: a.updatedAt ?? null,
  };
}

// node-postgres serializes JS arrays as Postgres ARRAY literals ({a,b}),
// not JSON — a raw array bound into a jsonb column fails server-side with
// 'invalid input syntax for type json'. Serialize the jsonb-bound columns
// ourselves so every shape (object, array, scalar) round-trips.
const JSONB_COLUMNS = new Set([
  'boundary', 'verifier', 'verification', 'resolver',
  'evidence', 'context', 'transitions',
]);

function paramsFor(row) {
  return COLUMNS.map((c) => {
    const v = row[c];
    if (v === undefined || v === null) return null;
    return JSONB_COLUMNS.has(c) ? JSON.stringify(v) : v;
  });
}

async function writeRow(pool, row) {
  await pool.query(UPSERT_SQL, paramsFor(row));
}

// Connection-class failure (socket refused/timed out, server going away,
// too many clients): the pass aborts — a dead DB will not heal mid-sweep.
// Server-side SQLSTATE errors (22P02 bad input, 42P01 missing relation)
// are per-row: count them honestly and keep syncing the rest.
function isConnectionClass(e) {
  const code = e && e.code != null ? String(e.code) : '';
  if (/^(08\d{3}|57P0[0-9]|53300)$/.test(code)) return true;
  return !/^[0-9A-Z]{5}$/.test(code);
}

const UPSERT_SQL = `
  INSERT INTO human_action_mirror (${COLUMNS.join(', ')})
  VALUES (${COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})
  ON CONFLICT (id) DO UPDATE SET
    ${COLUMNS.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`).join(',\n    ')},
    mirrored_at = now()`;

/**
 * Upsert one action record into the mirror.
 * @returns {Promise<string|null>} error message on failure, null on success
 */
async function mirrorActionRecord(pool, action) {
  if (!pool || typeof pool.query !== 'function') return 'no pool';
  if (!action || !action.id || !action.title || !action.status) return 'invalid record';
  try {
    await writeRow(pool, rowFor(action));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'mirror write failed';
  }
}

/**
 * Bulk-refresh every record the file store holds — the recovery path
 * that materializes writes made while the database was down.
 * @returns {Promise<{synced:number, failed:number, error:string|null}>}
 */
async function mirrorAllActions(pool, { limit = 500 } = {}) {
  if (!pool || typeof pool.query !== 'function') {
    return { synced: 0, failed: 0, error: 'no pool' };
  }
  let actions;
  try {
    const { load } = require('./store');
    actions = load().actions.slice(-limit);
  } catch (e) {
    return { synced: 0, failed: 0, error: e instanceof Error ? e.message : 'store load failed' };
  }
  let synced = 0;
  let failed = 0;
  let firstError = null;
  for (const a of actions) {
    let err = null;
    let connDead = false;
    if (!a || !a.id || !a.title || !a.status) {
      err = 'invalid record';
    } else {
      try {
        await writeRow(pool, rowFor(a));
      } catch (e) {
        err = e instanceof Error ? e.message : 'mirror write failed';
        connDead = isConnectionClass(e);
      }
    }
    if (err) {
      failed++;
      firstError = firstError || err;
      if (connDead) break; // DB down — stop hammering it
    } else {
      synced++;
    }
  }
  return { synced, failed, error: firstError };
}

module.exports = { mirrorActionRecord, mirrorAllActions, rowFor };
