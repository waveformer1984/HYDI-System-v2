'use strict';

const { isAllowedWrite } = require('./protected-boundaries');

const POLICY_VERSION = 1;
const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * @param {object} item backlog item
 * @param {object} ctx
 * @param {string} ctx.repoRoot
 * @param {string} [ctx.baseSha]
 * @param {string} [ctx.operatorId]
 */
function buildApprovalContract(item, ctx = {}) {
  const now = Date.now();
  const defaultAllowed = ctx.workspaceRel || '.runtime/evolution/workspace/';
  return {
    policy_version: POLICY_VERSION,
    item_id: item.id,
    repository: ctx.repoRoot || process.cwd(),
    base_sha: ctx.baseSha || null,
    allowed_paths: [defaultAllowed],
    forbidden_paths: ['lib/auth/', 'lib/evolution-engine/protected-boundaries.js', 'supabase/migrations/'],
    allowed_actions: ['workspace_patch', 'tests.run:evolution'],
    resource_limits: { max_runtime_ms: 180_000, max_disk_mb: 256 },
    network_policy: { mode: 'none', note: 'Evolution workspace patches do not require egress.' },
    verification_contract: {
      frozen_at: new Date(now).toISOString(),
      test_files: ['tests/unit/evolution-engine-cycle.test.js', 'tests/unit/evolution-engine-control-plane.test.js'],
      regression_probe_allowed: true,
      protected_tests_must_pass: true,
    },
    approval_scope: 'implement_only',
    expires_at: new Date(now + DEFAULT_TTL_MS).toISOString(),
    operator_id: ctx.operatorId || null,
    hypothesis: item.title,
    minimum_worthwhile_gain: item.severity === 'high' ? 'Clear high-severity finding absent on next audit' : 'Finding downgraded or documented limitation',
  };
}

/**
 * @param {object} contract
 * @param {object} opts
 * @param {string} [opts.currentBaseSha]
 * @param {boolean} [opts.approved]
 */
function validateApprovalContract(contract, opts = {}) {
  if (!contract || typeof contract !== 'object') {
    return { ok: false, code: 'missing_contract' };
  }
  if (contract.policy_version !== POLICY_VERSION) {
    return { ok: false, code: 'policy_version_mismatch' };
  }
  if (!opts.approved) {
    return { ok: false, code: 'approval_required' };
  }
  if (contract.expires_at && Date.now() > Date.parse(contract.expires_at)) {
    return { ok: false, code: 'approval_expired' };
  }
  if (opts.currentBaseSha && contract.base_sha && opts.currentBaseSha !== contract.base_sha) {
    return { ok: false, code: 'base_sha_changed', expected: contract.base_sha, actual: opts.currentBaseSha };
  }
  return { ok: true };
}

/**
 * @param {string} relPath
 * @param {object} contract
 */
function assertPathAllowed(relPath, contract) {
  const allowed = contract.allowed_paths || [];
  if (!isAllowedWrite(relPath, allowed)) {
    return { ok: false, code: 'path_not_in_scope', path: relPath };
  }
  return { ok: true };
}

module.exports = {
  POLICY_VERSION,
  buildApprovalContract,
  validateApprovalContract,
  assertPathAllowed,
};
