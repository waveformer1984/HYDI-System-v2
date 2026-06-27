/**
 * FINANCIAL RECONCILIATION - Ensure money flow is correct
 * Prove: Stripe shows charge = Ledger matches = HYDI matches
 */

export interface ReconciliationReport {
  taskId: string;
  stripeChargeId?: string;
  stripeAmount?: number;
  ledgerEntryId?: string;
  ledgerAmount?: number;
  hydiBillingStatus?: string;
  hydiCost?: number;
  discrepancies: Discrepancy[];
  isCorrect: boolean;
  lastChecked: string;
}

export interface Discrepancy {
  type: 'stripe_vs_ledger' | 'ledger_vs_hydi' | 'stripe_vs_hydi' | 'missing_data';
  severity: 'error' | 'warning';
  description: string;
  expected?: any;
  actual?: any;
}

export class FinancialReconciliation {

  /**
   * Reconcile a single task across all systems
   */
  async reconcileTask(taskId: string): Promise<ReconciliationReport> {
    const report: ReconciliationReport = {
      taskId,
      discrepancies: [],
      isCorrect: true,
      lastChecked: new Date().toISOString(),
    };

    try {
      // 1. Get HYDI task data
      const hydiTask = await this.getHydiTask(taskId);
      if (hydiTask) {
        report.hydiBillingStatus = hydiTask.billing_status;
        report.hydiCost = hydiTask.ursula_cost;
        report.stripeChargeId = hydiTask.ursula_payment_intent_id;
        report.ledgerEntryId = hydiTask.ursula_ledger_entry_id;
      }

      // 2. Get Stripe charge data
      if (report.stripeChargeId) {
        const stripeData = await this.getStripeCharge(report.stripeChargeId);
        if (stripeData) {
          report.stripeAmount = stripeData.amount;
        } else {
          report.discrepancies.push({
            type: 'missing_data',
            severity: 'error',
            description: 'Stripe charge not found',
            expected: 'charge data',
            actual: 'not found',
          });
        }
      }

      // 3. Get Ledger entry data
      if (report.ledgerEntryId) {
        const ledgerData = await this.getLedgerEntry(report.ledgerEntryId);
        if (ledgerData) {
          report.ledgerAmount = ledgerData.amount;
        } else {
          report.discrepancies.push({
            type: 'missing_data',
            severity: 'error',
            description: 'Ledger entry not found',
            expected: 'ledger data',
            actual: 'not found',
          });
        }
      }

      // 4. Check for discrepancies
      this.checkDiscrepancies(report);

    } catch (error) {
      report.discrepancies.push({
        type: 'missing_data',
        severity: 'error',
        description: `Reconciliation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }

    report.isCorrect = report.discrepancies.length === 0;
    return report;
  }

  /**
   * Reconcile multiple tasks
   */
  async reconcileTasks(taskIds: string[]): Promise<ReconciliationReport[]> {
    const reports: ReconciliationReport[] = [];

    for (const taskId of taskIds) {
      const report = await this.reconcileTask(taskId);
      reports.push(report);
    }

    return reports;
  }

  /**
   * Get reconciliation summary
   */
  getReconciliationSummary(reports: ReconciliationReport[]): {
    total: number;
    correct: number;
    incorrect: number;
    errorCount: number;
    warningCount: number;
    totalDiscrepancies: number;
    issuesByType: Record<string, number>;
  } {
    const summary = {
      total: reports.length,
      correct: reports.filter(r => r.isCorrect).length,
      incorrect: reports.filter(r => !r.isCorrect).length,
      errorCount: 0,
      warningCount: 0,
      totalDiscrepancies: 0,
      issuesByType: {} as Record<string, number>,
    };

    for (const report of reports) {
      summary.totalDiscrepancies += report.discrepancies.length;

      for (const discrepancy of report.discrepancies) {
        summary.issuesByType[discrepancy.type] = (summary.issuesByType[discrepancy.type] || 0) + 1;

        if (discrepancy.severity === 'error') {
          summary.errorCount++;
        } else {
          summary.warningCount++;
        }
      }
    }

    return summary;
  }

  /**
   * ESCALATE discrepancies - NEVER auto-fix financial issues
   */
  async escalateDiscrepancy(report: ReconciliationReport): Promise<{
    escalated: boolean;
    action: string;
    details: string;
    requiresManualReview: boolean;
    priority: 'low' | 'medium' | 'high' | 'critical';
  }> {
    const criticalDiscrepancies = report.discrepancies.filter(d => d.severity === 'error');

    if (criticalDiscrepancies.length === 0) {
      return {
        escalated: false,
        action: 'monitor',
        details: 'No critical discrepancies found',
        requiresManualReview: false,
        priority: 'low',
      };
    }

    // Determine escalation priority
    let priority: 'low' | 'medium' | 'high' | 'critical' = 'medium';

    // Financial discrepancies are critical
    if (criticalDiscrepancies.some(d => d.type.includes('stripe') || d.type.includes('ledger'))) {
      priority = 'critical';
    }

    // Missing data is high priority
    if (criticalDiscrepancies.some(d => d.type === 'missing_data')) {
      priority = 'high';
    }

    // Create escalation record
    const escalationId = await this.createEscalationRecord(report, priority);

    console.error(`[RECONCILIATION] CRITICAL: Financial discrepancy escalated (${priority}) - Task: ${report.taskId}`);

    // In production, would:
    // - Send alert to finance team
    // - Create ticket in issue tracker  
    // - Notify compliance if needed
    // - Block related transactions if critical

    return {
      escalated: true,
      action: 'escalated',
      details: `Financial discrepancy escalated to ${priority} priority - Escalation ID: ${escalationId}`,
      requiresManualReview: true,
      priority,
    };
  }

  /**
   * Create escalation record for manual review
   */
  private async createEscalationRecord(report: ReconciliationReport, priority: string): Promise<string> {
    const escalationId = `esc-${Date.now()}-${report.taskId}`;

    // In production, would store in database
    console.log(`[ESCALATION] Created record ${escalationId} for task ${report.taskId}`);

    return escalationId;
  }

  /**
   * Check for discrepancies between systems
   */
  private checkDiscrepancies(report: ReconciliationReport): void {
    // Check Stripe vs Ledger
    if (report.stripeAmount !== undefined && report.ledgerAmount !== undefined) {
      if (report.stripeAmount !== report.ledgerAmount) {
        report.discrepancies.push({
          type: 'stripe_vs_ledger',
          severity: 'error',
          description: 'Stripe amount differs from ledger amount',
          expected: report.stripeAmount,
          actual: report.ledgerAmount,
        });
      }
    }

    // Check Ledger vs HYDI
    if (report.ledgerAmount !== undefined && report.hydiCost !== undefined) {
      if (report.ledgerAmount !== report.hydiCost) {
        report.discrepancies.push({
          type: 'ledger_vs_hydi',
          severity: 'error',
          description: 'Ledger amount differs from HYDI cost',
          expected: report.ledgerAmount,
          actual: report.hydiCost,
        });
      }
    }

    // Check Stripe vs HYDI
    if (report.stripeAmount !== undefined && report.hydiCost !== undefined) {
      if (report.stripeAmount !== report.hydiCost) {
        report.discrepancies.push({
          type: 'stripe_vs_hydi',
          severity: 'error',
          description: 'Stripe amount differs from HYDI cost',
          expected: report.stripeAmount,
          actual: report.hydiCost,
        });
      }
    }

    // Check billing status consistency
    if (report.hydiBillingStatus && report.stripeAmount) {
      if (report.hydiBillingStatus === 'paid' && report.stripeAmount === 0) {
        report.discrepancies.push({
          type: 'stripe_vs_hydi',
          severity: 'warning',
          description: 'HYDI shows paid but Stripe shows no charge',
          expected: 'charge > 0',
          actual: report.stripeAmount,
        });
      }
    }
  }

  /**
   * Get HYDI task data
   */
  private async getHydiTask(taskId: string): Promise<any> {
    try {
      // In production, would query HYDI database
      // For now, simulate
      return null;
    } catch (error) {
      console.error(`Failed to get HYDI task ${taskId}:`, error);
      return null;
    }
  }

  /**
   * Get Stripe charge data
   */
  private async getStripeCharge(chargeId: string): Promise<any> {
    try {
      // In production, would query Stripe API
      // For now, simulate
      return { amount: 200 }; // $2.00 in cents
    } catch (error) {
      console.error(`Failed to get Stripe charge ${chargeId}:`, error);
      return null;
    }
  }

  /**
   * Get Ledger entry data
   */
  private async getLedgerEntry(entryId: string): Promise<any> {
    try {
      // In production, would query Ursula ledger
      // For now, simulate
      return { amount: 200 };
    } catch (error) {
      console.error(`Failed to get ledger entry ${entryId}:`, error);
      return null;
    }
  }
}

/**
 * Reconciliation service that runs periodically
 */
export class ReconciliationService {
  private reconciliation: FinancialReconciliation;
  private interval: NodeJS.Timeout | null = null;

  constructor() {
    this.reconciliation = new FinancialReconciliation();
  }

  start(intervalMs: number = 5 * 60 * 1000): void { // Every 5 minutes
    if (this.interval) {
      console.log('[RECONCILIATION] Service already running');
      return;
    }

    console.log('[RECONCILIATION] Starting reconciliation service');

    this.interval = setInterval(async () => {
      try {
        await this.runReconciliationCycle();
      } catch (error) {
        console.error('[RECONCILIATION] Reconciliation cycle failed:', error);
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log('[RECONCILIATION] Service stopped');
    }
  }

  private async runReconciliationCycle(): Promise<void> {
    console.log('[RECONCILIATION] Running reconciliation cycle');

    // In production, would get recent tasks that need reconciliation
    const recentTaskIds = await this.getRecentTaskIds();

    if (recentTaskIds.length === 0) {
      console.log('[RECONCILIATION] No tasks to reconcile');
      return;
    }

    const reports = await this.reconciliation.reconcileTasks(recentTaskIds);
    const summary = this.reconciliation.getReconciliationSummary(reports);

    console.log(`[RECONCILIATION] Summary: ${summary.correct}/${summary.total} correct, ${summary.errorCount} errors`);

    // Alert on critical issues
    if (summary.errorCount > 0) {
      console.error(`[RECONCILIATION] CRITICAL: Found ${summary.errorCount} financial discrepancies`);
      // In production, would send alert to monitoring system
    }
  }

  private async getRecentTaskIds(): Promise<string[]> {
    // In production, would query for tasks in last hour with billing activity
    return [];
  }
}
