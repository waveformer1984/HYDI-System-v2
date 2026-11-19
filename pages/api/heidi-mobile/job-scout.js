'use strict';

/**
 * Heidi Mobile — job scout leads (read-only toward every job site).
 *
 * GET  → leads + digest (top picks) + status + decisions
 * POST → decisions, prepare_apply (clipboard payload), confirm_sent, save_draft
 *        Hydi never applies, bids, messages or logs in anywhere.
 */

const fs = require('fs');
const path = require('path');
const { guard } = require('../../../lib/heidi-mobile/guard.js');
const {
  DECISIONS,
  isValidLeadId,
  scoutDir,
  readDecisions,
  setDecision,
  withDecisions,
} = require('../../../lib/job-scout/decisions.js');
const {
  pickDigestLeads,
  prepareApply,
  confirmSent,
  updateLeadDraft,
} = require('../../../lib/job-scout/apply-flow.js');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function readLeads(dir) {
  const { leads = [] } = readJson(path.join(dir, 'leads.json'), {});
  return Array.isArray(leads) ? leads : [];
}

function readStatus(dir) {
  return readJson(path.join(dir, 'status.json'), null);
}

export default async function handler(req, res) {
  const g = guard(req, res, {
    methods: ['GET', 'POST'],
    routeName: 'job-scout',
    rateMax: req.method === 'POST' ? 30 : 60,
  });
  if (!g.ok) return;

  const dir = scoutDir();

  if (req.method === 'GET') {
    try {
      const decisions = readDecisions(dir);
      const leads = withDecisions(readLeads(dir), decisions);
      const digest = req.query && req.query.digest === '1'
        ? pickDigestLeads(leads, decisions, 5)
        : undefined;
      res.status(200).json({
        ok: true,
        status: readStatus(dir),
        decisions,
        leads,
        digest,
        policy: 'human_submit_required',
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'job scout unreadable' });
    }
    return;
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const id = typeof body.id === 'string' ? body.id : '';
  const action = typeof body.action === 'string' ? body.action : '';

  if (action) {
    if (!isValidLeadId(id)) return res.status(400).json({ ok: false, error: 'invalid_lead_id' });
    try {
      if (action === 'prepare_apply') {
        const payload = prepareApply(dir, id);
        return res.status(200).json({ ok: true, ...payload });
      }
      if (action === 'confirm_sent') {
        const decision = confirmSent(dir, id);
        return res.status(200).json({ ok: true, decision, notice: 'Marked applied after you submitted on the site.' });
      }
      if (action === 'save_draft') {
        if (typeof body.draft !== 'string') return res.status(400).json({ ok: false, error: 'draft_required' });
        updateLeadDraft(dir, id, body.draft);
        return res.status(200).json({ ok: true, id });
      }
      return res.status(400).json({ ok: false, error: 'unknown_action' });
    } catch (e) {
      const code = e && e.code;
      if (code === 'NOT_FOUND') return res.status(404).json({ ok: false, error: 'lead_not_found' });
      if (code === 'CONFIRM_REQUIRES_DRAFTED') {
        return res.status(409).json({ ok: false, error: 'confirm_requires_drafted' });
      }
      return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'failed' });
    }
  }

  const status = body.status;
  if (!isValidLeadId(id)) return res.status(400).json({ ok: false, error: 'invalid_lead_id' });
  if (typeof status !== 'string' || (status !== 'clear' && !DECISIONS.includes(status))) {
    return res.status(400).json({ ok: false, error: `status must be one of ${DECISIONS.join(', ')} or clear` });
  }
  if (status === 'applied') {
    const cur = readDecisions(dir)[id];
    if (!cur || cur.status !== 'drafted') {
      return res.status(409).json({
        ok: false,
        error: 'use_confirm_sent_after_prepare_apply',
        hint: 'POST { action: "confirm_sent" } after you paste and Submit on the job site.',
      });
    }
  }

  try {
    const decision = setDecision(id, status, dir);
    res.status(200).json({ ok: true, id, decision });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'write failed' });
  }
}