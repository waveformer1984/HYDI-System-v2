/**
 * HYDI Revenue Ledger
 *
 * The canonical, immutable, auditable record of all revenue events.
 *
 * Key principles:
 *   - Revenue is recorded ONLY from verified payment-provider events.
 *   - A checkout redirect is NOT revenue.
 *   - A payment API request is NOT revenue.
 *   - Only a verified Stripe webhook event with a valid signature is revenue.
 *
 * The ledger is append-only. Entries are never modified after insertion.
 * Idempotency is enforced via stripe_event_id uniqueness.
 */

import { RevenueDatabase, getRevenueDatabase } from './RevenueDatabase';
import type { RevenueLedgerEntry, RevenueEventType, RevenueEventSource, OfferId } from './types';

export class RevenueLedger {
  private db: RevenueDatabase;

  constructor(db?: RevenueDatabase) {
    this.db = db || getRevenueDatabase();
  }

  async recordEvent(input: {
    eventType: RevenueEventType;
    source: RevenueEventSource;
    stripeEventId: string;
    stripePaymentIntentId?: string | null;
    stripeChargeId?: string | null;
    stripeInvoiceId?: string | null;
    stripeSubscriptionId?: string | null;
    customerId: string;
    prospectId?: string | null;
    opportunityId?: string | null;
    offerId?: OfferId | null;
    amountGross: number;
    amountNet: number;
    currency: string;
    feeBreakdown?: { platformFee: number; stripeFee: number; otherFees: number };
    verified: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<{ entry: RevenueLedgerEntry; created: boolean }> {
    // Idempotency check
    if (input.stripeEventId) {
      const existing = await this.db.queryOne(
        'SELECT * FROM revenue_ledger WHERE stripe_event_id = $1 LIMIT 1',
        [input.stripeEventId],
      );
      if (existing) return { entry: this.rowToEntry(existing), created: false };
    }

    try {
      const row = await this.db.insert('revenue_ledger', {
        event_type: input.eventType,
        source: input.source,
        stripe_event_id: input.stripeEventId,
        stripe_payment_intent_id: input.stripePaymentIntentId || null,
        stripe_charge_id: input.stripeChargeId || null,
        stripe_invoice_id: input.stripeInvoiceId || null,
        stripe_subscription_id: input.stripeSubscriptionId || null,
        customer_id: input.customerId,
        prospect_id: input.prospectId || null,
        opportunity_id: input.opportunityId || null,
        offer_id: input.offerId || null,
        amount_gross: input.amountGross,
        amount_net: input.amountNet,
        currency: input.currency,
        fee_breakdown: JSON.stringify(input.feeBreakdown || { platformFee: 0, stripeFee: 0, otherFees: 0 }),
        verified: input.verified,
        verified_at: input.verified ? new Date().toISOString() : null,
        metadata: JSON.stringify(input.metadata || {}),
        recorded_at: new Date().toISOString(),
      });
      return { entry: this.rowToEntry(row), created: true };
    } catch (error) {
      // Unique constraint violation — already processed
      if (error instanceof Error && error.message.includes('duplicate')) {
        const existing = await this.db.queryOne(
          'SELECT * FROM revenue_ledger WHERE stripe_event_id = $1 LIMIT 1',
          [input.stripeEventId],
        );
        if (existing) return { entry: this.rowToEntry(existing), created: false };
      }
      throw error;
    }
  }

  async getVerifiedRevenue(limit = 100): Promise<RevenueLedgerEntry[]> {
    const rows = await this.db.query(
      'SELECT * FROM revenue_ledger WHERE verified = true ORDER BY recorded_at DESC LIMIT $1',
      [limit],
    );
    return rows.map((r) => this.rowToEntry(r));
  }

  async getCustomerRevenue(customerId: string): Promise<RevenueLedgerEntry[]> {
    const rows = await this.db.query(
      'SELECT * FROM revenue_ledger WHERE customer_id = $1 ORDER BY recorded_at DESC',
      [customerId],
    );
    return rows.map((r) => this.rowToEntry(r));
  }

  async calculateMRR(): Promise<number> {
    const started = await this.db.query<{ stripe_subscription_id: string; amount_gross: number }>(
      `SELECT stripe_subscription_id, amount_gross FROM revenue_ledger
       WHERE event_type = 'subscription_started' AND verified = true AND stripe_subscription_id IS NOT NULL`,
    );
    const cancelled = await this.db.query<{ stripe_subscription_id: string }>(
      `SELECT stripe_subscription_id FROM revenue_ledger
       WHERE event_type = 'subscription_cancelled' AND verified = true AND stripe_subscription_id IS NOT NULL`,
    );
    const cancelledSubs = new Set(cancelled.map((r) => r.stripe_subscription_id));
    return started
      .filter((s) => !cancelledSubs.has(s.stripe_subscription_id))
      .reduce((sum, s) => sum + (s.amount_gross || 0), 0);
  }

  async calculateTotalRevenue(): Promise<{ totalGross: number; totalNet: number; byEventType: Record<string, number> }> {
    const rows = await this.db.query<{ event_type: string; amount_gross: number; amount_net: number }>(
      'SELECT event_type, amount_gross, amount_net FROM revenue_ledger WHERE verified = true',
    );
    let totalGross = 0, totalNet = 0;
    const byEventType: Record<string, number> = {};
    for (const row of rows) {
      if (row.event_type === 'refund_issued') {
        totalGross -= row.amount_gross || 0;
        totalNet -= row.amount_net || 0;
      } else if (row.event_type === 'payment_received' || row.event_type === 'setup_fee_collected') {
        totalGross += row.amount_gross || 0;
        totalNet += row.amount_net || 0;
      }
      byEventType[row.event_type] = (byEventType[row.event_type] || 0) + (row.amount_gross || 0);
    }
    return { totalGross, totalNet, byEventType };
  }

  async getRevenueSummary(): Promise<{
    mrr: number; arr: number; totalRevenue: number; setupRevenue: number;
    refunds: number; failedPayments: number; customerCount: number; entryCount: number;
  }> {
    const mrr = await this.calculateMRR();
    const totals = await this.calculateTotalRevenue();

    const customers = await this.db.query<{ customer_id: string }>(
      `SELECT DISTINCT customer_id FROM revenue_ledger WHERE verified = true
       AND event_type IN ('payment_received', 'setup_fee_collected', 'subscription_started')`,
    );
    const failedCount = await this.db.count(
      "SELECT count(*) as count FROM revenue_ledger WHERE event_type = 'payment_failed' AND verified = true",
    );
    const refunds = await this.db.query<{ amount_gross: number }>(
      "SELECT amount_gross FROM revenue_ledger WHERE event_type = 'refund_issued' AND verified = true",
    );
    const setup = await this.db.query<{ amount_gross: number }>(
      "SELECT amount_gross FROM revenue_ledger WHERE event_type = 'setup_fee_collected' AND verified = true",
    );
    const entryCount = await this.db.count('SELECT count(*) as count FROM revenue_ledger');

    return {
      mrr, arr: mrr * 12, totalRevenue: totals.totalGross,
      setupRevenue: setup.reduce((s, r) => s + (r.amount_gross || 0), 0),
      refunds: refunds.reduce((s, r) => s + (r.amount_gross || 0), 0),
      failedPayments: failedCount, customerCount: customers.length, entryCount,
    };
  }

  async isEventProcessed(stripeEventId: string): Promise<boolean> {
    return this.db.exists('revenue_ledger', 'stripe_event_id = $1', [stripeEventId]);
  }

  private rowToEntry(row: Record<string, unknown>): RevenueLedgerEntry {
    return {
      ledgerEntryId: row.ledger_entry_id as string,
      eventType: row.event_type as RevenueEventType,
      source: row.source as RevenueEventSource,
      stripeEventId: (row.stripe_event_id as string) || '',
      stripePaymentIntentId: (row.stripe_payment_intent_id as string) || null,
      stripeChargeId: (row.stripe_charge_id as string) || null,
      stripeInvoiceId: (row.stripe_invoice_id as string) || null,
      stripeSubscriptionId: (row.stripe_subscription_id as string) || null,
      customerId: (row.customer_id as string) || '',
      prospectId: (row.prospect_id as string) || null,
      opportunityId: (row.opportunity_id as string) || null,
      offerId: (row.offer_id as OfferId) || null,
      amountGross: (row.amount_gross as number) || 0,
      amountNet: (row.amount_net as number) || 0,
      currency: (row.currency as string) || 'usd',
      feeBreakdown: typeof row.fee_breakdown === 'string' ? JSON.parse(row.fee_breakdown) : (row.fee_breakdown as { platformFee: number; stripeFee: number; otherFees: number }) || { platformFee: 0, stripeFee: 0, otherFees: 0 },
      verified: (row.verified as boolean) || false,
      verifiedAt: (row.verified_at as string) || null,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata as Record<string, unknown>) || {},
      recordedAt: row.recorded_at as string,
    };
  }
}
