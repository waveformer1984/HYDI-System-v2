'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { assertTransition } = require('./lifecycle');
const { assessOpportunity } = require('./scoring');
const { buildProposal } = require('./proposal');

const ROOT = path.resolve(__dirname, '..', '..');

function opsDir(env = process.env) {
  return env.REVENUE_OPS_DIR ? path.resolve(env.REVENUE_OPS_DIR) : path.join(ROOT, '.runtime', 'revenue-ops');
}

function configPath(env = process.env) {
  return env.REVENUE_OPS_CONFIG ? path.resolve(env.REVENUE_OPS_CONFIG) : path.join(ROOT, 'config', 'revenue-ops.json');
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function loadConfig(env) {
  return readJson(configPath(env), {});
}

function loadStore(dir) {
  return readJson(path.join(dir, 'opportunities.json'), { updatedAt: null, opportunities: [], audit: [] });
}

function saveStore(dir, store) {
  store.updatedAt = new Date().toISOString();
  writeJsonAtomic(path.join(dir, 'opportunities.json'), store);
}

function audit(store, entry) {
  store.audit = store.audit || [];
  store.audit.push({ ...entry, at: new Date().toISOString() });
  if (store.audit.length > 500) store.audit = store.audit.slice(-500);
}

function opportunityId(leadId) {
  return crypto.createHash('sha256').update(String(leadId)).digest('hex').slice(0, 16);
}

function upsertFromLead(store, lead, config, nowIso) {
  const id = opportunityId(lead.id);
  const prev = store.opportunities.find((o) => o.id === id);
  const assessment = assessOpportunity(lead, config);
  const listingAvailable = Boolean(lead.sourceUrl && lead.title);

  let opp = prev || {
    id,
    leadId: lead.id,
    state: 'DISCOVERED',
    createdAt: nowIso,
    auditTrail: [],
  };

  opp.marketplace = lead.source;
  opp.sourceUrl = lead.sourceUrl;
  opp.title = lead.title;
  opp.description = lead.description;
  opp.company = lead.company;
  opp.budget = lead.budget;
  opp.skills = lead.skills;
  opp.postedAt = lead.postedAt;
  opp.scoutScore = lead.score;
  opp.lastVerifiedAt = nowIso;
  opp.listingAvailable = listingAvailable;
  opp.assessment = assessment;

  if (opp.state === 'DISCOVERED') opp.state = 'VALIDATING';
  if (opp.state === 'VALIDATING') opp.state = 'SCORED';
  if (assessment.qualified && ['SCORED', 'QUALIFIED'].includes(opp.state)) opp.state = 'QUALIFIED';
  if (assessment.qualified && lead.draft && opp.state === 'QUALIFIED') {
    const proposal = buildProposal(opp, lead);
    opp.proposal = proposal;
    opp.state = 'PROPOSAL_READY';
  }
  if (assessment.rejectReason && !['REJECTED', 'SUBMITTED', 'ACCEPTED', 'EXECUTING', 'DELIVERED', 'PAID'].includes(opp.state)) {
    opp.state = 'REJECTED';
    opp.rejectReason = assessment.rejectReason;
  }

  if (!prev) store.opportunities.push(opp);
  return opp;
}

function syncFromScoutLeads(leads, opts = {}) {
  const env = opts.env || process.env;
  const dir = opsDir(env);
  const config = loadConfig(env);
  const store = loadStore(dir);
  const nowIso = new Date(opts.now || Date.now()).toISOString();
  let updated = 0;
  for (const lead of leads || []) {
    upsertFromLead(store, lead, config, nowIso);
    updated++;
  }
  audit(store, { action: 'sync_from_scout', count: updated });
  saveStore(dir, store);
  return { updated, count: store.opportunities.length };
}

function getOpportunity(store, id) {
  return store.opportunities.find((o) => o.id === id) || null;
}

function transition(store, id, nextState, meta = {}) {
  const opp = getOpportunity(store, id);
  if (!opp) {
    const err = new Error('not_found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  assertTransition(opp.state, nextState);
  const from = opp.state;
  opp.state = nextState;
  opp.stateChangedAt = new Date().toISOString();
  audit(store, { action: 'transition', id, from, to: nextState, ...meta });
  return opp;
}

module.exports = {
  opsDir,
  configPath,
  loadConfig,
  loadStore,
  saveStore,
  audit,
  syncFromScoutLeads,
  getOpportunity,
  transition,
  opportunityId,
};