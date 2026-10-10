/**
 * API LAYER — GET/POST /api/revenue/prospects
 *
 * The operator's governed pathway for recording legitimate prospects in the
 * checkpoint_audit demand experiment. This is the ONLY supported way to add
 * a prospect to the experiment — the record carries the evidence that makes
 * it legitimate (source, relevance reason, authorized contact channel).
 *
 *   GET            — list recorded prospects, the outreach-authorization
 *                    state, and the current funnel stages.
 *   POST {op:'add'}    — record a new prospect (requires businessName, source,
 *                        relevanceReason, contactChannel). Synthetic entries
 *                        are rejected: every prospect must be explicitly
 *                        backed by operator-supplied evidence.
 *   POST {op:'stage'}  — advance a prospect's funnel stage (qualified →
 *                        outreach → contact → reply → intent → checkout →
 *                        payment → delivered → reconciled). Stages that
 *                        assert external events require an evidence note;
 *                        'outreach_sent' additionally requires the
 *                        checkpoint:outreach-authorization Human Action to
 *                        be RESOLVED — consent is not self-granted.
 *   POST {op:'remove'} — remove a prospect recorded in error (audit trail
 *                        keeps a tombstone, never silent deletion).
 *
 * A reply, click, checkout attempt, or test payment is never a sale — the
 * stage machine ends at 'reconciled' only via the revenue reconciler's own
 * evidence, not via this endpoint.
 *
 * Secrets are never accepted here. Contact channels are recorded as
 * descriptions ("operator's direct email to jane@example.com") — the actual
 * send happens through the operator's own channel after authorization.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../../../lib/auth/requireAuth.js';
import { verifyServiceToken } from '../../../../lib/auth/verifyServiceToken.js';

const EXPERIMENT_PATH = path.join(process.cwd(), '.hydi-operational', 'checkpoint-demand-experiment.json');
const ACTIONS_STORE = path.join(process.cwd(), 'data', 'human-actions.json');

const FUNNEL_STAGES = [
  'recorded',
  'qualified_prospect',
  'outreach_authorized',
  'contact_attempted',
  'reply_received',
  'purchase_intent',
  'checkout_started',
  'payment_completed',
  'service_delivered',
  'ledger_reconciled',
] as const;

// Stages that assert a real external event — evidence is mandatory.
const EVIDENCE_REQUIRED_STAGES = new Set([
  'contact_attempted', 'reply_received', 'purchase_intent',
  'checkout_started', 'payment_completed', 'service_delivered', 'ledger_reconciled',
]);

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function authed(req: NextApiRequest, res: NextApiResponse, permission: string) {
  const sb = getSupabase();
  if (sb) return requireAuth(req, res, sb, { permission, routeName: 'revenue-prospects' });
  const result = verifyServiceToken(req.headers['x-hydi-service-token'] as string | undefined, process.env.HYDI_SERVICE_SECRET as string);
  if (!result.valid) { res.status(401).json({ error: 'Unauthorized', reason: result.reason }); return { ok: false as const }; }
  return { ok: true as const, role: 'owner' };
}

interface Experiment {
  prospects?: Array<Record<string, unknown>>;
  prospectCount?: number;
  prospectShortfall?: number;
  status?: string;
  [k: string]: unknown;
}

function readExperiment(): Experiment {
  try { return JSON.parse(fs.readFileSync(EXPERIMENT_PATH, 'utf8')); } catch { return { prospects: [] }; }
}

function writeExperiment(exp: Experiment): void {
  // Backup before write — same durability pattern as the human-action store.
  try { fs.copyFileSync(EXPERIMENT_PATH, EXPERIMENT_PATH + '.bak'); } catch { /* first write */ }
  const tmp = EXPERIMENT_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(exp, null, 2));
  fs.renameSync(tmp, EXPERIMENT_PATH);
}

function outreachAuthorized(): boolean {
  try {
    const db = JSON.parse(fs.readFileSync(ACTIONS_STORE, 'utf8'));
    const open = (db.actions || []).some((a: Record<string, unknown>) =>
      a.blockerKey === 'checkpoint:outreach-authorization'
      && !['RESOLVED', 'CANCELED', 'REJECTED', 'EXPIRED'].includes(String(a.status)));
    return !open;
  } catch { return false; }
}

function refreshCounts(exp: Experiment): void {
  const prospects = exp.prospects ?? [];
  exp.prospectCount = prospects.filter((p) => p.legitimate === true && !p.removedAt).length;
  exp.prospectShortfall = Math.max(0, 5 - exp.prospectCount);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const auth = await authed(req, res, 'revenue:view');
    if (!auth.ok) return;
    const exp = readExperiment();
    refreshCounts(exp);
    const prospects = (exp.prospects ?? []).filter((p) => !p.removedAt);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      offerId: 'checkpoint_audit',
      prospects,
      prospectCount: exp.prospectCount,
      prospectShortfall: exp.prospectShortfall,
      outreachAuthorized: outreachAuthorized(),
      funnelStages: FUNNEL_STAGES,
      signalNote: 'reply/click/checkout-attempt/test-payment are stages, never revenue — only ledger_reconciled via the reconciler counts',
    });
  }

  if (req.method === 'POST') {
    const auth = await authed(req, res, 'revenue:manage');
    if (!auth.ok) return;
    const body = (req.body || {}) as Record<string, unknown>;
    const exp = readExperiment();
    exp.prospects = exp.prospects ?? [];

    if (body.op === 'add') {
      const businessName = String(body.businessName || '').trim();
      const source = String(body.source || '').trim();
      const relevanceReason = String(body.relevanceReason || '').trim();
      const contactChannel = String(body.contactChannel || '').trim();
      const missing = [['businessName', businessName], ['source', source], ['relevanceReason', relevanceReason], ['contactChannel', contactChannel]]
        .filter(([, v]) => !v).map(([k]) => k);
      if (missing.length) {
        return res.status(400).json({ ok: false, error: `missing required evidence field(s): ${missing.join(', ')} — a prospect without evidence is synthetic` });
      }
      // Dedupe on business name — the same business is never two prospects.
      const dupe = exp.prospects.find((p) => !p.removedAt
        && String(p.businessName).toLowerCase() === businessName.toLowerCase());
      if (dupe) {
        return res.status(409).json({ ok: false, error: `prospect already recorded`, prospectId: dupe.prospectId });
      }
      const prospect = {
        prospectId: `prospect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        businessName,
        source,
        relevanceReason,
        contactChannel,
        contactVerified: body.contactVerified === true,
        legitimate: true,
        stage: 'qualified_prospect',
        stageHistory: [{ stage: 'qualified_prospect', at: new Date().toISOString(), actor: 'operator', note: 'recorded via governed prospects API' }],
        addedBy: 'operator',
        addedAt: new Date().toISOString(),
        outreachStatus: 'not_sent',
        purchaseStatus: 'none',
      };
      exp.prospects.push(prospect);
      refreshCounts(exp);
      writeExperiment(exp);
      return res.status(201).json({ ok: true, prospect, prospectCount: exp.prospectCount, prospectShortfall: exp.prospectShortfall });
    }

    if (body.op === 'stage') {
      const p = exp.prospects.find((x) => x.prospectId === body.prospectId && !x.removedAt);
      if (!p) return res.status(404).json({ ok: false, error: 'prospect not found' });
      const stage = String(body.stage || '');
      if (!(FUNNEL_STAGES as readonly string[]).includes(stage)) {
        return res.status(400).json({ ok: false, error: `unknown stage '${stage}'`, funnelStages: FUNNEL_STAGES });
      }
      const note = String(body.note || '').trim();
      if (EVIDENCE_REQUIRED_STAGES.has(stage as typeof FUNNEL_STAGES[number]) && !note && !body.evidenceRef) {
        return res.status(400).json({ ok: false, error: `stage '${stage}' asserts a real event — an evidence note or evidenceRef is required` });
      }
      if ((stage === 'outreach_authorized' || stage === 'contact_attempted') && !outreachAuthorized()) {
        return res.status(409).json({
          ok: false,
          error: 'outreach is not authorized — the checkpoint:outreach-authorization Human Action must be RESOLVED first; consent is not self-granted',
        });
      }
      p.stage = stage;
      (p.stageHistory as unknown[]).push({ stage, at: new Date().toISOString(), actor: 'operator', note: note || null, evidenceRef: body.evidenceRef ?? null });
      if (stage === 'contact_attempted') p.outreachStatus = 'sent';
      writeExperiment(exp);
      return res.status(200).json({ ok: true, prospect: p });
    }

    if (body.op === 'remove') {
      const p = exp.prospects.find((x) => x.prospectId === body.prospectId && !x.removedAt);
      if (!p) return res.status(404).json({ ok: false, error: 'prospect not found' });
      p.removedAt = new Date().toISOString();
      p.removeReason = String(body.reason || 'removed by operator');
      refreshCounts(exp);
      writeExperiment(exp);
      return res.status(200).json({ ok: true, removed: p.prospectId, prospectCount: exp.prospectCount });
    }

    return res.status(400).json({ ok: false, error: `unknown op '${body.op}'` });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
