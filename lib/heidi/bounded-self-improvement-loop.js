'use strict';

/**
 * Bounded self-improvement loop — explicit owner request only; reuses evidence + evolution planner.
 * Does NOT merge, deploy, approve its own escalations, or widen permissions.
 */

const path = require('path');
const { execFileSync } = require('child_process');
const { buildOperationsEvidenceSnapshot } = require('./operations-evidence-snapshot');
const { buildOperationalSupervisorReport } = require('./operational-supervisor');
const { collectGapsFromEvidence, rankGaps, plannerBacklog } = require('./self-improvement-gaps');
const {
  loadActiveMission,
  saveActiveMission,
  clearActiveMission,
  appendHistory,
} = require('./self-improvement-store');

const LIMITS = Object.freeze({
  maxSteps: 5,
  maxRepairRetries: 1,
  maxConsecutiveFailures: 2,
});

const AUTHORITY = {
  observe: 'autonomous',
  diagnose: 'autonomous',
  propose: 'autonomous',
  test: 'autonomous',
  verify: 'autonomous',
  record: 'autonomous',
  implement: 'human_or_env',
};

const IMPLEMENT_ENV = 'SELF_IMPROVE_ALLOW_PATCH';

function assertOwnerRequested(opts) {
  if (!opts.ownerRequested) {
    return { ok: false, code: 'OWNER_REQUEST_REQUIRED', message: 'Loop runs only on explicit owner request.' };
  }
  return { ok: true };
}

/**
 * @param {object} gap
 */
function buildActionChain(gap) {
  const chain = [
    {
      step: 'observe',
      authority: AUTHORITY.observe,
      operation: 'buildOperationsEvidenceSnapshot',
      expected_evidence: ['live_probe_rollup', 'evidence.live_system_probes'],
    },
    {
      step: 'diagnose',
      authority: AUTHORITY.diagnose,
      operation: 'collectGapsFromEvidence',
      expected_evidence: ['ranked gap id'],
    },
    {
      step: 'propose',
      authority: AUTHORITY.propose,
      operation: 'saveActiveMission (.runtime/self-improvement/)',
      expected_evidence: ['mission record'],
    },
  ];

  if (gap.id === 'status-live-probes-failed-not-surfaced') {
    chain.push(
      {
        step: 'test',
        authority: AUTHORITY.test,
        operation: 'jest operational-supervisor',
        expected_evidence: ['exit 0'],
      },
      {
        step: 'verify',
        authority: AUTHORITY.verify,
        operation: 'buildOperationalSupervisorReport (failed probes)',
        expected_evidence: ['treat_status_degraded recommendation'],
      },
    );
  } else if (gap.execution_mode === 'operator_frank_only') {
    chain.push({
      step: 'verify',
      authority: AUTHORITY.verify,
      operation: 'operator on Frank',
      expected_evidence: ['authentic logs — not fabricable from cloud'],
    });
  }

  chain.push({
    step: 'record',
    authority: AUTHORITY.record,
    operation: 'history.jsonl + improvement brief',
    expected_evidence: ['brief object'],
  });

  return chain;
}

function runJest(testPath, root) {
  try {
    execFileSync('npx', ['jest', testPath, '--runInBand', '--forceExit'], {
      cwd: root,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 120000,
    });
    return { ok: true };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    return { ok: false, error: err.message };
  }
}

function formatBrief({ chosen, baseline, progress, supervisorAfter, snapshot, next }) {
  return {
    observed_gap: chosen
      ? { id: chosen.id, problem: chosen.observed_problem, evidence: chosen.evidence }
      : null,
    chosen_improvement: chosen
      ? {
          why: chosen.proposed_outcome,
          rank_score: chosen.rank_score,
          acceptance_check: chosen.acceptance_check,
        }
      : null,
    action_chain: chosen ? buildActionChain(chosen) : [],
    progress,
    proof: {
      baseline,
      after: supervisorAfter
        ? {
            failures: supervisorAfter.failures,
            recommendations: supervisorAfter.recommendations?.slice(0, 8),
          }
        : null,
      labels: {
        patch_implemented: progress.some((p) => p.step === 'implement' && p.completed),
        tests_passed: progress.some((p) => p.step === 'test' && p.completed),
        change_merged: false,
        change_deployed: false,
        owner_facing_outcome_verified:
          progress.some((p) => p.step === 'verify' && p.completed && p.outcome === 'verified'),
      },
    },
    storage: {
      active: '.runtime/self-improvement/active-mission.json',
      history: '.runtime/self-improvement/history.jsonl',
    },
    next_decision: next,
    rollup_disclaimer: snapshot?.rollup_disclaimer || null,
  };
}

/**
 * @param {object} opts
 */
async function runBoundedSelfImprovement(opts = {}) {
  const root = opts.root || path.resolve(__dirname, '..', '..');
  const env = opts.env || process.env;
  const gate = assertOwnerRequested(opts);
  if (!gate.ok) return { ok: false, ...gate };

  if (loadActiveMission(root) && !opts.forceNew) {
    return { ok: false, code: 'ACTIVE_MISSION', message: 'One active improvement mission at a time.' };
  }

  const progress = [];
  let stepsExecuted = 0;
  let consecutiveFailures = 0;

  const execStep = async () => {
    stepsExecuted++;
    if (stepsExecuted > LIMITS.maxSteps) {
      return { stop: true, code: 'STEP_LIMIT' };
    }
    return {};
  };

  let snapshot = null;
  let baseline = null;
  let chosen = null;
  let supervisorAfter = null;

  let gateStep = await execStep();
  if (gateStep.stop) return { ok: false, code: gateStep.code, progress };

  try {
      snapshot = await buildOperationsEvidenceSnapshot({
        root,
        fetchImpl: opts.fetchImpl,
        env,
        memory: opts.memory,
        frankProductionTruth: opts.frankProductionTruth,
      });
      baseline = {
        at: snapshot.bundle_collected_at,
        live_probe_rollup: snapshot.live_probe_rollup,
        live_probe_state: snapshot.evidence?.live_system_probes?.evidence_state,
      };
      progress.push({ step: 'observe', completed: true, evidence: baseline });
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures++;
      progress.push({ step: 'observe', completed: false, error: error instanceof Error ? error.message : 'error' });
      return {
        ok: false,
        code: 'OBSERVE_FAILED',
        progress,
        brief: formatBrief({ chosen, baseline, progress, supervisorAfter, snapshot, next: 'fix_observe_blocker' }),
      };
    }

  gateStep = await execStep();
  if (gateStep.stop) return { ok: false, code: gateStep.code, progress };

  {
    const gaps = collectGapsFromEvidence(snapshot, { local_ci_incident_open: opts.localCiIncidentOpen });
    const ranked = rankGaps(gaps);
    if (!ranked.length) {
      progress.push({ step: 'diagnose', completed: false, error: 'no gaps' });
      return {
        ok: false,
        code: 'NO_GAPS',
        progress,
        brief: formatBrief({ chosen, baseline, progress, supervisorAfter, snapshot, next: 'reassess_later' }),
      };
    }
    chosen = opts.gapId ? ranked.find((g) => g.id === opts.gapId) || ranked[0] : ranked[0];
    progress.push({
      step: 'diagnose',
      completed: true,
      evidence: { chosen_id: chosen.id, deferred: ranked.slice(1).map((g) => g.id) },
    });
  }

  gateStep = await execStep();
  if (gateStep.stop) return { ok: false, code: gateStep.code, progress };

  {
    const mission = {
      id: `si-${Date.now()}`,
      state: 'running',
      started_at: new Date().toISOString(),
      gap_id: chosen.id,
      chain: buildActionChain(chosen),
      baseline,
    };
    saveActiveMission(root, mission);
    progress.push({ step: 'propose', completed: true, evidence: { mission_id: mission.id } });
  }

  if (chosen.id === 'status-live-probes-failed-not-surfaced') {
    gateStep = await execStep();
    if (gateStep.stop) return { ok: false, code: gateStep.code, progress };

    {
      const test = runJest('tests/unit/operational-supervisor.test.js', root);
      if (!test.ok) {
        consecutiveFailures++;
        progress.push({ step: 'test', completed: false, error: test.error });
        return {
          ok: false,
          code: consecutiveFailures >= LIMITS.maxConsecutiveFailures ? 'TEST_FAILED' : 'TEST_FAILED',
          progress,
          brief: formatBrief({ chosen, baseline, progress, supervisorAfter, snapshot, next: 'request_approval_or_fix' }),
        };
      }
      progress.push({ step: 'test', completed: true });
      consecutiveFailures = 0;
    }
  } else if (chosen.execution_mode === 'operator_frank_only') {
    progress.push({ step: 'test', completed: false, skipped: true, reason: 'Frank-only gap' });
    return {
      ok: true,
      partial: true,
      progress,
      brief: formatBrief({ chosen, baseline, progress, supervisorAfter, snapshot, next: 'operator_frank' }),
    };
  }

  if (chosen.id === 'status-live-probes-failed-not-surfaced') {
    gateStep = await execStep();
    if (gateStep.stop) return { ok: false, code: gateStep.code, progress };

    supervisorAfter = await buildOperationalSupervisorReport({
      root,
      fetchImpl: opts.fetchImpl || (async () => ({ ok: false, status: 0 })),
    });
    const hasRec = supervisorAfter.recommendations?.some((r) => r.action === 'treat_status_degraded');
    const hasFail = supervisorAfter.failures?.some((f) => f.area === 'live_system_probes');
    const verified = Boolean(hasRec && hasFail);
    progress.push({
      step: 'verify',
      completed: verified,
      outcome: verified ? 'verified' : 'implemented_outcome_unverified',
      evidence: { hasRec, hasFail },
    });
  }

  const brief = formatBrief({
    chosen,
    baseline,
    progress,
    supervisorAfter,
    snapshot,
    next: chosen.execution_mode === 'operator_frank_only' ? 'operator_frank' : 'reassess_backlog',
  });
  appendHistory(root, { type: 'run_complete', gap_id: chosen.id, brief_summary: brief.observed_gap });
  clearActiveMission(root);
  progress.push({ step: 'record', completed: true });

  return { ok: true, progress, brief };
}

async function assessImprovementOpportunities(opts = {}) {
  const root = opts.root || path.resolve(__dirname, '..', '..');
  const snapshot = await buildOperationsEvidenceSnapshot({
    root,
    fetchImpl: opts.fetchImpl,
    env: opts.env || process.env,
    frankProductionTruth: opts.frankProductionTruth,
  });
  const gaps = rankGaps(collectGapsFromEvidence(snapshot, { local_ci_incident_open: opts.localCiIncidentOpen }));
  return {
    snapshot_rollup: snapshot.live_probe_rollup,
    gaps,
    backlog: plannerBacklog(gaps),
  };
}

module.exports = {
  LIMITS,
  AUTHORITY,
  runBoundedSelfImprovement,
  assessImprovementOpportunities,
  buildActionChain,
  formatBrief,
};