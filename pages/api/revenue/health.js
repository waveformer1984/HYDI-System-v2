// Revenue Transaction Health Summary
// GET /api/revenue/health
//
// Returns a summary of all revenue transactions and their reconciliation
// states. This makes revenue transactions observable by HYDI's existing
// operational intelligence (watchdog, health monitoring).
//
// A transaction in BLOCKED state is intentional (awaiting human approval).
// A transaction in MISMATCH state requires investigation.
// A transaction in INCOMPLETE state is in progress.
// A transaction in CONSISTENT state is complete and verified.
//
// Auth: requires revenue:view permission.

import { RevenueReconciler } from '../../../lib/revenue/RevenueReconciler';
import { requireAuth } from '../../../lib/auth/requireAuth';
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
    routeName: 'revenue-health',
  });
  if (!auth.ok) return;

  try {
    // Get all jobs that have been paid (payment_status = 'paid')
    const { data: jobs, error } = await supabase
      .from('customer_jobs')
      .select('job_id, job_status, payment_status, delivery_status, created_at')
      .neq('payment_status', 'unpaid')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const reconciler = new RevenueReconciler();
    const summaries = [];

    // Reconcile each job (limit to avoid timeout)
    for (const job of (jobs || []).slice(0, 20)) {
      try {
        const result = await reconciler.reconcile(job.job_id);
        summaries.push({
          jobId: result.correlation.jobId,
          state: result.state,
          violations: result.violations.length,
          checkoutSessionId: result.correlation.checkoutSessionId,
          deliveryToken: result.correlation.deliveryToken ? 'present' : null,
          ledgerEntryId: result.correlation.ledgerEntryId ? 'present' : null,
        });
      } catch (e) {
        summaries.push({
          jobId: job.job_id,
          state: 'MISMATCH',
          violations: 1,
          error: e instanceof Error ? e.message : 'Unknown error',
        });
      }
    }

    // Aggregate
    const counts = summaries.reduce((acc, s) => {
      acc[s.state] = (acc[s.state] || 0) + 1;
      return acc;
    }, {});

    return res.status(200).json({
      timestamp: new Date().toISOString(),
      totalJobs: jobs?.length || 0,
      reconciled: summaries.length,
      states: {
        CONSISTENT: counts.CONSISTENT || 0,
        INCOMPLETE: counts.INCOMPLETE || 0,
        BLOCKED: counts.BLOCKED || 0,
        MISMATCH: counts.MISMATCH || 0,
      },
      transactions: summaries,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: msg });
  }
}
