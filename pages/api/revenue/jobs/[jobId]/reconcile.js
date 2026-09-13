// Revenue Transaction Reconciliation
// GET /api/revenue/jobs/:jobId/reconcile
//
// Returns a deterministic reconciliation result that answers:
// "For this job, did the payment, webhook, job state, artifact,
// approval, delivery, and ledger all agree?"
//
// States: CONSISTENT | INCOMPLETE | MISMATCH | BLOCKED
//
// This is the operator's verification tool after a transaction.

import { RevenueReconciler } from '../../../../../lib/revenue/RevenueReconciler';
import { requireAuth } from '../../../../../lib/auth/requireAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res, supabase, {
    permission: 'revenue:view',
    routeName: 'revenue-reconcile',
  });
  if (!auth.ok) return;

  try {
    const { jobId } = req.query;
    if (!jobId) return res.status(400).json({ error: 'jobId is required' });

    const reconciler = new RevenueReconciler();
    const result = await reconciler.reconcile(jobId);

    return res.status(200).json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: msg });
  }
}
