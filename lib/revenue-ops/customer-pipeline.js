'use strict';

/**
 * Local business prospect pipeline (HYDI-REVENUE-001).
 * Separate from freelance opportunity lifecycle — outbound requires owner approval.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STAGES = Object.freeze([
  'DISCOVERED',
  'RESEARCHED',
  'QUALIFIED',
  'CONTACT_APPROVED',
  'CONTACTED',
  'INTERESTED',
  'PROPOSAL_SENT',
  'CUSTOMER_APPROVED',
  'PAID',
  'DELIVERED',
  'VERIFIED',
]);

const TRANSITIONS = Object.freeze({
  DISCOVERED: ['RESEARCHED'],
  RESEARCHED: ['QUALIFIED', 'DISCOVERED'],
  QUALIFIED: ['CONTACT_APPROVED'],
  CONTACT_APPROVED: ['CONTACTED'],
  CONTACTED: ['INTERESTED', 'QUALIFIED'],
  INTERESTED: ['PROPOSAL_SENT'],
  PROPOSAL_SENT: ['CUSTOMER_APPROVED', 'INTERESTED'],
  CUSTOMER_APPROVED: ['PAID'],
  PAID: ['DELIVERED'],
  DELIVERED: ['VERIFIED'],
  VERIFIED: [],
});

function pipelineDir(env = process.env) {
  const root = path.resolve(__dirname, '..', '..');
  return env.REVENUE_PIPELINE_DIR
    ? path.resolve(env.REVENUE_PIPELINE_DIR)
    : path.join(root, '.runtime', 'revenue-pipeline');
}

function loadProspects(dir) {
  const file = path.join(dir, 'prospects.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { updatedAt: null, prospects: [], audit: [] };
  }
}

function saveProspects(dir, data) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'prospects.json');
  const tmp = `${file}.${process.pid}.tmp`;
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function prospectId(businessName, website) {
  return crypto.createHash('sha256').update(`${businessName}|${website || ''}`).digest('hex').slice(0, 16);
}

function assertTransition(from, to) {
  if (!(TRANSITIONS[from] || []).includes(to)) {
    const err = new Error(`invalid_prospect_transition:${from}->${to}`);
    err.code = 'INVALID_TRANSITION';
    throw err;
  }
}

function hasVerifiedEvidence(evidence) {
  return (evidence || []).some(
    (e) =>
      e &&
      e.type === 'VERIFIED' &&
      typeof e.source_url === 'string' &&
      e.source_url.trim() &&
      typeof e.verified_by === 'string' &&
      e.verified_by.trim(),
  );
}

function isContactReady(prospect) {
  return prospect && prospect.status === 'QUALIFIED' && !prospect.synthetic;
}

function addProspect(data, record) {
  const id = record.id || prospectId(record.businessName, record.website);
  const existing = data.prospects.find((p) => p.id === id);
  if (existing) return existing;
  const row = {
    id,
    businessName: record.businessName,
    website: record.website || null,
    contact: record.contact || null,
    problem: record.problem || null,
    evidence: record.evidence || [],
    status: 'DISCOVERED',
    offer: null,
    dealValueUsd: null,
    nextAction: record.nextAction || 'Research public listing and pain point',
    outreachHistory: [],
    contactConsent: { ownerApproved: false, at: null },
    synthetic: Boolean(record.synthetic),
    createdAt: new Date().toISOString(),
  };
  data.prospects.push(row);
  return row;
}

function transitionProspect(data, id, next, meta = {}) {
  const p = data.prospects.find((x) => x.id === id);
  if (!p) throw Object.assign(new Error('not_found'), { code: 'NOT_FOUND' });
  assertTransition(p.status, next);
  if (next === 'QUALIFIED' && !hasVerifiedEvidence(p.evidence)) {
    throw Object.assign(new Error('verified_evidence_required'), { code: 'VERIFIED_EVIDENCE_REQUIRED' });
  }
  if (['CONTACT_APPROVED', 'CONTACTED'].includes(next) && p.synthetic) {
    throw Object.assign(new Error('synthetic_prospect_no_contact'), { code: 'SYNTHETIC_NO_CONTACT' });
  }
  if (['CONTACTED', 'PROPOSAL_SENT'].includes(next) && !p.contactConsent?.ownerApproved) {
    throw Object.assign(new Error('owner_contact_approval_required'), { code: 'APPROVAL_REQUIRED' });
  }
  p.status = next;
  p.audit = p.audit || [];
  p.audit.push({ to: next, ...meta, at: new Date().toISOString() });
  return p;
}

module.exports = {
  STAGES,
  TRANSITIONS,
  pipelineDir,
  loadProspects,
  saveProspects,
  addProspect,
  transitionProspect,
  prospectId,
  assertTransition,
  hasVerifiedEvidence,
  isContactReady,
};