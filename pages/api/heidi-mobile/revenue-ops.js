'use strict';

/**
 * Heidi Mobile — Revenue Operations (discovery, proposals, approvals).
 * Reuses job-scout scans; never submits to marketplaces without explicit approval.
 */

const path = require('path');
const fs = require('fs');
const { guard } = require('../../../lib/heidi-mobile/guard.js');
const { scoutDir } = require('../../../lib/job-scout/scout');
const { connectorHealth } = require('../../../lib/revenue-ops/connectors');
const {
  opsDir,
  loadStore,
  saveStore,
  loadConfig,
} = require('../../../lib/revenue-ops/store');
const {
  queueForApproval,
  approveProposal,
  rejectOpportunity,
  submitProposal,
} = require('../../../lib/revenue-ops/approval');
const {
  approveExecution,
  simulateClientAccept,
  startContractExecution,
} = require('../../../lib/revenue-ops/execution-bridge');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function buckets(opportunities) {
  const b = {
    new: [],
    top: [],
    proposalDrafts: [],
    awaitingApproval: [],
    submitted: [],
    active: [],
    inProgress: [],
    delivered: [],
    payments: [],
    failed: [],
    connectors: [],
  };
  const byScore = [...opportunities].sort((a, b) => (b.assessment?.opportunityScore || 0) - (a.assessment?.opportunityScore || 0));
  b.top = byScore.slice(0, 10);
  for (const o of opportunities) {
    switch (o.state) {
      case 'DISCOVERED':
      case 'VALIDATING':
      case 'SCORED':
        b.new.push(o);
        break;
      case 'QUALIFIED':
      case 'PROPOSAL_READY':
        if (o.proposal) b.proposalDrafts.push(o);
        else b.new.push(o);
        break;
      case 'AWAITING_APPROVAL':
        b.awaitingApproval.push(o);
        break;
      case 'SUBMITTED':
      case 'CLIENT_RESPONSE':
        b.submitted.push(o);
        break;
      case 'ACCEPTED':
        b.active.push(o);
        break;
      case 'EXECUTING':
      case 'VERIFYING':
        b.inProgress.push(o);
        break;
      case 'DELIVERED':
        b.delivered.push(o);
        break;
      case 'PAID':
        b.payments.push(o);
        break;
      case 'REJECTED':
      case 'EXPIRED':
      case 'FAILED':
      case 'CANCELLED':
        b.failed.push(o);
        break;
      default:
        break;
    }
  }
  return b;
}

export default async function handler(req, res) {
  const g = guard(req, res, {
    methods: ['GET', 'POST'],
    routeName: 'revenue-ops',
    rateMax: req.method === 'POST' ? 40 : 80,
  });
  if (!g.ok) return;

  const scoutStatus = readJson(path.join(scoutDir(), 'status.json'), null);
  const jobConfig = readJson(path.join(process.cwd(), 'config', 'job-scout.json'), {});
  const connectors = connectorHealth(scoutStatus, jobConfig.sources || {});

  if (req.method === 'GET') {
    const store = loadStore(opsDir());
    const config = loadConfig();
    res.status(200).json({
      ok: true,
      config: { scanIntervalMs: config.scanIntervalMs },
      connectors,
      scout: scoutStatus,
      opportunities: store.opportunities,
      buckets: buckets(store.opportunities),
      auditTail: (store.audit || []).slice(-20),
    });
    return;
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const action = body.action;
  const id = typeof body.id === 'string' ? body.id : '';
  const actor = g.session?.deviceId ? `device:${g.session.deviceId}` : 'unknown';

  const store = loadStore(opsDir());

  try {
    let result;
    switch (action) {
      case 'queue_approval':
        result = queueForApproval(store, id);
        break;
      case 'approve_proposal':
        approveProposal(store, id, actor, body.proposalVersion);
        result = store.opportunities.find((o) => o.id === id);
        break;
      case 'reject':
        result = rejectOpportunity(store, id, actor, body.reason);
        break;
      case 'submit_proposal':
        result = submitProposal(store, id, actor, { simulate: body.simulate === true });
        break;
      case 'simulate_accept':
        result = simulateClientAccept(store, id, actor);
        break;
      case 'approve_execution':
        result = approveExecution(store, id, actor);
        break;
      case 'execute_contract':
        result = await startContractExecution(store, id, actor, { simulate: true, role: 'operator' });
        break;
      default:
        return res.status(400).json({ ok: false, error: 'unknown_action' });
    }
    saveStore(opsDir(), store);
    res.status(200).json({ ok: true, action, result });
  } catch (e) {
    const code = e.code || 'error';
    res.status(code === 'NOT_FOUND' ? 404 : code === 'VERSION_MISMATCH' ? 409 : 400).json({
      ok: false,
      error: e instanceof Error ? e.message : 'failed',
      code,
    });
  }
}