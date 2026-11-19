'use strict';

const fs = require('fs');
const path = require('path');
const { scoutDir, readDecisions, setDecision } = require('./decisions');
const { draftProposal } = require('./draft');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function readLeads(dir = scoutDir()) {
  const { leads = [] } = readJson(path.join(dir, 'leads.json'), {});
  return Array.isArray(leads) ? leads : [];
}

function fmtBudget(lead) {
  const b = lead && lead.budget;
  if (!b) return null;
  if (b.text) return b.text;
  const cur = b.currency && b.currency !== 'USD' ? `${b.currency} ` : '$';
  if (b.min != null && b.max != null && b.max) {
    return `${cur}${b.min}–${cur}${b.max}${b.type === 'hourly' ? '/hr' : ''}`;
  }
  if (b.min != null || b.max != null) return `${cur}${b.min ?? b.max}${b.type === 'hourly' ? '/hr' : ''}`;
  return null;
}

function whyFit(lead) {
  const bits = [];
  if (lead.division) bits.push(`Division: ${lead.division}`);
  if (lead.matched && lead.matched.length) bits.push(`Skills: ${lead.matched.slice(0, 5).join(', ')}`);
  if (lead.reasons && lead.reasons.length) bits.push(lead.reasons.slice(0, 2).join(' · '));
  return bits.join(' · ') || 'Matched job scout profile.';
}

function pickDigestLeads(leads, decisions, limit = 5) {
  const open = (leads || []).filter((l) => {
    const d = decisions[l.id];
    if (!d) return true;
    return !['dismissed', 'skipped', 'applied'].includes(d.status);
  });
  open.sort((a, b) => (b.score || 0) - (a.score || 0));
  const shortlisted = open.filter((l) => decisions[l.id]?.status === 'shortlisted');
  const pool = shortlisted.length ? shortlisted : open;
  return pool.slice(0, limit).map((l) => ({
    ...l,
    decision: decisions[l.id] || null,
    pay: fmtBudget(l),
    whyFit: whyFit(l),
    proposal: l.draft || draftProposal(l, l.division ? { pitch: l.division } : null),
  }));
}

function findLead(dir, id) {
  return readLeads(dir).find((l) => l.id === id) || null;
}

function updateLeadDraft(dir, id, draft) {
  const file = path.join(dir, 'leads.json');
  const data = readJson(file, { leads: [] });
  const lead = data.leads.find((l) => l.id === id);
  if (!lead) throw Object.assign(new Error('lead_not_found'), { code: 'NOT_FOUND' });
  lead.draft = String(draft);
  writeJsonAtomic(file, data);
  return lead;
}

function prepareApply(dir, id, now = new Date()) {
  const lead = findLead(dir, id);
  if (!lead) throw Object.assign(new Error('lead_not_found'), { code: 'NOT_FOUND' });
  const proposal = lead.draft || draftProposal(lead, lead.division ? { pitch: lead.division } : null);
  setDecision(id, 'drafted', dir, now);
  return {
    id,
    sourceUrl: lead.sourceUrl,
    proposal,
    pay: fmtBudget(lead),
    score: lead.score,
    whyFit: whyFit(lead),
    title: lead.title,
    humanSubmitRequired: true,
    notice: 'Paste the proposal on the job site yourself — Hydi never submits or messages.',
  };
}

function confirmSent(dir, id, now = new Date()) {
  const decisions = readDecisions(dir);
  const cur = decisions[id];
  if (!cur || cur.status !== 'drafted') {
    throw Object.assign(new Error('confirm_requires_drafted'), { code: 'CONFIRM_REQUIRES_DRAFTED' });
  }
  setDecision(id, 'applied', dir, now);
  return { id, status: 'applied', at: decisions[id]?.at || now.toISOString() };
}

module.exports = {
  whyFit,
  fmtBudget,
  pickDigestLeads,
  prepareApply,
  confirmSent,
  updateLeadDraft,
  findLead,
  readLeads,
};