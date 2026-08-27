/**
 * Revenue Reconciliation Detector
 *
 * First real autonomous operations goal #2: revenue reconciliation.
 *
 * Runs on a daily schedule (vs hourly for stuck-job detection) and checks
 * whether the revenue ledger and customer jobs are in a consistent state.
 *
 * STRICTLY READ-ONLY AND OBSERVATIONAL.
 * Per the existing AutonomyContract, any actual correction (adjusting a
 * ledger entry, refunding a mismatched payout) is NOT executed by this
 * detector. Discrepancies are escalated through EscalationNotifier for
 * a human to decide — the same boundary already established for financial
 * mutations throughout this system.
 *
 * Checks performed:
 *   1. REVENUE_LEDGER_VERIFIED: All ledger entries are provider-verified.
 *      Unverified entries are escalated.
 *   2. PAYOUTS_RECONCILED: Ledger entries match customer job payment states.
 *      Jobs marked as 'paid' without a ledger entry (or vice versa) are
 *      flagged as mismatches.
 *   3. SAFETY_ENVELOPE: Jobs in delivered/awaiting_review state without
 *      proper approval events are flagged as safety violations.
 *
 * Bounded actions:
 *   - CONSISTENT state: no action, log healthy state.
 *   - INCOMPLETE state: no action, log in-progress state.
 *   - MISMATCH state: escalate via EscalationNotifier. DO NOT auto-correct.
 *   - BLOCKED state: no action (intentionally waiting for human).
 *
 * This mirrors the REVENUE_LEDGER_VERIFIED and PAYOUTS_RECONCILED templates
 * already in DynamicPlanner, but runs them on a real recurring schedule
 * against real database state rather than only in one-off qualification
 * scenarios.
 */

import { RevenueReconciler, ReconciliationResult } from '../revenue/RevenueReconciler';
import { EscalationNotifier, getEscalationNotifier } from './EscalationNotifier';
import { createClient } from '@supabase/supabase-js';

export interface ReconciliationSummary {
  timestamp: string;
  totalJobs: number;
  reconciled: number;
  consistent: number;
  incomplete: number;
  mismatch: number;
  blocked: number;
  mismatches: Array<{
    jobId: string;
    state: string;
    violations: string[];
    summary: string;
  }>;
  unverifiedLedgerEntries: number;
  escalated: number;
  observeOnly: boolean;
}

export class RevenueReconciliationDetector {
  private reconciler: RevenueReconciler;
  private supabase: any;
  private notifier: EscalationNotifier;
  private observeOnly: boolean;

  constructor(options?: { supabase?: any; observeOnly?: boolean }) {
    this.supabase = options?.supabase ?? null;
    this.reconciler = new RevenueReconciler();
    this.notifier = getEscalationNotifier(this.supabase);
    this.observeOnly = options?.observeOnly ?? false;
  }

  /**
   * Run a full reconciliation cycle.
   * Queries all customer jobs, reconciles each, and escalates mismatches.
   */
  async detectAndEscalate(): Promise<ReconciliationSummary> {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Revenue Reconciliation Detector starting`);

    // 1. Get ledger summary
    const ledgerSummary = await this.getLedgerSummary();
    console.log(`  Ledger: ${ledgerSummary.total} entries, ${ledgerSummary.verified} verified, ${ledgerSummary.unverified} unverified`);

    // 2. Get all jobs that have reached payment/delivery stages
    const jobs = await this.getRelevantJobs();
    console.log(`  Jobs to reconcile: ${jobs.length}`);

    // 3. Reconcile each job
    const results: ReconciliationResult[] = [];
    for (const job of jobs) {
      try {
        const result = await this.reconciler.reconcile(job.job_id);
        results.push(result);
      } catch (err) {
        console.error(`  Reconciliation failed for ${job.job_id}:`, err instanceof Error ? err.message : 'Unknown error');
      }
    }

    // 4. Categorize results
    const consistent = results.filter(r => r.state === 'CONSISTENT').length;
    const incomplete = results.filter(r => r.state === 'INCOMPLETE').length;
    const mismatch = results.filter(r => r.state === 'MISMATCH').length;
    const blocked = results.filter(r => r.state === 'BLOCKED').length;
    const mismatches = results
      .filter(r => r.state === 'MISMATCH')
      .map(r => ({
        jobId: r.jobId,
        state: r.state,
        violations: r.violations,
        summary: r.summary,
      }));

    console.log(`  Results: ${consistent} consistent, ${incomplete} incomplete, ${mismatch} mismatch, ${blocked} blocked`);

    // 5. Escalate mismatches and unverified ledger entries
    let escalated = 0;
    if (!this.observeOnly) {
      // Escalate each mismatch
      for (const m of mismatches) {
        await this.sendEscalation({
          category: 'revenue_reconciliation',
          severity: 'critical',
          title: `Revenue mismatch: job ${m.jobId}`,
          body: m.summary,
          actionTaken: 'None — read-only observation per AutonomyContract',
          actionRequired: `Investigate mismatch for job ${m.jobId}. Violations: ${m.violations.join('; ')}. Any correction requires the one-click Authorize pattern.`,
          metadata: { jobId: m.jobId, violations: m.violations, timestamp },
        });
        escalated++;
      }

      // Escalate unverified ledger entries
      if (ledgerSummary.unverified > 0) {
        await this.sendEscalation({
          category: 'revenue_reconciliation',
          severity: 'critical',
          title: `Unverified ledger entries: ${ledgerSummary.unverified}`,
          body: `${ledgerSummary.unverified} of ${ledgerSummary.total} revenue ledger entries are not provider-verified. This means revenue may not be confirmed.`,
          actionTaken: 'None — read-only observation per AutonomyContract',
          actionRequired: 'Review unverified ledger entries and determine why they are not verified. Any correction requires the one-click Authorize pattern.',
          metadata: { total: ledgerSummary.total, unverified: ledgerSummary.unverified, timestamp },
        });
        escalated++;
      }
    } else {
      console.log('  Observe-only mode: skipping escalation');
    }

    const summary: ReconciliationSummary = {
      timestamp,
      totalJobs: jobs.length,
      reconciled: results.length,
      consistent,
      incomplete,
      mismatch,
      blocked,
      mismatches,
      unverifiedLedgerEntries: ledgerSummary.unverified,
      escalated,
      observeOnly: this.observeOnly,
    };

    console.log(`  Escalated: ${escalated}`);
    console.log(`[${timestamp}] Revenue Reconciliation Detector complete`);

    return summary;
  }

  /**
   * Get a summary of the revenue ledger.
   */
  private async getLedgerSummary(): Promise<{ total: number; verified: number; unverified: number }> {
    if (!this.supabase) {
      return { total: 0, verified: 0, unverified: 0 };
    }
    const { data, error } = await this.supabase
      .from('revenue_ledger')
      .select('verified');
    if (error || !data) {
      console.error('  Ledger query failed:', error?.message);
      return { total: 0, verified: 0, unverified: 0 };
    }
    const total = data.length;
    const verified = data.filter((r: any) => r.verified).length;
    return { total, verified, unverified: total - verified };
  }

  /**
   * Get jobs that are relevant for reconciliation.
   * Only jobs that have reached payment or delivery stages need reconciliation.
   */
  private async getRelevantJobs(): Promise<Array<{ job_id: string }>> {
    if (!this.supabase) {
      return [];
    }
    // Reconcile jobs that are delivered, awaiting_review, or have payment_status = 'paid'
    const { data, error } = await this.supabase
      .from('customer_jobs')
      .select('job_id')
      .in('job_status', ['delivered', 'awaiting_review', 'failed', 'refunded'])
      .or('payment_status.eq.paid');
    if (error || !data) {
      console.error('  Jobs query failed:', error?.message);
      return [];
    }
    return data;
  }

  /**
   * Send an escalation notification.
   */
  private async sendEscalation(notification: {
    category: string;
    severity: 'critical' | 'warning' | 'info';
    title: string;
    body: string;
    actionTaken?: string;
    actionRequired?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      const result = await this.notifier.notify(notification);
      if (!result.sent) {
        console.error(`  Escalation failed to send: ${result.error}`);
      }
    } catch (err) {
      console.error('  Escalation threw:', err instanceof Error ? err.message : 'Unknown error');
    }
  }
}
