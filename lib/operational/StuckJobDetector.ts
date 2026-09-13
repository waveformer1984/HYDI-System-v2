/**
 * HYDI Stuck Job Detector
 *
 * The first real autonomous operations goal. This is NOT a general
 * "manage the business" mandate — it's exactly one bounded goal:
 * detect jobs stuck in `executing` or `awaiting_review` beyond a
 * reasonable threshold, and take bounded, safe recovery action.
 *
 * Thresholds (concrete, based on how long the model-prep pipeline
 * actually takes):
 *   - executing: 4 hours  (a model-prep job should complete in under 4h)
 *   - awaiting_review: 48 hours  (a human should review within 2 days)
 *
 * Recovery actions (bounded, safe by default):
 *   - For a stuck `executing` job: retry execution ONCE by transitioning
 *     it back to `queued` so the job processor picks it up again.
 *     This is safe because:
 *       - It doesn't touch money (no Stripe calls)
 *       - It doesn't bypass the human-approval gate (awaiting_review → delivered
 *         still requires explicit human approval)
 *       - It's bounded to ONE retry per detection cycle (no infinite loop)
 *       - It records a job event so the retry is auditable
 *   - For a stale `awaiting_review` job: send an escalation notification
 *     (reminder) to the operator. This is safe because:
 *       - It doesn't deliver the artifact (that still requires human approval)
 *       - It doesn't modify the job state
 *       - It just notifies a human that review is overdue
 *
 * Any action beyond the bounded default (e.g., force-fail a job,
 * auto-deliver, refund) requires the existing one-click Authorize
 * pattern — don't build a second, looser autonomy path for operations
 * just because the stakes feel lower than a live Stripe transaction.
 *
 * This detector is designed to be called on a recurring schedule
 * (hourly by default) by the StuckJobScheduler.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getEscalationNotifier } from './EscalationNotifier';

// ─── Types ───────────────────────────────────────────────────────────────

export interface StuckJobConfig {
  /** Hours before an `executing` job is considered stuck */
  executingThresholdHours: number;
  /** Hours before an `awaiting_review` job is considered stale */
  awaitingReviewThresholdHours: number;
  /** Whether to actually retry stuck executing jobs (false = observe only) */
  enableRetry: boolean;
  /** Whether to actually send escalation notifications (false = observe only) */
  enableEscalation: boolean;
}

export const DEFAULT_STUCK_JOB_CONFIG: StuckJobConfig = {
  executingThresholdHours: 4,
  awaitingReviewThresholdHours: 48,
  enableRetry: true,
  enableEscalation: true,
};

export interface StuckJobFinding {
  jobId: string;
  jobStatus: string;
  customerEmail: string;
  product: string;
  stuckSince: string;
  stuckDurationHours: number;
  retryCount: number;
  recommendedAction: 'retry_execution' | 'escalate_review' | 'no_action';
  actionTaken: string | null;
  actionResult: 'success' | 'failed' | 'skipped' | 'not_attempted';
  error?: string;
}

export interface StuckJobDetectionResult {
  timestamp: string;
  checkedJobs: number;
  stuckJobsFound: number;
  retriesAttempted: number;
  escalationsSent: number;
  findings: StuckJobFinding[];
  error?: string;
}

// ─── Stuck Job Detector ──────────────────────────────────────────────────

export class StuckJobDetector {
  private supabase: SupabaseClient;
  private config: StuckJobConfig;

  constructor(supabase: SupabaseClient, config?: Partial<StuckJobConfig>) {
    this.supabase = supabase;
    this.config = { ...DEFAULT_STUCK_JOB_CONFIG, ...config };
  }

  /**
   * Run one detection cycle.
   *
   * 1. Query customer_jobs for jobs past the threshold
   * 2. For each stuck job, take the bounded recovery action
   * 3. Return a structured result for logging/auditing
   *
   * This method is idempotent — running it twice in a row is safe.
   * The retry check uses retry_count to avoid retrying more than once.
   */
  async detectAndRecover(): Promise<StuckJobDetectionResult> {
    const timestamp = new Date().toISOString();
    const findings: StuckJobFinding[] = [];
    let retriesAttempted = 0;
    let escalationsSent = 0;

    try {
      // ─── Query 1: Jobs stuck in `executing` ───────────────────────────
      const executingCutoff = new Date(Date.now() - this.config.executingThresholdHours * 60 * 60 * 1000).toISOString();
      const { data: stuckExecuting, error: execError } = await this.supabase
        .from('customer_jobs')
        .select('job_id, job_status, customer_email, product, execution_started_at, created_at, updated_at')
        .eq('job_status', 'executing')
        .lt('execution_started_at', executingCutoff)
        .order('execution_started_at', { ascending: true });

      if (execError) {
        return {
          timestamp,
          checkedJobs: 0,
          stuckJobsFound: 0,
          retriesAttempted: 0,
          escalationsSent: 0,
          findings: [],
          error: `Failed to query stuck executing jobs: ${execError.message}`,
        };
      }

      // ─── Query 2: Jobs stale in `awaiting_review` ─────────────────────
      const reviewCutoff = new Date(Date.now() - this.config.awaitingReviewThresholdHours * 60 * 60 * 1000).toISOString();
      const { data: staleReview, error: reviewError } = await this.supabase
        .from('customer_jobs')
        .select('job_id, job_status, customer_email, product, execution_completed_at, created_at, updated_at')
        .eq('job_status', 'awaiting_review')
        .lt('execution_completed_at', reviewCutoff)
        .order('execution_completed_at', { ascending: true });

      if (reviewError) {
        return {
          timestamp,
          checkedJobs: (stuckExecuting?.length || 0),
          stuckJobsFound: 0,
          retriesAttempted: 0,
          escalationsSent: 0,
          findings: [],
          error: `Failed to query stale awaiting_review jobs: ${reviewError.message}`,
        };
      }

      const checkedJobs = (stuckExecuting?.length || 0) + (staleReview?.length || 0);

      // ─── Process stuck `executing` jobs ───────────────────────────────
      for (const job of stuckExecuting || []) {
        const stuckSince = job.execution_started_at || job.updated_at || job.created_at;
        const stuckDurationHours = (Date.now() - new Date(stuckSince).getTime()) / (60 * 60 * 1000);
        const retryCount = await this.getRetryCount(job.job_id);

        const finding: StuckJobFinding = {
          jobId: job.job_id,
          jobStatus: job.job_status,
          customerEmail: job.customer_email || 'unknown',
          product: job.product || 'unknown',
          stuckSince,
          stuckDurationHours: Math.round(stuckDurationHours * 10) / 10,
          retryCount,
          recommendedAction: 'retry_execution',
          actionTaken: null,
          actionResult: 'not_attempted',
        };

        // Bounded recovery: retry ONCE. If already retried, escalate instead.
        if (retryCount >= 1) {
          // Already retried once — don't retry again, escalate
          finding.recommendedAction = 'escalate_review';
          finding.actionTaken = 'Escalating (already retried once)';
          if (this.config.enableEscalation) {
            const escalationResult = await this.sendEscalation(finding, 'executing');
            finding.actionResult = escalationResult ? 'success' : 'failed';
            if (escalationResult) escalationsSent++;
          } else {
            finding.actionResult = 'skipped';
          }
        } else if (this.config.enableRetry) {
          // Retry: transition executing → queued so the job processor picks it up
          const retryResult = await this.retryExecution(job.job_id, `Stuck in executing for ${finding.stuckDurationHours}h`);
          finding.actionTaken = retryResult.success ? 'Retried execution (executing → queued)' : `Retry failed: ${retryResult.error}`;
          finding.actionResult = retryResult.success ? 'success' : 'failed';
          if (!retryResult.success) {
            finding.error = retryResult.error;
          }
          retriesAttempted++;
        } else {
          finding.actionResult = 'skipped';
          finding.actionTaken = 'Retry disabled (observe-only mode)';
        }

        findings.push(finding);
      }

      // ─── Process stale `awaiting_review` jobs ─────────────────────────
      for (const job of staleReview || []) {
        const stuckSince = job.execution_completed_at || job.updated_at || job.created_at;
        const stuckDurationHours = (Date.now() - new Date(stuckSince).getTime()) / (60 * 60 * 1000);

        const finding: StuckJobFinding = {
          jobId: job.job_id,
          jobStatus: job.job_status,
          customerEmail: job.customer_email || 'unknown',
          product: job.product || 'unknown',
          stuckSince,
          stuckDurationHours: Math.round(stuckDurationHours * 10) / 10,
          retryCount: 0,
          recommendedAction: 'escalate_review',
          actionTaken: null,
          actionResult: 'not_attempted',
        };

        // Bounded recovery: send escalation notification (reminder).
        // Do NOT auto-deliver — that requires human approval.
        if (this.config.enableEscalation) {
          const escalationResult = await this.sendEscalation(finding, 'awaiting_review');
          finding.actionTaken = escalationResult ? 'Escalation notification sent' : 'Escalation failed';
          finding.actionResult = escalationResult ? 'success' : 'failed';
          if (escalationResult) escalationsSent++;
        } else {
          finding.actionResult = 'skipped';
          finding.actionTaken = 'Escalation disabled (observe-only mode)';
        }

        findings.push(finding);
      }

      return {
        timestamp,
        checkedJobs,
        stuckJobsFound: findings.length,
        retriesAttempted,
        escalationsSent,
        findings,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return {
        timestamp,
        checkedJobs: 0,
        stuckJobsFound: 0,
        retriesAttempted: 0,
        escalationsSent: 0,
        findings: [],
        error: `Detection cycle failed: ${msg}`,
      };
    }
  }

  /**
   * Retry execution: transition executing → queued.
   * This is bounded to ONE retry per job (checked via retry_count in customer_job_events).
   * Records a job event so the retry is auditable.
   */
  private async retryExecution(jobId: string, reason: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Transition executing → queued
      const { error: updateError } = await this.supabase
        .from('customer_jobs')
        .update({
          job_status: 'queued',
          execution_status: 'pending',
          execution_started_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('job_id', jobId)
        .eq('job_status', 'executing'); // Safety: only update if still executing

      if (updateError) {
        return { success: false, error: updateError.message };
      }

      // Record the retry event
      const { error: eventError } = await this.supabase
        .from('customer_job_events')
        .insert({
          job_id: jobId,
          event_type: 'execution_retry',
          actor: 'hydi:stuck-job-detector',
          from_state: 'executing',
          to_state: 'queued',
          details: { reason, retriedAt: new Date().toISOString() },
        });

      if (eventError) {
        // The transition succeeded but the event log failed — not critical
        console.warn(`StuckJobDetector: retry event log failed for ${jobId}: ${eventError.message}`);
      }

      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: msg };
    }
  }

  /**
   * Send an escalation notification for a stuck job.
   */
  private async sendEscalation(finding: StuckJobFinding, context: 'executing' | 'awaiting_review'): Promise<boolean> {
    const notifier = getEscalationNotifier(this.supabase);
    const severity = context === 'executing' ? 'warning' : 'warning';

    const title = context === 'executing'
      ? `Job stuck in executing for ${finding.stuckDurationHours}h`
      : `Job awaiting review for ${finding.stuckDurationHours}h`;

    const body = context === 'executing'
      ? `Job ${finding.jobId} has been in 'executing' state since ${finding.stuckSince} (${finding.stuckDurationHours} hours). Customer: ${finding.customerEmail}, Product: ${finding.product}. Retries so far: ${finding.retryCount}.`
      : `Job ${finding.jobId} has been in 'awaiting_review' state since ${finding.stuckSince} (${finding.stuckDurationHours} hours). Customer: ${finding.customerEmail}, Product: ${finding.product}. The artifact is ready but has not been reviewed or delivered.`;

    const actionRequired = context === 'executing'
      ? `Review the job and decide whether to investigate the execution failure, force-fail it, or take other action. Any action beyond retry requires the one-click Authorize pattern.`
      : `Review the artifact and approve or reject delivery through the existing human-approval gate. Do NOT auto-deliver.`;

    const result = await notifier.notify({
      category: 'stuck_job',
      severity,
      title,
      body,
      actionTaken: finding.actionTaken || undefined,
      actionRequired,
      metadata: {
        jobId: finding.jobId,
        jobStatus: finding.jobStatus,
        customerEmail: finding.customerEmail,
        product: finding.product,
        stuckSince: finding.stuckSince,
        stuckDurationHours: finding.stuckDurationHours,
        retryCount: finding.retryCount,
        context,
      },
    });

    return result.sent;
  }

  /**
   * Get the retry count for a job from customer_job_events.
   */
  private async getRetryCount(jobId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('customer_job_events')
      .select('id', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .eq('event_type', 'execution_retry');

    if (error) return 0;
    return count || 0;
  }
}
