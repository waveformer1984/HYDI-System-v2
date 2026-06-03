import Stripe from 'stripe';
import { LedgerService, CreditTransaction } from './ledger-service';

// Stripe SDK does not export a Transaction type; alias locally for consolidation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
 type StripeTransaction = any;

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-05-27.dahlia',
});

export interface ReconciliationResult {
  success: boolean;
  period: {
    start: Date;
    end: Date;
  };
  ledger: {
    totalDebits: number;
    transactions: CreditTransaction[];
  };
  stripe: {
    totalRevenue: number;
    transactions: StripeTransaction[];
  };
  discrepancy: {
    amount: number;
    percentage: number;
    isWithinThreshold: boolean;
  };
  alerts: string[];
  recommendations: string[];
}

export interface ReconciliationAlert {
  type: 'DISCREPANCY' | 'MISSING_WEBHOOK' | 'STRIPE_ERROR';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  data: any;
  timestamp: Date;
}

export class ReconciliationService {
  private ledgerService = new LedgerService();
  private readonly DISCREPANCY_THRESHOLD = 0.01; // 1%

  /**
   * Run three-way reconciliation between Ledger, Stripe, and external validator
   */
  async runReconciliation(hoursBack: number = 24): Promise<ReconciliationResult> {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - hoursBack * 60 * 60 * 1000);

    console.log(`[RECONCILIATION] Starting reconciliation for period ${startTime.toISOString()} to ${endTime.toISOString()}`);

    try {
      // 1. Get confirmed debits from ledger
      const ledgerDebits = await this.ledgerService.getConfirmedDebits(startTime);
      const totalLedgerDebits = ledgerDebits.reduce((sum, tx) => sum + tx.amount, 0);

      console.log(`[RECONCILIATION] Ledger: ${ledgerDebits.length} debits totaling $${totalLedgerDebits / 100}`);

      // 2. Get successful payments from Stripe
      const stripePayments = await this.getStripePayments(startTime, endTime);
      const totalStripeRevenue = stripePayments.reduce((sum, payment) => sum + payment.amount, 0);

      console.log(`[RECONCILIATION] Stripe: ${stripePayments.length} payments totaling $${totalStripeRevenue / 100}`);

      // 3. Calculate discrepancy
      const discrepancy = this.calculateDiscrepancy(totalLedgerDebits, totalStripeRevenue);

      // 4. Generate alerts and recommendations
      const alerts = this.generateAlerts(discrepancy, ledgerDebits, stripePayments);
      const recommendations = this.generateRecommendations(discrepancy, alerts);

      // 5. Log reconciliation results
      const result: ReconciliationResult = {
        success: true,
        period: { start: startTime, end: endTime },
        ledger: {
          totalDebits: totalLedgerDebits,
          transactions: ledgerDebits
        },
        stripe: {
          totalRevenue: totalStripeRevenue,
          transactions: stripePayments
        },
        discrepancy,
        alerts,
        recommendations
      };

      console.log(`[RECONCILIATION] Completed. Discrepancy: ${discrepancy.percentage.toFixed(2)}% (${discrepancy.isWithinThreshold ? 'OK' : 'ALERT'})`);

      // 6. Trigger alerts if needed
      if (!discrepancy.isWithinThreshold) {
        await this.triggerCriticalAlerts(result);
      }

      return result;
    } catch (error) {
      console.error('[RECONCILIATION] Error during reconciliation:', error);
      throw error;
    }
  }

  /**
   * Get successful payments from Stripe for the given period
   */
  private async getStripePayments(startTime: Date, endTime: Date): Promise<StripeTransaction[]> {
    try {
      // Get charges from Stripe
      const charges = await stripe.charges.list({
        created: {
          gte: Math.floor(startTime.getTime() / 1000),
          lte: Math.floor(endTime.getTime() / 1000)
        },
        limit: 100,
        status: 'succeeded'
      } as Stripe.ChargeListParams);

      // Convert charges to transactions format
      const transactions: StripeTransaction[] = charges.data.map(charge => ({
        id: charge.id,
        amount: charge.amount,
        currency: charge.currency,
        type: 'charge',
        created: charge.created,
        description: charge.description,
        metadata: charge.metadata,
        source: charge.source,
        balance_transaction: charge.balance_transaction
      }));

      return transactions;
    } catch (error) {
      console.error('[RECONCILIATION] Error fetching Stripe payments:', error);
      throw new Error('Failed to fetch Stripe payments');
    }
  }

  /**
   * Calculate discrepancy between ledger and Stripe
   */
  private calculateDiscrepancy(ledgerAmount: number, stripeAmount: number): {
    amount: number;
    percentage: number;
    isWithinThreshold: boolean;
  } {
    const amount = Math.abs(ledgerAmount - stripeAmount);
    const percentage = ledgerAmount > 0 ? (amount / ledgerAmount) * 100 : 0;
    const isWithinThreshold = percentage <= this.DISCREPANCY_THRESHOLD * 100;

    return {
      amount,
      percentage,
      isWithinThreshold
    };
  }

  /**
   * Generate alerts based on reconciliation results
   */
  private generateAlerts(
    discrepancy: { amount: number; percentage: number; isWithinThreshold: boolean },
    ledgerDebits: CreditTransaction[],
    stripePayments: StripeTransaction[]
  ): string[] {
    const alerts: string[] = [];

    // Discrepancy alerts
    if (!discrepancy.isWithinThreshold) {
      alerts.push(`REVENUE DISCREPANCY: ${discrepancy.percentage.toFixed(2)}% difference ($${discrepancy.amount / 100})`);
    }

    // Missing webhook alerts
    const ledgerSources = new Set(ledgerDebits.map(tx => tx.source));
    const expectedStripeSources = ['stripe_checkout', 'stripe_payment_intent', 'stripe_subscription'];
    
    expectedStripeSources.forEach(source => {
      if (!ledgerSources.has(source) && stripePayments.length > 0) {
        alerts.push(`MISSING WEBHOOK: No ${source} transactions found in ledger`);
      }
    });

    // Data integrity alerts
    if (ledgerDebits.length === 0 && stripePayments.length > 0) {
      alerts.push('DATA INTEGRITY: Stripe payments found but no ledger debits');
    }

    if (stripePayments.length === 0 && ledgerDebits.length > 0) {
      alerts.push('DATA INTEGRITY: Ledger debits found but no Stripe payments');
    }

    return alerts;
  }

  /**
   * Generate recommendations based on reconciliation results
   */
  private generateRecommendations(
    discrepancy: { amount: number; percentage: number; isWithinThreshold: boolean },
    alerts: string[]
  ): string[] {
    const recommendations: string[] = [];

    if (!discrepancy.isWithinThreshold) {
      recommendations.push('FREEZE LEDGER: Stop all credit operations until discrepancy resolved');
      recommendations.push('MANUAL REVIEW: Investigate missing or duplicate transactions');
      recommendations.push('AUDIT TRAIL: Review webhook logs and payment processing');
    }

    if (alerts.some(alert => alert.includes('MISSING WEBHOOK'))) {
      recommendations.push('WEBHOOK HEALTH: Check Stripe webhook endpoint status');
      recommendations.push('WEBHOOK LOGS: Review webhook delivery logs in Stripe dashboard');
    }

    if (alerts.some(alert => alert.includes('DATA INTEGRITY'))) {
      recommendations.push('DATA SYNC: Manually sync ledger with Stripe data');
      recommendations.push('BACKUP VERIFICATION: Verify backup and restore procedures');
    }

    if (alerts.length === 0) {
      recommendations.push('NORMAL OPERATIONS: Reconciliation successful, continue monitoring');
    }

    return recommendations;
  }

  /**
   * Trigger critical alerts for significant discrepancies
   */
  private async triggerCriticalAlerts(result: ReconciliationResult): Promise<void> {
    console.error('[RECONCILIATION] CRITICAL ALERT - Revenue discrepancy detected!');
    console.error(`[RECONCILIATION] Ledger: $${result.ledger.totalDebits / 100}`);
    console.error(`[RECONCILIATION] Stripe: $${result.stripe.totalRevenue / 100}`);
    console.error(`[RECONCILIATION] Discrepancy: ${result.discrepancy.percentage.toFixed(2)}%`);

    // TODO: Send email alerts
    // TODO: Send Slack notifications
    // TODO: Create incident in monitoring system
    // TODO: Freeze ledger operations automatically

    // For now, just log the critical alert
    const alertData = {
      type: 'CRITICAL_RECONCILIATION_FAILURE',
      timestamp: new Date().toISOString(),
      discrepancy: result.discrepancy,
      ledger: result.ledger,
      stripe: result.stripe,
      alerts: result.alerts
    };

    console.error('[RECONCILIATION] Alert data:', JSON.stringify(alertData, null, 2));
  }

  /**
   * Get reconciliation history
   */
  async getReconciliationHistory(limit: number = 30): Promise<any[]> {
    // TODO: Implement reconciliation history storage
    // For now, return empty array
    return [];
  }

  /**
   * Manual reconciliation trigger
   */
  async triggerManualReconciliation(hoursBack: number = 24): Promise<ReconciliationResult> {
    console.log(`[RECONCILIATION] Manual reconciliation triggered for last ${hoursBack} hours`);
    return this.runReconciliation(hoursBack);
  }

  /**
   * Health check for reconciliation service
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    lastReconciliation?: Date;
    stripeConnectivity: boolean;
    ledgerConnectivity: boolean;
    alerts: string[];
  }> {
    const alerts: string[] = [];
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    // Check Stripe connectivity
    let stripeConnectivity = false;
    try {
      await stripe.balance.retrieve();
      stripeConnectivity = true;
    } catch (error) {
      alerts.push('Stripe API connectivity failed');
      status = 'unhealthy';
    }

    // Check ledger connectivity
    let ledgerConnectivity = false;
    try {
      await this.ledgerService.getStats();
      ledgerConnectivity = true;
    } catch (error) {
      alerts.push('Ledger service connectivity failed');
      status = 'unhealthy';
    }

    return {
      status,
      lastReconciliation: undefined, // TODO: Track last reconciliation time
      stripeConnectivity,
      ledgerConnectivity,
      alerts
    };
  }
}
