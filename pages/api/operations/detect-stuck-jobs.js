// Stuck Job Detection
// POST /api/operations/detect-stuck-jobs
//
// Runs one cycle of the StuckJobDetector. This endpoint is used by:
//   - The recurring scheduler (scripts/stuck-job-scheduler.js)
//   - Manual triggering for testing
//   - External cron/scheduled task systems
//
// Auth: requires service token with 'operations:manage' permission.
//
// This endpoint does NOT:
//   - touch money or Stripe
//   - bypass the human-approval delivery gate
//   - auto-deliver any artifact
//   - force-fail any job
//
// The bounded recovery actions are:
//   - For stuck `executing` jobs: retry execution ONCE (executing → queued)
//   - For stale `awaiting_review` jobs: send escalation notification
//
// Any action beyond the bounded default requires the existing one-click
// Authorize pattern.

import { StuckJobDetector } from '../../../lib/operational/StuckJobDetector';
import { requireAuth } from '../../../lib/auth/requireAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res, supabase, {
    permission: 'revenue:manage',
    routeName: 'detect-stuck-jobs',
  });
  if (!auth.ok) return;

  const observeOnly = req.body?.observeOnly === true;
  const executingHours = parseFloat(req.body?.executingHours || process.env.STUCK_JOB_EXECUTING_HOURS || '4');
  const reviewHours = parseFloat(req.body?.reviewHours || process.env.STUCK_JOB_REVIEW_HOURS || '48');

  const detector = new StuckJobDetector(supabase, {
    executingThresholdHours: executingHours,
    awaitingReviewThresholdHours: reviewHours,
    enableRetry: !observeOnly,
    enableEscalation: !observeOnly,
  });

  try {
    const result = await detector.detectAndRecover();

    if (result.error) {
      return res.status(500).json({
        success: false,
        error: result.error,
        result,
      });
    }

    return res.status(200).json({
      success: true,
      result,
      message: `Detection cycle complete. Checked ${result.checkedJobs} jobs, found ${result.stuckJobsFound} stuck, retried ${result.retriesAttempted}, escalated ${result.escalationsSent}.`,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ success: false, error: msg });
  }
}
