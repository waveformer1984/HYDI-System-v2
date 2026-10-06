/**
 * API LAYER — GET/POST /api/revenue/payment-signals
 *
 * The durable surface for external payment claims and their governed
 * resolution.
 *
 *   GET  ?status=open|resolved            → list signals + verdicts
 *   GET  ?all=1                           → include resolved
 *   POST { amountCents, currency, providerObjectId?, eventId?, mode?,
 *          observedAt?, source? }         → record + classify a signal
 *   POST { signalId, disposition, actor?,
 *          providerObjectId?, customerReference?, note? }
 *        → governed human disposition: external_not_found |
 *          external_confirmed | belongs_to_other
 *   POST { signalId, recheck: true }      → re-run internal checks
 *
 * Nothing here creates revenue, jobs, or offers. Recording a signal only
 * produces evidence; a disposition only closes a verification loop.
 * Revenue still enters exclusively via verified webhook → ledger.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../../lib/auth/requireAuth.js';
import { verifyServiceToken } from '../../../lib/auth/verifyServiceToken.js';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const bridge = require('../../../lib/revenue/payment-signal-bridge.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { HumanActionService } = require('../../../lib/human-actions/service.js');

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function authed(req: NextApiRequest, res: NextApiResponse, permission: string) {
  const sb = getSupabase();
  if (sb) return requireAuth(req, res, sb, { permission, routeName: 'payment-signals' });
  const result = verifyServiceToken(req.headers['x-hydi-service-token'] as string | undefined, process.env.HYDI_SERVICE_SECRET as string);
  if (!result.valid) { res.status(401).json({ error: 'Unauthorized', reason: result.reason }); return { ok: false as const }; }
  return { ok: true as const, role: 'owner' };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const auth = await authed(req, res, 'actions:view');
    if (!auth.ok) return;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const includeTerminal = req.query.all === '1';
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ signals: bridge.listSignals({ status, includeTerminal }) });
  }

  if (req.method === 'POST') {
    const auth = await authed(req, res, 'actions:approve');
    if (!auth.ok) return;
    const body = (req.body || {}) as Record<string, unknown>;
    const actor = (auth as { role?: string }).role || (body.actor as string) || 'operator';

    try {
      // Governed disposition path
      if (body.signalId && body.disposition) {
        const result = await bridge.recordDisposition(String(body.signalId), {
          disposition: body.disposition,
          providerObjectId: body.providerObjectId,
          customerReference: body.customerReference,
          note: body.note,
          actor,
        }, { service: new HumanActionService({}) });
        return res.status(200).json({ ok: true, ...result });
      }
      // Manual re-check path
      if (body.signalId && body.recheck) {
        const result = await bridge.reconcileSignal(String(body.signalId));
        return res.status(200).json({ ok: true, ...result });
      }
      // Signal observation path
      const result = await bridge.recordSignal({
        amountCents: Number(body.amountCents),
        currency: body.currency,
        providerObjectId: body.providerObjectId,
        eventId: body.eventId,
        mode: body.mode,
        observedAt: body.observedAt,
        source: body.source || 'api',
        providerAccount: body.providerAccount,
        reference: body.reference,
      }, { service: new HumanActionService({}) });
      return res.status(result.created ? 201 : 200).json({ ok: true, ...result });
    } catch (e) {
      return res.status(400).json({ ok: false, error: e instanceof Error ? e.message : 'invalid request' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
