'use strict';

/**
 * Human Action Resolution Agent — the standing governed identity that
 * owns the resolution cadence:
 *
 *   discover (detector rules) → classify (resolver-policy) → assign the
 *   human-path contract → attempt authorized resolvers → independent
 *   verifier → resume satisfied goals.
 *
 * This is NOT a second agent architecture — it is a thin, durable
 * wrapper around syncHumanActions that gives the pass a governed
 * identity in the Agent Control Plane:
 *
 *   - role 'resolver', deterministic identity `agent-resolver-<mission>`
 *   - one coordinator mission per hour bucket (targetKey 'sweep:<hour>')
 *     — repeat cadence calls collapse onto the same mission, so the
 *     plane shows the agent worked this hour without mission spam
 *   - the sweep itself runs inside the mission handler when the mission
 *     is created/claimable — heartbeats + COMPLETED/FAILED + the plane's
 *     advisory-lock claim mean two processes can never run it twice
 *     concurrently
 *   - when the mission is terminal for the hour, or the agent budget is
 *     exhausted, the cadence still runs inline — resolver attempts are
 *     the durable evidence either way; the mission envelope is the
 *     audit surface, not a lock on correctness
 *   - no pool (chat, tests, cold contexts) → identical governed sweep
 *     inline — same authorization checks, same timeout bound, same
 *     verifier-owned truth
 *
 * The agent's permissions are exactly the resolver registry's: it can
 * classify, persist the contract, attempt R0/R1 resolvers within scope,
 * and request verification. It cannot mark anything RESOLVED — verify()
 * owns that. It cannot invent credentials, widen scope, or cross an
 * R2/R3/R4 boundary.
 */

const { HumanActionService } = require('./service');
const { syncHumanActions } = require('./detector');

const RESOLVER_AGENT_ID = 'agent-human-action-resolver';

function hourBucket(d = new Date()) {
  return d.toISOString().slice(0, 13); // YYYY-MM-DDTHH — one coordinator mission per hour
}

/** Compact, secret-safe summary of a sync pass for mission evidence. */
function summarizeSync(out) {
  return {
    detected: out.detection ? { checked: out.detection.checked, requested: out.detection.requested.length, alreadyOpen: out.detection.alreadyOpen.length } : null,
    resolve: out.resolve ? {
      classified: out.resolve.classified ?? 0,
      attempted: out.resolve.attempted?.length ?? 0,
      unauthorized: out.resolve.unauthorized?.length ?? 0,
      deferred: out.resolve.deferred?.length ?? 0,
      failed: out.resolve.failed?.length ?? 0,
      human: out.resolve.human?.length ?? 0,
    } : null,
    verify: out.verify ? { checked: out.verify.checked, resolved: (out.verify.resolved || []).length, stillBlocked: (out.verify.stillBlocked || []).length } : null,
    resumed: out.resume?.resumed?.length ?? 0,
  };
}

/**
 * Run one governed resolution pass as the Human Action Resolution Agent.
 * Returns { agent, missionId, via, sync } — 'mission' when the pass ran
 * inside an Agent Control Plane mission, 'inline' for the pool-less
 * cadence, 'mission+inline' when the hour's mission was terminal and the
 * cadence still needed to run.
 */
async function runHumanActionResolverAgent({ service, goals, pool, env, resolverDeps, actor } = {}) {
  const svc = service || new HumanActionService();
  const runSweep = () => syncHumanActions(svc, goals, { env, pool, resolverDeps, actor });

  if (!pool) {
    const sync = await runSweep();
    return { agent: RESOLVER_AGENT_ID, missionId: null, via: 'inline', sync, summary: summarizeSync(sync) };
  }

  let acp;
  try { acp = require('../heidi/AgentControlPlane'); } catch { acp = null; }
  if (!acp) {
    const sync = await runSweep();
    return { agent: RESOLVER_AGENT_ID, missionId: null, via: 'inline', sync, summary: summarizeSync(sync) };
  }

  const state = await acp.collectAgentState(pool).catch(() => null);
  const atCapacity = !!state && state.activeCount >= acp.maxActiveAgents();

  const spec = {
    role: 'resolver',
    objective: 'human-action-resolution-sweep',
    targetKey: `sweep:${hourBucket()}`,
    params: { agent: RESOLVER_AGENT_ID, coordinated: true },
    authorizationLevel: 'R1',
    maxRuntimeMs: 120 * 1000,
    maxRetries: 1,
    priority: 10,
  };

  const m = atCapacity ? null : await acp.createMission(pool, spec).catch(() => null);
  if (m) {
    // runAgent's advisory claim serializes concurrent claimants. If the
    // handler ran this pass the sweep is already done; if the mission
    // was already terminal (or a concurrent claimant won), the cadence
    // still runs inline — detection/verify stay fresh every poll.
    let ranInMission = false;
    await acp.runAgent(pool, m.missionId, {
      resolver: async ({ heartbeat }) => {
        await heartbeat('resolution sweep');
        const sync = await runSweep();
        ranInMission = true;
        return { result: summarizeSync(sync), evidence: [{ sweep: summarizeSync(sync) }] };
      },
    }).catch(() => null);
    if (ranInMission) {
      const after = await acp.collectAgentState(pool).catch(() => null);
      const mv = after?.missions?.find((x) => x.missionId === m.missionId);
      return {
        agent: RESOLVER_AGENT_ID, missionId: m.missionId, via: 'mission',
        missionStatus: mv?.status ?? 'COMPLETED', sync: null, summary: mv?.result ?? null,
      };
    }
    const sync = await runSweep();
    return {
      agent: RESOLVER_AGENT_ID, missionId: m.missionId, via: 'mission+inline',
      sync, summary: summarizeSync(sync),
    };
  }

  // Agent budget exhausted — per-action resolver deployments are
  // budget-checked inside the sweep; the coordinator envelope is
  // bookkeeping, so the cadence still runs inline.
  const sync = await runSweep();
  return { agent: RESOLVER_AGENT_ID, missionId: null, via: 'inline', atCapacity, sync, summary: summarizeSync(sync) };
}

module.exports = { runHumanActionResolverAgent, RESOLVER_AGENT_ID, hourBucket };
