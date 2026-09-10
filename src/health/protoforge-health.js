/**
 * ProtoForge core health report
 * ---------------------------------------------------------------------------
 * Phase II (false-green elimination).
 *
 * The GET /health handler in src/server.js used to be four lines:
 *
 *     const moduleCount = 0;              // "Get module count (placeholder)"
 *     const { count } = await supabase.from('heidi_events')...
 *     res.json({ status: 'ok', modules: moduleCount, events: count || 0 });
 *
 * Two lies lived in there:
 *
 *  1. `modules` was a hardcoded 0 that had never been anything else. Nothing in
 *     the repo defines what a "module" means for this endpoint -- no test
 *     asserts on the field, no caller reads it -- so the number was decoration
 *     shaped like evidence.
 *  2. `status: 'ok'` was unconditional inside the try block, and `count || 0`
 *     collapsed "the database returned no count" into a confident-looking 0.
 *     The endpoint reported ok whenever Express could run the handler at all,
 *     which is exactly what boot-agent gated on and what the watchdog scored as
 *     healthy.
 *
 * This module reports observed values with explicit provenance instead. The
 * module count is read from this process's own Universal Agent Bus registry --
 * the only real module registry this server owns -- and when that registry
 * cannot be read the report says UNVERIFIED rather than substituting a number.
 *
 * Residual known gap, deliberately surfaced rather than papered over: the
 * historical *intent* of the `modules` field is undocumented. What is reported
 * here is a real, checkable quantity with its source named in the payload, not
 * a reconstruction of an intent nobody recorded.
 */

'use strict';

const HEALTHY = 'HEALTHY';
const UNVERIFIED = 'UNVERIFIED';
const UNAVAILABLE = 'UNAVAILABLE';

/**
 * Read the count of modules registered on the agent bus.
 * Returns an evidence object; never throws, never guesses.
 */
function checkModuleRegistry(agentBus) {
  const source = 'universal-agent-bus.modelHealth';
  try {
    const size = agentBus && agentBus.modelHealth ? agentBus.modelHealth.size : undefined;
    if (typeof size === 'number' && Number.isFinite(size)) {
      return {
        state: HEALTHY,
        count: size,
        source,
        evidence: `${size} module(s) registered on the agent bus`,
      };
    }
    return {
      state: UNVERIFIED,
      count: null,
      source,
      evidence: 'agent bus registry is not readable (modelHealth missing or not a Map)',
    };
  } catch (error) {
    return {
      state: UNVERIFIED,
      count: null,
      source,
      evidence: `agent bus registry read threw: ${error.message}`,
    };
  }
}

/**
 * Probe the database by counting heidi_events.
 * A missing count is UNVERIFIED, not zero.
 */
async function checkDatabase(supabase) {
  try {
    const { count, error } = await supabase
      .from('heidi_events')
      .select('*', { count: 'exact', head: true });

    if (error) {
      return {
        state: UNAVAILABLE,
        count: null,
        evidence: `heidi_events probe failed: ${error.message}`,
      };
    }
    if (typeof count !== 'number' || !Number.isFinite(count)) {
      // Previously `count || 0` turned this case into a confident zero.
      return {
        state: UNVERIFIED,
        count: null,
        evidence: 'heidi_events probe returned no count',
      };
    }
    return {
      state: HEALTHY,
      count,
      evidence: `heidi_events count=${count}`,
    };
  } catch (error) {
    return {
      state: UNAVAILABLE,
      count: null,
      evidence: `heidi_events probe threw: ${error.message}`,
    };
  }
}

/**
 * Build the /health body.
 *
 * `status` is derived from the checks -- it is never asserted. It is 'ok' only
 * when every check produced positive evidence.
 */
async function buildProtoforgeHealth({ agentBus, supabase, now = () => new Date() }) {
  const moduleRegistry = checkModuleRegistry(agentBus);
  const database = await checkDatabase(supabase);

  const checks = { module_registry: moduleRegistry, database };
  const states = Object.values(checks).map((c) => c.state);
  const status = states.every((s) => s === HEALTHY) ? 'ok' : 'degraded';

  const degradedReasons = Object.entries(checks)
    .filter(([, c]) => c.state !== HEALTHY)
    .map(([name, c]) => `${name}=${c.state} (${c.evidence})`);

  return {
    status,
    // Back-compatible field names, now carrying observed values or null --
    // never a placeholder standing in for something unknown.
    modules: moduleRegistry.count,
    modules_state: moduleRegistry.state,
    events: database.count,
    checks,
    ...(degradedReasons.length ? { degraded_reasons: degradedReasons } : {}),
    timestamp: now().toISOString(),
  };
}

module.exports = {
  buildProtoforgeHealth,
  checkModuleRegistry,
  checkDatabase,
};
