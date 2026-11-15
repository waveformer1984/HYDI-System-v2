'use strict';

/**
 * Evidence-only operations bundle (audit / dashboard). Does not imply production
 * health on Frank. Each block carries its own collected_at, source, freshness.
 */

const fs = require('fs');
const path = require('path');
const { checkSystem } = require('../../heidi-core/status/system-status');
const { mobileSnapshot } = require('../heidi-mobile/distributed-cloud-snapshot');
const { buildFrankSnapshot } = require('../observation/frank-snapshot');
const { loadLatestFrankProductionTruth } = require('../observation/frank-truth-loader');
const { listInferenceSurfaces, detectRouteConflicts } = require('./inference-route');
const { paidGateEnforcementSummary } = require('./paid-llm-enforcement-sites');
const { proposedDispatcherDecision, MIGRATION_SURFACE } = require('./inference-dispatch-proposal');
const { CAPABILITY_GAP_RANKING } = require('./capability-gap-ranker');

const SCHEMA_VERSION = 1;
const DAEMON_STALE_MS = 180 * 1000;
const FRANK_STALE_MS = 5 * 60 * 1000;
const FIXLIST_STALE_MS = 10 * 60 * 1000;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function fileMtimeMs(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * @param {'fresh'|'stale'|'missing'|'failed'} evidenceState
 */
function evidenceBlock({ name, source, collectedAt, evidenceState, data, error, simulated }) {
  return {
    name,
    source,
    collected_at: collectedAt,
    evidence_state: evidenceState,
    simulated: Boolean(simulated),
    data: data ?? null,
    error: error || null,
  };
}

function ageState(mtimeMs, now, staleMs) {
  if (mtimeMs == null) return 'missing';
  const age = now - mtimeMs;
  if (age > staleMs) return 'stale';
  return 'fresh';
}

function missionsBlock(memory, collectedAt) {
  if (!memory || typeof memory.listMissions !== 'function') {
    return evidenceBlock({
      name: 'missions',
      source: 'heidi-core memory store',
      collectedAt,
      evidenceState: 'missing',
      error: 'mission store not supplied — counts are not reported as zero',
    });
  }
  try {
    const all = memory.listMissions({ limit: 200 }) || [];
    const byState = {};
    for (const m of all) {
      const s = m.status || m.state || 'unknown';
      byState[s] = (byState[s] || 0) + 1;
    }
    const awaiting = all
      .filter((m) => (m.status || m.state) === 'awaiting_approval')
      .slice(0, 15)
      .map((m) => ({ id: m.id, title: m.title || m.name, assigned: m.assigned_agent }));
    return evidenceBlock({
      name: 'missions',
      source: 'heidi-core memory store',
      collectedAt,
      evidenceState: 'fresh',
      data: { counts_by_state: byState, awaiting_approval: awaiting },
    });
  } catch (error) {
    return evidenceBlock({
      name: 'missions',
      source: 'heidi-core memory store',
      collectedAt,
      evidenceState: 'failed',
      error: error instanceof Error ? error.message : 'error',
    });
  }
}

function capabilityMeasurements() {
  return {
    inventory_descriptor_count: 77,
    static_audit_finding_total: 96,
    static_audit_blocking_findings: 77,
    static_audit_by_code: { VERIFICATION_ABSENT: 77, NO_UNDO_PATH: 19 },
    verification_contract_coverage: {
      with_verification_spec: 0,
      verification_absent: 77,
      measured_by: 'scripts/capability-contract-audit.ts on lifted legacy set',
    },
    live_execution_verified: {
      value: null,
      note: 'Not measured by this endpoint',
    },
    gap_priority_ranking: CAPABILITY_GAP_RANKING,
    labels: {
      inventory_descriptor_count: 'CapabilityRegistry.DEFAULT_CAPABILITIES descriptors lifted to contracts',
      static_audit_finding_total: 'Automated audit script findings count (not live execution)',
      verification_contract_coverage: 'Contract has observable verification spec',
    },
  };
}

function sanitizeForExport(obj) {
  return JSON.parse(
    JSON.stringify(obj, (_k, v) => {
      if (typeof v === 'string' && /^(sk_|xoxb-|ghp_)/.test(v)) return '[REDACTED]';
      return v;
    }),
  );
}

function configuredFlags(env) {
  return {
    HYDI_ALLOW_PAID_LLM: Boolean(String(env.HYDI_ALLOW_PAID_LLM || '').trim()),
    HEIDI_MOBILE_TOKEN: Boolean(env.HEIDI_MOBILE_TOKEN),
    HEIDI_SECRET: Boolean(env.HEIDI_SECRET),
    HEIDI_AUTONOMOUS_ACTIONS: Boolean(String(env.HEIDI_AUTONOMOUS_ACTIONS || '').trim()),
    HEIDI_AUTO_APPROVE_RESTARTS: Boolean(String(env.HEIDI_AUTO_APPROVE_RESTARTS || '').trim()),
  };
}

function frankProductionTruthBlock(opts, root, now) {
  if (opts.frankProductionTruth != null) {
    return parseFrankCollectorReport(opts.frankProductionTruth);
  }
  const loaded = loadLatestFrankProductionTruth({ root, now });
  if (loaded.availability === 'UNAVAILABLE' && !loaded.data) {
    return evidenceBlock({
      name: 'frank_production_truth',
      source: loaded.path || '.runtime/production-truth',
      collectedAt: new Date(now).toISOString(),
      evidenceState: loaded.evidence_state,
      error: loaded.error,
    });
  }
  return evidenceBlock({
    name: 'frank_production_truth',
    source: loaded.path || 'scripts/frank-production-truth-collect.ps1',
    collectedAt: loaded.collected_at || new Date(now).toISOString(),
    evidenceState: loaded.evidence_state,
    data: {
      availability: loaded.availability,
      host: loaded.host,
      git_head: loaded.git_head,
      git_branch: loaded.git_branch,
      pm2_ok: loaded.pm2_ok,
      probe_summary: loaded.probe_summary,
      local_ci_hint: loaded.local_ci_hint,
      file_age_ms: loaded.age_ms,
    },
  });
}

function parseFrankCollectorReport(data) {
  if (!data || typeof data !== 'object') {
    return evidenceBlock({
      name: 'frank_production_truth',
      source: 'operator-attached JSON',
      collectedAt: new Date().toISOString(),
      evidenceState: 'missing',
      error: 'no Frank collector payload supplied',
    });
  }
  const schema = data.schema_version;
  if (schema != null && schema !== 1) {
    return evidenceBlock({
      name: 'frank_production_truth',
      source: 'scripts/frank-production-truth-collect.ps1',
      collectedAt: data.collected_at || new Date().toISOString(),
      evidenceState: 'failed',
      error: `schema_version mismatch: expected 1, got ${schema}`,
      data: { schema_version: schema },
    });
  }
  return evidenceBlock({
    name: 'frank_production_truth',
    source: 'scripts/frank-production-truth-collect.ps1',
    collectedAt: data.collected_at || new Date().toISOString(),
    evidenceState: 'fresh',
    data: {
      note: 'Timestamped operator evidence — not permanent proof of health',
      host: data.host,
      git_head: data.git_head,
      pm2_ok: data.pm2 && data.pm2.ok,
      probe_count: Array.isArray(data.probes) ? data.probes.length : null,
    },
  });
}

/**
 * @param {object} opts
 */
async function buildOperationsEvidenceSnapshot(opts = {}) {
  const root = opts.root || path.resolve(__dirname, '..', '..');
  const env = opts.env || process.env;
  const now = opts.now || Date.now();
  const collectedAt = new Date(now).toISOString();

  let liveProbes;
  try {
    const system = await checkSystem({
      root,
      fetchImpl: opts.fetchImpl || fetch,
      env,
      memoryRuntime: opts.memoryRuntime,
      timeoutMs: opts.timeoutMs || 4000,
      uptimeMs: opts.uptimeMs,
    });
    liveProbes = evidenceBlock({
      name: 'live_system_probes',
      source: 'heidi-core/status/system-status.js checkSystem()',
      collectedAt,
      evidenceState: 'fresh',
      data: {
        overall_from_live_probes_only: system.overall,
        components: system.components,
        checked_at: system.checked_at || collectedAt,
      },
    });
  } catch (error) {
    liveProbes = evidenceBlock({
      name: 'live_system_probes',
      source: 'heidi-core/status/system-status.js checkSystem()',
      collectedAt,
      evidenceState: 'failed',
      error: error instanceof Error ? error.message : 'error',
    });
  }

  const daemonPath = path.join(root, '.heidi-daemon-status.json');
  const daemonJson = readJson(daemonPath);
  const daemonMtime = fileMtimeMs(daemonPath);
  const daemonState = ageState(daemonMtime, now, DAEMON_STALE_MS);
  const daemonBlock = evidenceBlock({
    name: 'daemon_status_file',
    source: daemonPath,
    collectedAt,
    evidenceState: daemonJson ? daemonState : 'missing',
    data: daemonJson
      ? {
          updatedAt: daemonJson.updatedAt,
          file_mtime_ms: daemonMtime,
          state: daemonJson.state,
          persistence: daemonJson.persistence,
          cycleCount: daemonJson.cycleCount,
          consecutiveFailures: daemonJson.consecutiveFailures,
        }
      : null,
    error: daemonJson ? (daemonState === 'stale' ? 'status file older than 180s' : null) : 'file absent',
  });

  let frankBlock;
  try {
    const frank = buildFrankSnapshot({ root, now });
    const frankPath = path.join(root, '.runtime', 'observation', 'frank.json');
    const frankMtime = fileMtimeMs(frankPath);
    const st = ageState(frankMtime, now, FRANK_STALE_MS);
    frankBlock = evidenceBlock({
      name: 'frank_observation',
      source: frankPath,
      collectedAt,
      evidenceState: st === 'missing' ? 'missing' : st,
      data: frank,
    });
  } catch (error) {
    frankBlock = evidenceBlock({
      name: 'frank_observation',
      source: 'lib/observation/frank-snapshot.js',
      collectedAt,
      evidenceState: 'failed',
      error: error instanceof Error ? error.message : 'error',
    });
  }

  const fixPath = path.join(root, '.runtime', 'fixlist', 'current.json');
  const fixJson = readJson(fixPath);
  const fixMtime = fileMtimeMs(fixPath);
  const fixState = fixJson ? ageState(fixMtime, now, FIXLIST_STALE_MS) : 'missing';
  const fixBlock = evidenceBlock({
    name: 'fix_list',
    source: fixPath,
    collectedAt,
    evidenceState: fixState,
    data: fixJson
      ? {
          generatedAt: fixJson.generatedAt,
          counts: fixJson.counts,
          top_items: (fixJson.items || []).slice(0, 5).map((i) => ({
            level: i.level,
            kind: i.kind,
            subject: i.subject,
          })),
        }
      : null,
  });

  let distributedBlock;
  try {
    const simulated = !env.HYDI_DISTRIBUTED_WORKER_SECRET;
    const distributed = mobileSnapshot({ simulated });
    distributedBlock = evidenceBlock({
      name: 'distributed_control_plane',
      source: 'lib/distributed-cloud/control-plane (in-process)',
      collectedAt,
      evidenceState: simulated ? 'fresh' : 'fresh',
      simulated,
      data: distributed,
    });
  } catch (error) {
    distributedBlock = evidenceBlock({
      name: 'distributed_control_plane',
      source: 'lib/distributed-cloud/control-plane',
      collectedAt,
      evidenceState: 'failed',
      error: error instanceof Error ? error.message : 'error',
    });
  }

  const storePath = path.join(root, '.runtime', 'partnerships-funding', 'opportunities.json');
  const storeJson = readJson(storePath);
  const storeMtime = fileMtimeMs(storePath);
  const resourceBlock = evidenceBlock({
    name: 'resource_acquisition_store',
    source: storePath,
    collectedAt,
    evidenceState: storeJson ? ageState(storeMtime, now, FIXLIST_STALE_MS) : 'missing',
    data: storeJson
      ? {
          opportunity_count: (storeJson.opportunities || storeJson.items || []).length,
          store_updated_at: storeJson.updated_at || storeJson.updatedAt || null,
          file_mtime_ms: storeMtime,
        }
      : null,
  });

  const bundle = {
    schema_version: SCHEMA_VERSION,
    bundle_collected_at: collectedAt,
    execution_paths_unchanged: true,
    inference_registry_note:
      'lib/heidi/inference-route.js is audit metadata only — not completed inference consolidation',
    live_probe_rollup:
      liveProbes.evidence_state === 'fresh' && liveProbes.data
        ? liveProbes.data.overall_from_live_probes_only
        : null,
    rollup_disclaimer:
      'live_probe_rollup is from timed HTTP/file probes at bundle_collected_at only. Stale files are not merged into it.',
    evidence: {
      live_system_probes: liveProbes,
      daemon_status_file: daemonBlock,
      frank_observation: frankBlock,
      fix_list: fixBlock,
      distributed_control_plane: distributedBlock,
      resource_acquisition_store: resourceBlock,
      missions: missionsBlock(opts.memory, collectedAt),
      frank_production_truth: frankProductionTruthBlock(opts, root, now),
    },
    inference_audit: {
      routes: listInferenceSurfaces(env),
      conflicts: detectRouteConflicts(env),
      paid_gate: paidGateEnforcementSummary(env),
      dispatch_proposal: proposedDispatcherDecision(MIGRATION_SURFACE, env),
    },
    capability_measurements: capabilityMeasurements(),
    security_flags_configured: configuredFlags(env),
    frank_collector_expected_schema_version: 2,
  };

  return sanitizeForExport(bundle);
}

module.exports = { buildOperationsEvidenceSnapshot, SCHEMA_VERSION, evidenceBlock };