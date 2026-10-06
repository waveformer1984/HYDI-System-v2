/**
 * API LAYER — POST/GET /api/commercial/decisions
 *
 * The governed pricing boundary. Heidi proposes commercial terms via a
 * commercial-review Human Action; this endpoint is where a human records
 * the decision. A recorded 'approved' decision is the ONLY path by which a
 * portfolio offer materializes into the OfferCatalog overlay — the
 * realization revenue stage materializes it on its next pass, and
 * `offer-exists` is the durable proof.
 *
 *   POST { offerId, decision: 'approved'|'rejected', priceCents?, notes? }
 *     → appends the decision (append-only history)
 *   GET ?offerId=<id>
 *     → returns the recorded decision(s) for inspection
 *
 * No decision here creates a checkout, charges anyone, or runs fulfillment
 * — it only records commercial authority. Same auth as app-realization.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../../lib/auth/requireAuth.js';
import { verifyServiceToken } from '../../../lib/auth/verifyServiceToken.js';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { recordDecision, getDecision, readStore } = require('../../../lib/commercial/decision-store.js');

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function authed(req: NextApiRequest, res: NextApiResponse, permission: string) {
  const sb = getSupabase();
  if (sb) return requireAuth(req, res, sb, { permission, routeName: 'commercial-decisions' });
  const result = verifyServiceToken(req.headers['x-hydi-service-token'] as string | undefined, process.env.HYDI_SERVICE_SECRET as string);
  if (!result.valid) { res.status(401).json({ error: 'Unauthorized', reason: result.reason }); return { ok: false as const }; }
  return { ok: true as const, role: 'owner' };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const auth = await authed(req, res, 'actions:view');
    if (!auth.ok) return;
    const offerId = (req.query.offerId as string) || null;
    res.setHeader('Cache-Control', 'no-store');
    if (offerId) return res.status(200).json({ offerId, decision: getDecision(offerId) });
    return res.status(200).json(readStore());
  }

  if (req.method === 'POST') {
    const auth = await authed(req, res, 'actions:approve');
    if (!auth.ok) return;
    const body = (req.body || {}) as {
      offerId?: string; decision?: string; approvedBy?: string;
      priceCents?: number; notes?: string;
    };
    if (!body.offerId || typeof body.offerId !== 'string') {
      return res.status(400).json({ ok: false, error: "missing 'offerId'" });
    }
    if (body.decision !== 'approved' && body.decision !== 'rejected') {
      return res.status(400).json({ ok: false, error: "decision must be 'approved' or 'rejected'" });
    }
    if (body.priceCents !== undefined && (!Number.isInteger(body.priceCents) || body.priceCents <= 0)) {
      return res.status(400).json({ ok: false, error: 'priceCents must be a positive integer (cents)' });
    }
    try {
      const entry = recordDecision({
        offerId: body.offerId,
        decision: body.decision,
        approvedBy: body.approvedBy || 'operator',
        priceCents: body.priceCents ?? null,
        notes: body.notes ?? null,
      });
      return res.status(200).json({ ok: true, decision: entry });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'record failed' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
