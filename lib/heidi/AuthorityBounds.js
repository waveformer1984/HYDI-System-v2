'use strict';

/**
 * LIVE AUTHORITY BOUNDS — the durable source for "may Heidi act
 * unattended right now".
 *
 * Before this gate, the resolver sweep ran R0/R1 actions autonomously
 * with no master switch and no consult of heidi_decision_bounds — the
 * table existed in the schema since the legacy loop but no code read
 * it. Unattended authority was a static claim compiled into
 * resolver-policy.js, not a live, owner-revocable bound.
 *
 * The gate, in order, fail-closed at every step:
 *
 *   1. HEIDI_ALLOW_EXEC must be exactly 'true' in the environment —
 *      the operator's master switch for unattended execution.
 *   2. heidi_decision_bounds must be readable — an unreachable bound
 *      is a refused bound, never an implied allow.
 *   3. a bounds row must exist — an empty table means bounds were
 *      never established.
 *   4. unattended_enabled must be true — the owner can kill all
 *      unattended resolver execution via SQL without a deploy.
 *   5. resolverId / capability must not appear in denied_resolvers /
 *      denied_capabilities — per-resolver revocation, live.
 *
 * Scope: this gate applies only where unattended autonomy exists — the
 * daemon's pooled resolver cadence. Pool-less inline sweeps (chat,
 * tests, cold contexts) run attended: a human is in the loop issuing
 * the request, and no durable bounds can be consulted anyway.
 */

/**
 * Read the live bounds row. Fail-closed by contract — the caller treats
 * any {ok:false} as "no unattended execution".
 *
 * @param {object} pool pg.Pool-like { query }
 * @returns {Promise<{ok:true, bounds:object}|{ok:false, reason:string}>}
 */
async function loadAuthorityBounds(pool) {
  if (!pool || typeof pool.query !== 'function') {
    return { ok: false, reason: 'no database pool — durable bounds cannot be consulted' };
  }
  let rows;
  try {
    const res = await pool.query(
      `SELECT unattended_enabled, auto_approve_threshold, max_auto_approve_amount,
              denied_resolvers, denied_capabilities, updated_at
       FROM heidi_decision_bounds
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1`,
    );
    rows = res?.rows;
  } catch (e) {
    return { ok: false, reason: `bounds unreadable: ${e instanceof Error ? e.message : 'query failed'}` };
  }
  if (!rows || rows.length === 0) {
    return { ok: false, reason: 'heidi_decision_bounds holds no row — bounds were never established' };
  }
  const r = rows[0];
  return {
    ok: true,
    bounds: {
      // Column default is true; a NULL only appears on a row that
      // predates the column — its intent is unchanged, so enabled.
      unattendedEnabled: r.unattended_enabled !== false,
      autoApproveThreshold: r.auto_approve_threshold ?? null,
      maxAutoApproveAmount: r.max_auto_approve_amount ?? null,
      deniedResolvers: Array.isArray(r.denied_resolvers) ? r.denied_resolvers : [],
      deniedCapabilities: Array.isArray(r.denied_capabilities) ? r.denied_capabilities : [],
      updatedAt: r.updated_at ?? null,
    },
  };
}

/**
 * The full unattended-authority verdict for one resolver attempt.
 * @returns {{allowed:boolean, code:string, reason:string}}
 */
function checkUnattendedAuthority({ env, boundsResult, resolverId, capability }) {
  const e = env || process.env;
  if (e.HEIDI_ALLOW_EXEC !== 'true') {
    return {
      allowed: false,
      code: 'EXEC_DISABLED',
      reason: 'HEIDI_ALLOW_EXEC is not set to true — unattended execution is closed at the master switch',
    };
  }
  if (!boundsResult || boundsResult.ok !== true) {
    return {
      allowed: false,
      code: 'BOUNDS_UNREACHABLE',
      reason: `durable bounds unavailable: ${boundsResult?.reason || 'no bounds read'}`,
    };
  }
  if (boundsResult.bounds.unattendedEnabled !== true) {
    return {
      allowed: false,
      code: 'UNATTENDED_DISABLED',
      reason: 'heidi_decision_bounds.unattended_enabled is false — the owner closed unattended execution',
    };
  }
  if (resolverId && boundsResult.bounds.deniedResolvers.includes(resolverId)) {
    return {
      allowed: false,
      code: 'RESOLVER_DENIED',
      reason: `resolver '${resolverId}' is revoked in heidi_decision_bounds.denied_resolvers`,
    };
  }
  if (capability && boundsResult.bounds.deniedCapabilities.includes(capability)) {
    return {
      allowed: false,
      code: 'CAPABILITY_DENIED',
      reason: `capability '${capability}' is revoked in heidi_decision_bounds.denied_capabilities`,
    };
  }
  return { allowed: true, code: 'AUTHORIZED', reason: 'within live bounds' };
}

module.exports = { loadAuthorityBounds, checkUnattendedAuthority };
