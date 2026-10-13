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
  const row = rowFor(action);
  try {
    await pool.query(UPSERT_SQL, COLUMNS.map((c) => row[c] === undefined ? null : row[c]));
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
    const err = await mirrorActionRecord(pool, a);
    if (err) { failed++; firstError = firstError || err; }
    else synced++;
    if (failed > 0 && synced === 0) break; // DB down — stop hammering it
  }
  return { synced, failed, error: firstError };
}

module.exports = { mirrorActionRecord, mirrorAllActions, rowFor };
