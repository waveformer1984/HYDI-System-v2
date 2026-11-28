'use strict';

/**
 * Heidi Mobile — outreach drafts (read) and decisions (write audit only, no sending).
 */

const fs = require('fs');
const path = require('path');

const { guard } = require('../../../lib/heidi-mobile/guard.js');
const { getStore } = require('../../../lib/store');

const DRAFTS_PATH = path.join(process.cwd(), 'config', 'heidi-outreach-drafts.json');
const DECISION_LIMIT = 200;

function loadDraftsFile() {
  try {
    const raw = fs.readFileSync(DRAFTS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const drafts = Array.isArray(parsed.drafts) ? parsed.drafts : Array.isArray(parsed) ? parsed : [];
    return drafts;
  } catch (e) {
    return [];
  }
}

function lastDecisionByDraft(events) {
  const map = {};
  for (const row of events) {
    const p = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const draftId = p.draft_id;
    if (!draftId || map[draftId]) continue;
    map[draftId] = {
      draft_id: draftId,
      builder: p.builder ?? null,
      decision: p.decision,
      edited_body: p.edited_body ?? null,
      ts: p.ts || row.created_at,
    };
  }
  return map;
}

async function fetchRecentDecisions(store) {
  const { data, error } = await store
    .from('heidi_events')
    .select('id, created_at, payload')
    .eq('event_type', 'outreach_decision')
    .order('created_at', { ascending: false })
    .limit(DECISION_LIMIT);
  if (error) throw new Error(error.message);
  return lastDecisionByDraft(data || []);
}

async function handleGet(res) {
  const drafts = loadDraftsFile();
  const store = getStore();
  let decisions = {};
  if (store.isAvailable()) {
    try {
      decisions = await fetchRecentDecisions(store);
    } catch {
      decisions = {};
    }
  }
  return res.status(200).json({ drafts, decisions });
}

async function handlePost(req, res, session) {
  const { draft_id: draftId, builder, decision, edited_body: editedBody } = req.body || {};
  const allowed = new Set(['approve', 'reject', 'edit']);
  if (!draftId || typeof draftId !== 'string') {
    return res.status(400).json({ error: 'invalid_draft', message: 'draft_id is required' });
  }
  if (!allowed.has(decision)) {
    return res.status(400).json({ error: 'invalid_decision', message: 'decision must be approve, reject, or edit' });
  }

  const store = getStore();
  if (!store.isAvailable()) {
    return res.status(503).json({ error: 'store_unavailable', message: 'Cannot record decision without store' });
  }

  const ts = new Date().toISOString();
  const payload = {
    draft_id: draftId,
    builder: builder ?? null,
    decision,
    ts,
    device_id: session?.deviceId ?? null,
  };
  if (decision === 'edit' && typeof editedBody === 'string' && editedBody.trim()) {
    payload.edited_body = editedBody.trim().slice(0, 8000);
  }

  const { error } = await store.from('heidi_events').insert({
    event_type: 'outreach_decision',
    division: 'commercial',
    payload,
  });
  if (error) {
    return res.status(502).json({ error: 'write_failed', message: error.message });
  }

  return res.status(201).json({ ok: true, recorded: payload });
}

module.exports = async function handler(req, res) {
  const g = guard(req, res, {
    methods: ['GET', 'POST'],
    routeName: `outreach-${req.method}`,
    rateMax: req.method === 'GET' ? 30 : 15,
  });
  if (!g.ok) return;

  if (req.method === 'GET') return handleGet(res);
  return handlePost(req, res, g.session);
};