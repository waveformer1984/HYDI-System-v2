/**
 * API LAYER — GET /api/revenue/first-sale-readiness
 *
 * The deterministic first-sale readiness gate. Evaluates seven areas
 * against live evidence and returns one verdict:
 *
 *   VERIFIED_LIVE_TRANSACTION — real live payment + fulfillment + ledger
 *                               + consistent reconciliation (checked first;
 *                               test-mode records can never produce it)
 *   READY_FOR_OPERATOR_REVIEW — machine checks green, no gating human
 *                               actions open
 *   BLOCKED_HUMAN_ACTION      — machine checks green, human-owned
 *                               boundaries still open (each linked to its
 *                               durable Human Action)
 *   BLOCKED_MACHINE_FAILURE   — a machine-owned prerequisite is failing
 *
 * Read-only. Never enables live mode, never creates state, never counts
 * a test transaction as revenue.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../../lib/auth/requireAuth.js';
import { verifyServiceToken } from '../../../lib/auth/verifyServiceToken.js';
import { assessFirstSaleReadiness } from '../../../lib/revenue/FirstSaleReadiness';

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function authed(req: NextApiRequest, res: NextApiResponse, permission: string) {
  const sb = getSupabase();
  if (sb) return requireAuth(req, res, sb, { permission, routeName: 'first-sale-readiness' });
  const result = verifyServiceToken(req.headers['x-hydi-service-token'] as string | undefined, process.env.HYDI_SERVICE_SECRET as string);
  if (!result.valid) { res.status(401).json({ error: 'Unauthorized', reason: result.reason }); return { ok: false as const }; }
  return { ok: true as const, role: 'owner' };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const auth = await authed(req, res, 'revenue:view');
  if (!auth.ok) return;
  try {
    const offerId = typeof req.query.offerId === 'string' ? req.query.offerId : 'checkpoint_audit';
    const result = await assessFirstSaleReadiness({ offerId });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'readiness assessment failed' });
  }
}
