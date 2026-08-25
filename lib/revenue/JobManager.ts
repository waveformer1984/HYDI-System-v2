/**
 * HYDI Customer Job Manager
 *
 * Manages the lifecycle of customer jobs from intake through delivery.
 * Connects payment (Stripe) → execution (HEIDI) → delivery (artifacts) → revenue (ledger).
 *
 * Uses RevenueDatabase (direct pg) for persistence, consistent with the
 * existing revenue engine pattern.
 *
 * Lifecycle:
 *   CREATED → PAID → QUEUED → EXECUTING → AWAITING_REVIEW → DELIVERED
 *   (any state → FAILED / CANCELLED / REFUNDED)
 */

import { getRevenueDatabase, RevenueDatabase } from '../revenue/RevenueDatabase';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

export type JobStatus =
  | 'created' | 'queued' | 'executing' | 'awaiting_review'
  | 'delivered' | 'failed' | 'cancelled' | 'refunded';

export type PaymentStatus =
  | 'unpaid' | 'pending' | 'paid' | 'failed' | 'refunded';

export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed';

export type VerificationStatus = 'pending' | 'verified' | 'failed';

export type DeliveryStatus = 'pending' | 'delivered' | 'failed';

export interface CustomerJob {
  jobId: string;
  customerId: string | null;
  customerEmail: string;
  customerName: string | null;
  product: string;
  requestText: string;
  requirements: Record<string, unknown>;
  priceCents: number;
  currency: string;
  paymentStatus: PaymentStatus;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  stripeEventId: string | null;
  paidAt: string | null;
  jobStatus: JobStatus;
  executionStatus: ExecutionStatus;
  executionStartedAt: string | null;
  executionCompletedAt: string | null;
  executionError: string | null;
  interventionStatus: 'none' | 'requested' | 'approved' | 'rejected' | 'resolved';
  interventionId: string | null;
  verificationStatus: VerificationStatus;
  verificationNotes: string | null;
  artifactPaths: string[];
  artifactMetadata: Record<string, unknown>;
  deliveryStatus: DeliveryStatus;
  deliveredAt: string | null;
  deliveryToken: string | null;
  ledgerEntryId: string | null;
  createdAt: string;
  updatedAt: string;
}

const VALID_JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  created: ['queued', 'cancelled', 'failed'],
  queued: ['executing', 'cancelled', 'failed'],
  executing: ['awaiting_review', 'failed'],
  awaiting_review: ['delivered', 'failed'],
  delivered: [],
  failed: [],
  cancelled: ['refunded'],
  refunded: [],
};

export class JobManager {
  private db: RevenueDatabase;
  private artifactsDir: string;

  constructor(db?: RevenueDatabase) {
    this.db = db || getRevenueDatabase();
    this.artifactsDir = path.join(process.cwd(), 'artifacts', 'customer-jobs');
  }

  /**
   * Create a new customer job (before payment).
   * Returns the job with status 'created' and payment_status 'unpaid'.
   */
  async createJob(input: {
    customerEmail: string;
    customerName?: string;
    product: string;
    requestText: string;
    requirements?: Record<string, unknown>;
    priceCents: number;
    currency?: string;
  }): Promise<CustomerJob> {
    const jobId = `job_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    await this.db.insert('customer_jobs', {
      job_id: jobId,
      customer_id: null,
      customer_email: input.customerEmail,
      customer_name: input.customerName || null,
      product: input.product,
      request_text: input.requestText,
      requirements: JSON.stringify(input.requirements || {}),
      price_cents: input.priceCents,
      currency: input.currency || 'usd',
      payment_status: 'unpaid',
      job_status: 'created',
      execution_status: 'pending',
      intervention_status: 'none',
      verification_status: 'pending',
      artifact_paths: [],
      artifact_metadata: JSON.stringify({}),
      delivery_status: 'pending',
      created_at: now,
      updated_at: now,
    });

    await this.recordEvent(jobId, 'job_created', 'system', null, 'created', { product: input.product, priceCents: input.priceCents });

    return (await this.getJob(jobId))!;
  }

  /**
   * Link a Stripe checkout session to a job.
   * Called when checkout is created but payment not yet confirmed.
   */
  async linkCheckoutSession(jobId: string, sessionId: string): Promise<void> {
    await this.db.update('customer_jobs',
      { stripe_checkout_session_id: sessionId, payment_status: 'pending', updated_at: new Date().toISOString() },
      'job_id = $1', [jobId]);
    await this.recordEvent(jobId, 'checkout_session_created', 'system', 'created', 'created', { sessionId });
  }

  /**
   * Confirm payment for a job from a verified Stripe webhook event.
   * This is the ONLY path that sets payment_status to 'paid'.
   * Idempotent: if already paid, returns the existing job.
   */
  async confirmPayment(input: {
    jobId: string;
    stripeEventId: string;
    stripePaymentIntentId?: string;
    ledgerEntryId?: string;
  }): Promise<CustomerJob> {
    const job = await this.getJob(input.jobId);
    if (!job) throw new Error(`Job not found: ${input.jobId}`);

    // Idempotency: already paid
    if (job.paymentStatus === 'paid') {
      return job;
    }

    // Idempotency: already processed this Stripe event
    if (job.stripeEventId === input.stripeEventId) {
      return job;
    }

    const now = new Date().toISOString();
    await this.db.update('customer_jobs', {
      payment_status: 'paid',
      stripe_event_id: input.stripeEventId,
      stripe_payment_intent_id: input.stripePaymentIntentId || null,
      paid_at: now,
      job_status: 'queued',
      ledger_entry_id: input.ledgerEntryId || null,
      updated_at: now,
    }, 'job_id = $1', [input.jobId]);

    await this.recordEvent(input.jobId, 'payment_confirmed', 'stripe_webhook', job.jobStatus, 'queued', {
      stripeEventId: input.stripeEventId,
      paymentIntentId: input.stripePaymentIntentId,
    });

    return (await this.getJob(input.jobId))!;
  }

  /**
   * Start execution of a queued job.
   */
  async startExecution(jobId: string): Promise<CustomerJob> {
    const job = await this.getJob(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    if (job.jobStatus !== 'queued') throw new Error(`Job ${jobId} is not queued (status: ${job.jobStatus})`);

    const now = new Date().toISOString();
    await this.db.update('customer_jobs', {
      job_status: 'executing',
      execution_status: 'running',
      execution_started_at: now,
      updated_at: now,
    }, 'job_id = $1', [jobId]);

    await this.recordEvent(jobId, 'execution_started', 'heidi', 'queued', 'executing', {});
    return (await this.getJob(jobId))!;
  }

  /**
   * Complete execution — artifacts produced, awaiting human review.
   */
  async completeExecution(jobId: string, artifacts: { path: string; metadata?: Record<string, unknown> }[]): Promise<CustomerJob> {
    const job = await this.getJob(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    const now = new Date().toISOString();
    const paths = artifacts.map(a => a.path);
    const metadata: Record<string, unknown> = {};
    for (const a of artifacts) {
      if (a.metadata) {
        metadata[path.basename(a.path)] = a.metadata;
      }
    }

    await this.db.update('customer_jobs', {
      job_status: 'awaiting_review',
      execution_status: 'completed',
      execution_completed_at: now,
      artifact_paths: paths,
      artifact_metadata: JSON.stringify(metadata),
      updated_at: now,
    }, 'job_id = $1', [jobId]);

    await this.recordEvent(jobId, 'execution_completed', 'heidi', 'executing', 'awaiting_review', { artifactCount: paths.length });
    return (await this.getJob(jobId))!;
  }

  /**
   * Fail execution.
   */
  async failExecution(jobId: string, error: string): Promise<CustomerJob> {
    const now = new Date().toISOString();
    await this.db.update('customer_jobs', {
      job_status: 'failed',
      execution_status: 'failed',
      execution_error: error,
      execution_completed_at: now,
      updated_at: now,
    }, 'job_id = $1', [jobId]);

    await this.recordEvent(jobId, 'execution_failed', 'heidi', null, 'failed', { error });
    return (await this.getJob(jobId))!;
  }

  /**
   * Human approves the artifact for delivery.
   */
  async approveForDelivery(jobId: string, approvedBy: string, notes?: string): Promise<CustomerJob> {
    const job = await this.getJob(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    if (job.jobStatus !== 'awaiting_review') throw new Error(`Job ${jobId} is not awaiting review`);

    const deliveryToken = randomUUID().replace(/-/g, '');
    const now = new Date().toISOString();
    await this.db.update('customer_jobs', {
      job_status: 'delivered',
      verification_status: 'verified',
      verification_notes: notes || 'Approved by human',
      delivery_status: 'delivered',
      delivered_at: now,
      delivery_token: deliveryToken,
      updated_at: now,
    }, 'job_id = $1', [jobId]);

    await this.recordEvent(jobId, 'delivery_approved', approvedBy, 'awaiting_review', 'delivered', { notes, deliveryToken });
    return (await this.getJob(jobId))!;
  }

  /**
   * Request human intervention during execution.
   */
  async requestIntervention(jobId: string, interventionId: string): Promise<CustomerJob> {
    await this.db.update('customer_jobs', {
      intervention_status: 'requested',
      intervention_id: interventionId,
      updated_at: new Date().toISOString(),
    }, 'job_id = $1', [jobId]);

    await this.recordEvent(jobId, 'intervention_requested', 'heidi', null, null, { interventionId });
    return (await this.getJob(jobId))!;
  }

  /**
   * Cancel a job.
   */
  async cancelJob(jobId: string, reason: string): Promise<CustomerJob> {
    const now = new Date().toISOString();
    await this.db.update('customer_jobs', {
      job_status: 'cancelled',
      updated_at: now,
    }, 'job_id = $1', [jobId]);

    await this.recordEvent(jobId, 'job_cancelled', 'system', null, 'cancelled', { reason });
    return (await this.getJob(jobId))!;
  }

  /**
   * Mark a job as refunded.
   */
  async refundJob(jobId: string, reason: string): Promise<CustomerJob> {
    const now = new Date().toISOString();
    await this.db.update('customer_jobs', {
      job_status: 'refunded',
      payment_status: 'refunded',
      updated_at: now,
    }, 'job_id = $1', [jobId]);

    await this.recordEvent(jobId, 'job_refunded', 'system', null, 'refunded', { reason });
    return (await this.getJob(jobId))!;
  }

  /**
   * Get a job by ID.
   */
  async getJob(jobId: string): Promise<CustomerJob | null> {
    const row = await this.db.queryOne('SELECT * FROM customer_jobs WHERE job_id = $1', [jobId]);
    if (!row) return null;
    return this.rowToJob(row);
  }

  /**
   * Get a job by Stripe checkout session ID.
   */
  async getJobBySessionId(sessionId: string): Promise<CustomerJob | null> {
    const row = await this.db.queryOne('SELECT * FROM customer_jobs WHERE stripe_checkout_session_id = $1', [sessionId]);
    if (!row) return null;
    return this.rowToJob(row);
  }

  /**
   * Get jobs by status.
   */
  async getJobsByStatus(status: JobStatus): Promise<CustomerJob[]> {
    const rows = await this.db.query('SELECT * FROM customer_jobs WHERE job_status = $1 ORDER BY created_at ASC', [status]);
    return rows.map(r => this.rowToJob(r));
  }

  /**
   * Get the next queued job (FIFO).
   */
  async getNextQueuedJob(): Promise<CustomerJob | null> {
    const rows = await this.db.query("SELECT * FROM customer_jobs WHERE job_status = 'queued' ORDER BY paid_at ASC LIMIT 1");
    if (rows.length === 0) return null;
    return this.rowToJob(rows[0]);
  }

  /**
   * Get all job events for audit trail.
   */
  async getJobEvents(jobId: string): Promise<Record<string, unknown>[]> {
    return this.db.query('SELECT * FROM customer_job_events WHERE job_id = $1 ORDER BY created_at ASC', [jobId]);
  }

  /**
   * Get the artifacts directory for storing produced files.
   */
  getArtifactsDir(): string {
    return this.artifactsDir;
  }

  /**
   * Ensure the artifacts directory exists for a job.
   */
  ensureJobArtifactDir(jobId: string): string {
    const dir = path.join(this.artifactsDir, jobId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // ─── Private helpers ───

  private async recordEvent(
    jobId: string,
    eventType: string,
    actor: string,
    fromState: string | null,
    toState: string | null,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.db.insert('customer_job_events', {
      job_id: jobId,
      event_type: eventType,
      actor,
      from_state: fromState,
      to_state: toState,
      details: JSON.stringify(details),
    });
  }

  private rowToJob(row: Record<string, unknown>): CustomerJob {
    return {
      jobId: row.job_id as string,
      customerId: (row.customer_id as string) || null,
      customerEmail: row.customer_email as string,
      customerName: (row.customer_name as string) || null,
      product: row.product as string,
      requestText: row.request_text as string,
      requirements: typeof row.requirements === 'string' ? JSON.parse(row.requirements) : (row.requirements as Record<string, unknown>) || {},
      priceCents: row.price_cents as number,
      currency: row.currency as string,
      paymentStatus: row.payment_status as PaymentStatus,
      stripeCheckoutSessionId: (row.stripe_checkout_session_id as string) || null,
      stripePaymentIntentId: (row.stripe_payment_intent_id as string) || null,
      stripeEventId: (row.stripe_event_id as string) || null,
      paidAt: (row.paid_at as string) || null,
      jobStatus: row.job_status as JobStatus,
      executionStatus: row.execution_status as ExecutionStatus,
      executionStartedAt: (row.execution_started_at as string) || null,
      executionCompletedAt: (row.execution_completed_at as string) || null,
      executionError: (row.execution_error as string) || null,
      interventionStatus: (row.intervention_status as string) as CustomerJob['interventionStatus'],
      interventionId: (row.intervention_id as string) || null,
      verificationStatus: row.verification_status as VerificationStatus,
      verificationNotes: (row.verification_notes as string) || null,
      artifactPaths: Array.isArray(row.artifact_paths) ? row.artifact_paths as string[] : [],
      artifactMetadata: typeof row.artifact_metadata === 'string' ? JSON.parse(row.artifact_metadata) : (row.artifact_metadata as Record<string, unknown>) || {},
      deliveryStatus: row.delivery_status as DeliveryStatus,
      deliveredAt: (row.delivered_at as string) || null,
      deliveryToken: (row.delivery_token as string) || null,
      ledgerEntryId: (row.ledger_entry_id as string) || null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}

// Singleton
let jobManagerInstance: JobManager | null = null;
export function getJobManager(): JobManager {
  if (!jobManagerInstance) jobManagerInstance = new JobManager();
  return jobManagerInstance;
}
