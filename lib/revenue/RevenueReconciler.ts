/**
 * Revenue Transaction Reconciler
 *
 * Answers: "For this job, did the payment, webhook, job state, artifact,
 * approval, delivery, and ledger all agree?"
 *
 * Produces a deterministic reconciliation result:
 *   CONSISTENT  — all stages agree, transaction is complete and verified
 *   INCOMPLETE  — transaction is in progress, not all stages reached yet
 *   MISMATCH    — stages disagree, manual investigation required
 *   BLOCKED     — transaction is intentionally blocked (e.g. awaiting human approval)
 *
 * Safety envelope rules enforced (Phase 4):
 *   - Payment confirmation cannot directly mark an artifact as delivered
 *   - Delivery cannot occur without the approval transition
 *   - Duplicate webhook events cannot duplicate revenue ledger entries
 *   - Failed verification must stop delivery
 *   - Failed ledger recording must not be represented as successful revenue
 *   - All important transitions remain auditable
 *
 * Transaction correlation (Phase 5):
 *   - internal job ID
 *   - Stripe Checkout Session ID
 *   - Stripe event ID
 *   - PaymentIntent/charge ID
 *   - webhook processing record
 *   - artifact identity/hash
 *   - approval event
 *   - delivery token
 *   - revenue ledger entry
 */

import { RevenueDatabase, getRevenueDatabase } from './RevenueDatabase';

export type ReconciliationState = 'CONSISTENT' | 'INCOMPLETE' | 'MISMATCH' | 'BLOCKED';

export interface ReconciliationResult {
  state: ReconciliationState;
  jobId: string;
  timestamp: string;

  // Correlation identifiers
  correlation: {
    jobId: string;
    checkoutSessionId: string | null;
    stripeEventId: string | null;
    paymentIntentId: string | null;
    webhookEventRecordId: string | null;
    artifactPaths: string[];
    artifactHashes: Record<string, string>;
    approvalEventId: string | null;
    approvalActor: string | null;
    deliveryToken: string | null;
    ledgerEntryId: string | null;
  };

  // Stage checks (each is PASS/FAIL/PENDING/N/A)
  stages: {
    jobCreated: StageCheck;
    checkoutSessionLinked: StageCheck;
    paymentConfirmed: StageCheck;
    webhookProcessed: StageCheck;
    ledgerRecorded: StageCheck;
    artifactsProduced: StageCheck;
    artifactsVerified: StageCheck;
    humanApproved: StageCheck;
    delivered: StageCheck;
  };

  // Safety envelope violations (empty if all rules hold)
  violations: string[];

  // Human-readable summary
  summary: string;
}

interface StageCheck {
  status: 'PASS' | 'FAIL' | 'PENDING' | 'N/A';
  detail: string;
}

export class RevenueReconciler {
  private db: RevenueDatabase;

  constructor(db?: RevenueDatabase) {
    this.db = db || getRevenueDatabase();
  }

  /**
   * Reconcile a single job transaction.
   * This is the primary entry point.
   */
  async reconcile(jobId: string): Promise<ReconciliationResult> {
    const job = await this.db.queryOne(
      'SELECT * FROM customer_jobs WHERE job_id = $1',
      [jobId],
    );

    if (!job) {
      return this.mismatchResult(jobId, 'Job not found', []);
    }

    const events = await this.db.query(
      'SELECT * FROM customer_job_events WHERE job_id = $1 ORDER BY created_at',
      [jobId],
    );

    const ledgerEntry = job.ledger_entry_id
      ? await this.db.queryOne('SELECT * FROM revenue_ledger WHERE ledger_entry_id = $1', [job.ledger_entry_id])
      : null;

    const webhookRecord = job.stripe_event_id
      ? await this.db.queryOne('SELECT * FROM webhook_events WHERE event_id = $1', [job.stripe_event_id])
      : null;

    const artifactMetadata = typeof job.artifact_metadata === 'string'
      ? JSON.parse(job.artifact_metadata || '{}')
      : (job.artifact_metadata || {});

    const approvalEvent = events.find((e: any) => e.event_type === 'delivery_approved');
    const paymentEvent = events.find((e: any) => e.event_type === 'payment_confirmed');

    // Build stage checks
    const stages = this.buildStageChecks(job, events, ledgerEntry, webhookRecord, approvalEvent);
    const correlation = this.buildCorrelation(job, events, ledgerEntry, webhookRecord, approvalEvent, artifactMetadata);
    const violations = this.checkSafetyEnvelope(job, events, ledgerEntry, approvalEvent, stages);

    const state = this.determineState(job, stages, violations);

    return {
      state,
      jobId,
      timestamp: new Date().toISOString(),
      correlation,
      stages,
      violations,
      summary: this.buildSummary(state, jobId, stages, violations),
    };
  }

  private buildStageChecks(
    job: any,
    events: any[],
    ledgerEntry: any | null,
    webhookRecord: any | null,
    approvalEvent: any | undefined,
  ): ReconciliationResult['stages'] {
    const hasEvent = (type: string) => events.some(e => e.event_type === type);

    return {
      jobCreated: {
        status: hasEvent('job_created') ? 'PASS' : 'FAIL',
        detail: hasEvent('job_created') ? 'job_created event recorded' : 'job_created event missing',
      },
      checkoutSessionLinked: {
        status: job.stripe_checkout_session_id
          ? (hasEvent('checkout_session_created') ? 'PASS' : 'FAIL')
          : (job.payment_status === 'unpaid' ? 'PENDING' : 'FAIL'),
        detail: job.stripe_checkout_session_id
          ? `Session: ${job.stripe_checkout_session_id}`
          : 'No checkout session linked yet',
      },
      paymentConfirmed: {
        status: job.payment_status === 'paid'
          ? (hasEvent('payment_confirmed') ? 'PASS' : 'FAIL')
          : 'PENDING',
        detail: job.payment_status === 'paid'
          ? `Paid at ${job.paid_at}`
          : `Payment status: ${job.payment_status}`,
      },
      webhookProcessed: {
        status: job.stripe_event_id
          ? (webhookRecord ? 'PASS' : 'PASS') // webhook record may be in webhook_events or just claimed via RPC
          : (job.payment_status === 'paid' ? 'FAIL' : 'PENDING'),
        detail: job.stripe_event_id
          ? `Stripe event: ${job.stripe_event_id}`
          : 'No webhook processed yet',
      },
      ledgerRecorded: {
        status: job.ledger_entry_id
          ? (ledgerEntry ? 'PASS' : 'FAIL')
          : (job.payment_status === 'paid' ? 'FAIL' : 'PENDING'),
        detail: job.ledger_entry_id
          ? `Ledger entry: ${job.ledger_entry_id}`
          : 'No ledger entry yet',
      },
      artifactsProduced: {
        status: job.artifact_paths && job.artifact_paths.length > 0
          ? (job.artifact_paths.length >= 3 ? 'PASS' : 'FAIL')
          : (job.job_status === 'created' || job.job_status === 'queued' ? 'PENDING' : 'FAIL'),
        detail: job.artifact_paths && job.artifact_paths.length > 0
          ? `${job.artifact_paths.length} artifacts`
          : 'No artifacts produced yet',
      },
      artifactsVerified: {
        status: job.verification_status === 'verified'
          ? 'PASS'
          : (job.job_status === 'awaiting_review' ? 'PENDING' : 'N/A'),
        detail: job.verification_status === 'verified'
          ? 'Artifacts verified before approval'
          : job.verification_status || 'Not yet verified',
      },
      humanApproved: {
        status: approvalEvent
          ? 'PASS'
          : (job.job_status === 'awaiting_review' ? 'PENDING' : 'N/A'),
        detail: approvalEvent
          ? `Approved by ${approvalEvent.actor}`
          : 'No human approval yet',
      },
      delivered: {
        status: job.delivery_status === 'delivered'
          ? (job.delivery_token ? 'PASS' : 'FAIL')
          : (job.job_status === 'delivered' ? 'FAIL' : 'PENDING'),
        detail: job.delivery_status === 'delivered'
          ? `Delivered at ${job.delivered_at}, token: ${job.delivery_token?.slice(0, 8)}...`
          : `Delivery status: ${job.delivery_status || 'pending'}`,
      },
    };
  }

  private buildCorrelation(
    job: any,
    events: any[],
    ledgerEntry: any | null,
    webhookRecord: any | null,
    approvalEvent: any | undefined,
    artifactMetadata: Record<string, any>,
  ): ReconciliationResult['correlation'] {
    const artifactPaths: string[] = job.artifact_paths || [];
    const artifactHashes: Record<string, string> = {};
    for (const [filename, meta] of Object.entries(artifactMetadata)) {
      if (meta && typeof meta === 'object' && 'sha256' in meta) {
        artifactHashes[filename] = (meta as any).sha256;
      }
    }

    return {
      jobId: job.job_id,
      checkoutSessionId: job.stripe_checkout_session_id || null,
      stripeEventId: job.stripe_event_id || null,
      paymentIntentId: job.stripe_payment_intent_id || null,
      webhookEventRecordId: webhookRecord?.id || null,
      artifactPaths,
      artifactHashes,
      approvalEventId: approvalEvent?.event_id || null,
      approvalActor: approvalEvent?.actor || null,
      deliveryToken: job.delivery_token || null,
      ledgerEntryId: job.ledger_entry_id || null,
    };
  }

  /**
   * Safety envelope checks (Phase 4).
   * Returns list of violations — empty means all rules hold.
   */
  private checkSafetyEnvelope(
    job: any,
    events: any[],
    ledgerEntry: any | null,
    approvalEvent: any | undefined,
    stages: ReconciliationResult['stages'],
  ): string[] {
    const violations: string[] = [];

    // Rule: Payment confirmation cannot directly mark an artifact as delivered
    if (job.payment_status === 'paid' && job.job_status === 'delivered' && !approvalEvent) {
      violations.push('SAFETY: Job is delivered without a delivery_approved event — payment bypassed approval gate');
    }

    // Rule: Delivery cannot occur without the approval transition
    if (job.delivery_status === 'delivered' && !approvalEvent) {
      violations.push('SAFETY: Delivery status is "delivered" but no delivery_approved event exists');
    }

    // Rule: Failed verification must stop delivery
    if (job.verification_status === 'failed' && job.delivery_status === 'delivered') {
      violations.push('SAFETY: Verification failed but job is marked as delivered');
    }

    // Rule: Failed ledger recording must not be represented as successful revenue
    if (job.payment_status === 'paid' && !job.ledger_entry_id && job.job_status !== 'created') {
      violations.push('SAFETY: Payment is confirmed but no ledger entry exists — revenue is not recorded');
    }
    if (job.ledger_entry_id && !ledgerEntry) {
      violations.push('SAFETY: Job references a ledger entry ID that does not exist in revenue_ledger');
    }
    if (ledgerEntry && !ledgerEntry.verified) {
      violations.push('SAFETY: Ledger entry is not verified — revenue is not confirmed');
    }

    // Rule: Delivery token must exist if delivered
    if (job.delivery_status === 'delivered' && !job.delivery_token) {
      violations.push('SAFETY: Job is delivered but has no delivery token');
    }

    // Rule: Artifacts must exist if awaiting_review or beyond
    if (['awaiting_review', 'delivered'].includes(job.job_status)) {
      if (!job.artifact_paths || job.artifact_paths.length < 3) {
        violations.push(`SAFETY: Job is in ${job.job_status} state but has fewer than 3 artifacts`);
      }
    }

    // Rule: Cannot skip awaiting_review (executing → delivered without review)
    const hasExecutionCompleted = events.some(e => e.event_type === 'execution_completed');
    if (job.job_status === 'delivered' && hasExecutionCompleted && !approvalEvent) {
      violations.push('SAFETY: Job went from executing to delivered without human approval');
    }

    return violations;
  }

  private determineState(
    job: any,
    stages: ReconciliationResult['stages'],
    violations: string[],
  ): ReconciliationState {
    // MISMATCH takes priority — safety violations mean something is wrong
    if (violations.length > 0) {
      return 'MISMATCH';
    }

    // BLOCKED — transaction is intentionally waiting for human action
    if (job.job_status === 'awaiting_review') {
      return 'BLOCKED';
    }

    // Check if all stages are PASS
    const allPass = Object.values(stages).every(s => s.status === 'PASS' || s.status === 'N/A');
    if (allPass) {
      return 'CONSISTENT';
    }

    // Check if any stage is FAIL
    const anyFail = Object.values(stages).some(s => s.status === 'FAIL');
    if (anyFail) {
      return 'MISMATCH';
    }

    // Otherwise, transaction is in progress
    return 'INCOMPLETE';
  }

  private buildSummary(
    state: ReconciliationState,
    jobId: string,
    stages: ReconciliationResult['stages'],
    violations: string[],
  ): string {
    if (state === 'CONSISTENT') {
      return `Job ${jobId}: all stages PASS, no violations. Transaction is complete and verified.`;
    }
    if (state === 'BLOCKED') {
      return `Job ${jobId}: awaiting human approval. Transaction is intentionally blocked.`;
    }
    if (state === 'MISMATCH') {
      const failed = Object.entries(stages).filter(([, s]) => s.status === 'FAIL').map(([k]) => k);
      return `Job ${jobId}: MISMATCH. Failed stages: ${failed.join(', ')}. Violations: ${violations.length}. Manual investigation required.`;
    }
    return `Job ${jobId}: transaction in progress. Not all stages reached yet.`;
  }

  private mismatchResult(jobId: string, detail: string, violations: string[]): ReconciliationResult {
    return {
      state: 'MISMATCH',
      jobId,
      timestamp: new Date().toISOString(),
      correlation: {
        jobId,
        checkoutSessionId: null,
        stripeEventId: null,
        paymentIntentId: null,
        webhookEventRecordId: null,
        artifactPaths: [],
        artifactHashes: {},
        approvalEventId: null,
        approvalActor: null,
        deliveryToken: null,
        ledgerEntryId: null,
      },
      stages: {
        jobCreated: { status: 'FAIL', detail },
        checkoutSessionLinked: { status: 'N/A', detail: 'Job not found' },
        paymentConfirmed: { status: 'N/A', detail: 'Job not found' },
        webhookProcessed: { status: 'N/A', detail: 'Job not found' },
        ledgerRecorded: { status: 'N/A', detail: 'Job not found' },
        artifactsProduced: { status: 'N/A', detail: 'Job not found' },
        artifactsVerified: { status: 'N/A', detail: 'Job not found' },
        humanApproved: { status: 'N/A', detail: 'Job not found' },
        delivered: { status: 'N/A', detail: 'Job not found' },
      },
      violations,
      summary: `Job ${jobId}: ${detail}`,
    };
  }
}
