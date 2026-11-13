'use strict';

/**
 * Heidi Mobile — job scout leads (read-only toward every job site).
 *
 * GET  → ranked leads + last scan status + Jordan's decisions, read from
 *        .runtime/job-scout/{leads,status,decisions}.json on this host.
 * POST → { id, status: shortlisted|dismissed|applied|clear } writes
 *        decisions.json via lib/job-scout/decisions.js — the same format
 *        Ursula → Freelance uses. There is deliberately no 'apply' action:
 *        Heidi never applies, bids, messages or logs in anywhere.
 *
 * Guard: the shared heidi-mobile guard (session + CSRF + rate limit), same
 * as every other route in this directory.
 */

const fs = require('fs');
const path = require('path');
const { guard } = require('../../../lib/heidi-mobile/guard.js');
const { DECISIONS, isValidLeadId, scoutDir, readDecisions, setDecision, withDecisions } = require('../../../lib/job-scout/decisions.js');

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
      res.status(200).json({
        ok: true,
        status: readStatus(dir),
        decisions,
        leads: withDecisions(readLeads(dir), decisions),
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'job scout unreadable' });
    }
    return;
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const id = typeof body.id === 'string' ? body.id : '';
  const status = body.status;
  if (!isValidLeadId(id)) return res.status(400).json({ ok: false, error: 'invalid_lead_id' });
  if (typeof status !== 'string' || (status !== 'clear' && !DECISIONS.includes(status))) {
    return res.status(400).json({ ok: false, error: `status must be one of ${DECISIONS.join(', ')} or clear` });
  }

  try {
    const decision = setDecision(id, status, dir);
    res.status(200).json({ ok: true, id, decision });
  } catch (e) {
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'write failed' });
  }
}
