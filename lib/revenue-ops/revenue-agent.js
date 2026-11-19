'use strict';

/**
 * Governed Revenue Agent — composes existing revenue-ops modules; not a new orchestrator.
 * HYDI-REVENUE-001
 */

const fs = require('fs');
const path = require('path');
const { connectorHealth } = require('./connectors');
const { listCapabilities } = require('./capabilities');
const { loadStore, opsDir } = require('./store');
const { loadProspects, pipelineDir } = require('./customer-pipeline');
const { loadLedger, ledgerDir, dailyReport, hardwareReservePlan } = require('./financial-ledger');
const { rankOpportunities } = require('./product-opportunity-score');
const { PRODUCT_CATALOG } = require('./product-catalog');

const OWNER_APPROVAL_ACTIONS = new Set([
  'send_external_communication',
  'contract_commitment',
  'charge_customer',
  'spend_money',
  'purchase_subscription',
  'sensitive_customer_access',
  'production_deploy',
  'mark_paid_without_stripe',
]);

function requiresOwnerApproval(action) {
  return OWNER_APPROVAL_ACTIONS.has(action);
}

function autonomousAllowed(action) {
  return !requiresOwnerApproval(action);
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, fetchImpl?: typeof fetch }} [opts]
 */
function readScoutStatus(env) {
  const root = path.resolve(__dirname, '..', '..');
  const scoutDir = env.JOB_SCOUT_DIR ? path.resolve(env.JOB_SCOUT_DIR) : path.join(root, '.runtime', 'job-scout');
  try {
    return JSON.parse(fs.readFileSync(path.join(scoutDir, 'status.json'), 'utf8'));
  } catch {
    return null;
  }
}

function readJobScoutSources(env) {
  const cfgPath = env.JOB_SCOUT_CONFIG
    ? path.resolve(env.JOB_SCOUT_CONFIG)
    : path.join(path.resolve(__dirname, '..', '..'), 'config', 'job-scout.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    return cfg.sources || {};
  } catch {
    return {};
  }
}

async function runDailyWorkflow(opts = {}) {
  const env = opts.env || process.env;
  const scoutStatus = readScoutStatus(env);
  const health = connectorHealth(scoutStatus, readJobScoutSources(env));
  const capabilities = listCapabilities();
  const store = loadStore(opsDir(env));
  const prospects = loadProspects(pipelineDir(env));
  const ledger = loadLedger(ledgerDir(env));
  const rankedProducts = rankOpportunities(PRODUCT_CATALOG);

  const blockers = [];
  const degraded = health.filter((h) => h.access === 'active' && h.lastOk === false);
  if (degraded.length) blockers.push(`connectors_degraded:${degraded.map((h) => h.id).join(',')}`);

  const nextActions = [];
  const awaitingApproval = store.opportunities.filter((o) => o.state === 'AWAITING_APPROVAL');
  if (awaitingApproval.length) {
    nextActions.push({ action: 'review_freelance_proposals', count: awaitingApproval.length, autonomous: true });
  }
  const contactReady = prospects.prospects.filter((p) => p.status === 'QUALIFIED');
  if (contactReady.length) {
    nextActions.push({
      action: 'request_owner_contact_approval',
      count: contactReady.length,
      autonomous: false,
    });
  }
  if (!nextActions.length) {
    nextActions.push({
      action: 'research_top_product_opportunity',
      productId: rankedProducts[0]?.id || null,
      autonomous: autonomousAllowed('research'),
    });
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    connectors: health,
    capabilityCount: capabilities.length,
    pipeline: {
      opportunities: store.opportunities.length,
      states: countByState(store.opportunities),
    },
    prospects: {
      count: prospects.prospects.length,
      states: countByState(prospects.prospects, 'status'),
    },
    finance: {
      daily: dailyReport(ledger),
      hardware: hardwareReservePlan(ledger),
    },
    rankedProducts: rankedProducts.slice(0, 3).map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score.total,
    })),
    blockers,
    nextActions,
  };
}

function countByState(rows, key = 'state') {
  const out = {};
  for (const r of rows || []) {
    const s = r[key] || 'unknown';
    out[s] = (out[s] || 0) + 1;
  }
  return out;
}

module.exports = {
  RevenueAgent: { runDailyWorkflow, requiresOwnerApproval, autonomousAllowed },
  runDailyWorkflow,
  requiresOwnerApproval,
  autonomousAllowed,
};