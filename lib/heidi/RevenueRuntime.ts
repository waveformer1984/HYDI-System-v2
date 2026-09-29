/**
 * HEIDI Revenue Runtime — HYDI 4, Phase H
 *
 * The governed bridge that advances a durable commercial offer one step
 * per dispatch. Dispatched through the Phase-G MissionRunner — the
 * cognitive cycle never waits for payment or fulfillment.
 *
 * The full lifecycle this drives (via CommercialBridge transitions, so
 * the Control Tower fold stays honest):
 *
 *   CHECKOUT_READY
 *     → AUTHORIZATION_REQUIRED   (human boundary: customer identity or
 *                                 live-transaction authorization needed)
 *     → OFFER_BLOCKED            (structural gap — NOT_WIRED reasons)
 *     → PAYMENT_PENDING          (checkout session exists — job created,
 *                                 idempotent on offerId)
 *     → PAID                     (webhook wrote verified payment)
 *     → FULFILLMENT_PENDING      (job queued/executing/awaiting_review)
 *     → DELIVERED                (artifact delivered, QA approved)
 *     → RECONCILING → RECONCILED (RevenueReconciler: CONSISTENT)
 *     → REVENUE_PROVEN           (ProofEngine claim confirms the chain)
 *
 * Boundaries that are never crossed autonomously:
 *   - live payment: requires LiveTransactionAuthorization (unchanged)
 *   - no Stripe configured: OFFER_BLOCKED, no external call made
 *   - no customer identity: AUTHORIZATION_REQUIRED, escalated
 *   - disabled/test mode stays honest: cs_test_ sessions are recorded
 *     as test-mode and can never reach REVENUE_PROVEN
 *
 * Idempotency: a job is bound to its offer via requirements.offerId —
 * re-dispatch, restart, or retry finds the existing job and continues
 * the lifecycle rather than duplicating the consequential action.
 */

import type { Pool } from 'pg';
import {
  collectOffers,
  transitionOffer,
  type CommercialOffer,
  type CommercialStage,
} from './CommercialBridge';
import { getStripeMode } from '../revenue/stripe-mode';
import { classifyFailure } from './MissionLifecycle';

/** Minimal seams — injected so tests never touch Stripe or the job DB. */
export interface RevenueRuntimeDeps {
  /** Create a customer job. Defaults throw not-wired unless injected. */
  createJob?: (input: {
    customerEmail: string;
    customerName?: string;
    product: string;
    requestText: string;
    requirements?: Record<string, unknown>;
    priceCents: number;
    currency?: string;
  }) => Promise<{ jobId: string }>;
  /** Create a Stripe checkout session for the job's offer/product. */
  createCheckoutSession?: (input: {
    offerId: string;
    customerEmail: string;
    customerName?: string;
    opportunityId?: string;
    successUrl: string;
    cancelUrl: string;
    authorizationId?: string;
  }) => Promise<{ sessionId: string; url: string } | { error: string }>;
  /** Bind the checkout session to the job — the webhook resolves jobs by session id. */
  linkCheckoutSession?: (jobId: string, sessionId: string) => Promise<void>;
  /** Reconcile a job's full evidence chain. */
  reconcileJob?: (jobId: string) => Promise<{ state: string }>;
  /** Current pending live-transaction authorizations (live-mode gate). */
  pendingLiveAuthorizations?: () => Array<{ customerEmail?: string; amountCents?: number; currency?: string }>;
}

export interface AdvanceResult {
  offerId: string;
  previousStage: CommercialStage;
  newStage: CommercialStage;
  action: string;
  /** 'boundary' = human authorization needed; 'blocked' = structural gap. */
  boundary: 'none' | 'human_authorization' | 'not_wired' | 'governance';
  detail: string;
  jobId?: string;
}

const TERMINAL: ReadonlySet<CommercialStage> = new Set(['RECONCILED', 'REVENUE_PROVEN', 'OFFER_BLOCKED']);

export class RevenueRuntime {
  private pool: Pick<Pool, 'query'>;
  private deps: RevenueRuntimeDeps;

  constructor(pool: Pick<Pool, 'query'>, deps: RevenueRuntimeDeps = {}) {
    this.pool = pool;
    this.deps = deps;
  }

  /** Find the job bound to an offer — deterministic idempotency key. */
  private async findJobByOffer(offerId: string): Promise<{ job_id: string; payment_status: string; job_status: string; delivery_status: string | null; stripe_checkout_session_id: string | null } | null> {
    const { rows } = await this.pool.query(
      `SELECT job_id, payment_status, job_status, delivery_status, stripe_checkout_session_id
         FROM customer_jobs
        WHERE requirements->>'offerId' = $1 OR job_id IN (
          SELECT (payload->>'jobId') FROM heidi_events
           WHERE event_type='commercial_offer_transition' AND payload->>'offerId' = $1
             AND payload->>'jobId' IS NOT NULL)
        ORDER BY created_at DESC LIMIT 1`,
      [offerId],
    ).catch(() => ({ rows: [] as Array<Record<string, never>> }));
    return (rows[0] as never) ?? null;
  }

  /**
   * Advance one offer (or all actionable offers) by exactly one stage.
   * Every returned result is a transition that already happened — the
   * stage name in the result is durable, not aspirational.
   */
  async advance(params: { offerId?: string; advanceAll?: boolean; customerEmail?: string; actor?: string }): Promise<AdvanceResult[]> {
    const actor = params.actor ?? 'revenue-runtime';
    const offers = await collectOffers(this.pool);
    const targets = params.offerId
      ? offers.filter(o => o.offerId === params.offerId)
      : params.advanceAll
        ? offers.filter(o => !TERMINAL.has(o.stage))
        : [];

    if (targets.length === 0) {
      return [{ offerId: params.offerId ?? 'none', previousStage: 'DISCOVERED', newStage: 'DISCOVERED', action: 'noop', boundary: 'none', detail: params.offerId ? 'offer not found' : 'no actionable offers' }];
    }

    const results: AdvanceResult[] = [];
    for (const offer of targets) {
      results.push(await this.step(offer, params, actor));
    }
    return results;
  }

  private async step(offer: CommercialOffer, params: { customerEmail?: string }, actor: string): Promise<AdvanceResult> {
    const base = { offerId: offer.offerId, previousStage: offer.stage, action: 'noop' };

    switch (offer.stage) {
      // ── Qualification gate already passed at prepareOffer; move to ready ──
      case 'OFFER_PREPARED': {
        const { checkoutPrereqs } = await import('./CommercialBridge');
        const prereqs = checkoutPrereqs(offer.product);
        const newStage: CommercialStage = prereqs.ready ? 'CHECKOUT_READY' : 'OFFER_BLOCKED';
        const reason = prereqs.ready ? 'downstream path verified' : prereqs.blockers.join('; ');
        await transitionOffer(this.pool, offer.offerId, newStage, actor, reason);
        return { ...base, newStage, action: 'evaluate_prereqs', boundary: prereqs.ready ? 'none' : 'not_wired', detail: reason };
      }

      // ── The payment boundary ────────────────────────────────────────────
      case 'CHECKOUT_READY': {
        const customerEmail = params.customerEmail;
        const mode = getStripeMode();

        if (!customerEmail) {
          await transitionOffer(this.pool, offer.offerId, 'AUTHORIZATION_REQUIRED', actor,
            'customer identity required — the system does not invent customers');
          return { ...base, newStage: 'AUTHORIZATION_REQUIRED', action: 'boundary', boundary: 'human_authorization', detail: 'no customer identity on offer — a checkout cannot be created for a customer that does not exist' };
        }
        if (mode.mode === 'disabled') {
          await transitionOffer(this.pool, offer.offerId, 'OFFER_BLOCKED', actor, 'no Stripe key configured — payment path is NOT_WIRED');
          return { ...base, newStage: 'OFFER_BLOCKED', action: 'blocked', boundary: 'not_wired', detail: 'STRIPE_SECRET_KEY absent — no checkout can be created' };
        }
        if (mode.mode === 'live') {
          const auths = this.deps.pendingLiveAuthorizations?.() ?? [];
          const auth = auths.find(a => a.customerEmail === customerEmail && a.amountCents === offer.priceCents && a.currency === offer.currency);
          if (!auth) {
            await transitionOffer(this.pool, offer.offerId, 'AUTHORIZATION_REQUIRED', actor,
              'live-mode payment requires a pending LiveTransactionAuthorization — never authorized autonomously');
            return { ...base, newStage: 'AUTHORIZATION_REQUIRED', action: 'boundary', boundary: 'human_authorization', detail: 'live mode: no matching LiveTransactionAuthorization — human must authorize this transaction' };
          }
        }

        // Idempotent job creation: the offer→job binding is deterministic.
        const existing = await this.findJobByOffer(offer.offerId);
        if (existing) {
          // Repair path: a job with no linked session means a crash between
          // job creation and checkout — create the session now and link it.
          // Still idempotent: the job row is the binding, not the session.
          if (!existing.stripe_checkout_session_id && this.deps.createCheckoutSession && this.deps.linkCheckoutSession) {
            const session = await this.deps.createCheckoutSession({
              offerId: offer.product,
              customerEmail,
              opportunityId: offer.opportunityId,
              successUrl: 'http://localhost:3000/checkout/success?session_id={CHECKOUT_SESSION_ID}',
              cancelUrl: 'http://localhost:3000/checkout/cancel',
            });
            if (!('error' in session)) {
              await this.deps.linkCheckoutSession(existing.job_id, session.sessionId);
              return { ...base, newStage: offer.stage, action: 'idempotent_repair', boundary: 'none', detail: `job ${existing.job_id} existed unlinked — repaired: checkout session ${session.sessionId} bound (${mode.mode})`, jobId: existing.job_id };
            }
          }
          return { ...base, newStage: offer.stage, action: 'idempotent_resume', boundary: 'none', detail: `job ${existing.job_id} already exists for this offer — continuing, not duplicating`, jobId: existing.job_id };
        }
        if (!this.deps.createJob || !this.deps.createCheckoutSession) {
          return { ...base, newStage: offer.stage, action: 'blocked', boundary: 'not_wired', detail: 'JobManager/StripeBridge not wired into this runtime — REFUSED (not simulated)' };
        }

        const job = await this.deps.createJob({
          customerEmail,
          product: offer.product,
          requestText: `Commercial offer ${offer.offerId} — ${offer.opportunityTitle}`,
          requirements: { offerId: offer.offerId, opportunityId: offer.opportunityId, product: offer.product },
          priceCents: offer.priceCents,
          currency: offer.currency,
        });
        const session = await this.deps.createCheckoutSession({
          offerId: offer.product,
          customerEmail,
          opportunityId: offer.opportunityId,
          successUrl: 'http://localhost:3000/checkout/success?session_id={CHECKOUT_SESSION_ID}',
          cancelUrl: 'http://localhost:3000/checkout/cancel',
        });
        if ('error' in session) {
          return { ...base, newStage: offer.stage, action: 'blocked', boundary: 'not_wired', detail: `checkout session failed: ${session.error}`, jobId: job.jobId };
        }
        // Bind session→job: api/webhooks/stripe.js resolves the job by
        // stripe_checkout_session_id — skipping this orphans the payment.
        await this.deps.linkCheckoutSession?.(job.jobId, session.sessionId);
        await transitionOffer(this.pool, offer.offerId, 'PAYMENT_PENDING', actor,
          `job ${job.jobId} bound via requirements.offerId; checkout session ${session.sessionId} (${mode.mode} mode)`);
        return { ...base, newStage: 'PAYMENT_PENDING', action: 'checkout_created', boundary: 'none', detail: `${mode.mode}-mode checkout session ${session.sessionId}`, jobId: job.jobId };
      }

      // ── Payment observed (webhook wrote it — we only read) ──────────────
      case 'PAYMENT_PENDING': {
        const job = await this.findJobByOffer(offer.offerId);
        if (!job) return { ...base, newStage: offer.stage, action: 'noop', boundary: 'none', detail: 'no job bound yet' };
        if (job.payment_status !== 'paid') {
          return { ...base, newStage: offer.stage, action: 'observe', boundary: 'none', detail: `payment still ${job.payment_status} — waiting for verified webhook`, jobId: job.job_id };
        }
        await transitionOffer(this.pool, offer.offerId, 'PAID', actor, `verified webhook payment confirmed for job ${job.job_id}`);
        return { ...base, newStage: 'PAID', action: 'payment_confirmed', boundary: 'none', detail: `job ${job.job_id} paid`, jobId: job.job_id };
      }
      case 'PAID': {
        const job = await this.findJobByOffer(offer.offerId);
        if (!job) return { ...base, newStage: offer.stage, action: 'noop', boundary: 'none', detail: 'paid offer has no job row — inconsistent' };
        if (job.job_status === 'delivered') {
          await transitionOffer(this.pool, offer.offerId, 'DELIVERED', actor, `job ${job.job_id} delivered`);
          return { ...base, newStage: 'DELIVERED', action: 'fulfilled', boundary: 'none', detail: `job ${job.job_id} delivered`, jobId: job.job_id };
        }
        await transitionOffer(this.pool, offer.offerId, 'FULFILLMENT_PENDING', actor, `job ${job.job_id} status=${job.job_status} — executor poller owns fulfillment`);
        return { ...base, newStage: 'FULFILLMENT_PENDING', action: 'observe_fulfillment', boundary: 'none', detail: `job ${job.job_id} job_status=${job.job_status}`, jobId: job.job_id };
      }
      case 'FULFILLMENT_PENDING': {
        const job = await this.findJobByOffer(offer.offerId);
        if (!job) return { ...base, newStage: offer.stage, action: 'noop', boundary: 'none', detail: 'no job bound' };
        if (job.job_status === 'delivered' || job.delivery_status === 'delivered') {
          await transitionOffer(this.pool, offer.offerId, 'DELIVERED', actor, `job ${job.job_id} delivered`);
          return { ...base, newStage: 'DELIVERED', action: 'fulfilled', boundary: 'none', detail: `job ${job.job_id} delivered`, jobId: job.job_id };
        }
        return { ...base, newStage: offer.stage, action: 'observe', boundary: 'none', detail: `job ${job.job_id} still ${job.job_status} — fulfillment in progress`, jobId: job.job_id };
      }

      // ── Reconciliation — deterministic match, never inferred ─────────────
      case 'DELIVERED': {
        const job = await this.findJobByOffer(offer.offerId);
        if (!job) return { ...base, newStage: offer.stage, action: 'noop', boundary: 'none', detail: 'no job bound' };
        if (!this.deps.reconcileJob) {
          return { ...base, newStage: offer.stage, action: 'blocked', boundary: 'not_wired', detail: 'RevenueReconciler not wired — reconciliation REFUSED', jobId: job.job_id };
        }
        await transitionOffer(this.pool, offer.offerId, 'RECONCILING', actor, `reconciling job ${job.job_id}`);
        const result = await this.deps.reconcileJob(job.job_id);
        if (result.state === 'CONSISTENT') {
          await transitionOffer(this.pool, offer.offerId, 'RECONCILED', actor, `job ${job.job_id} reconciled CONSISTENT — offer/job/payment/ledger all correspond`);
          return { ...base, newStage: 'RECONCILED', action: 'reconciled', boundary: 'none', detail: `job ${job.job_id} CONSISTENT`, jobId: job.job_id };
        }
        // MISMATCH / INCOMPLETE / BLOCKED — never advance on doubt.
        await transitionOffer(this.pool, offer.offerId, 'RECONCILING', actor, `reconciliation returned ${result.state} — evidence chain incomplete, NOT advancing`);
        return { ...base, newStage: 'RECONCILING', action: 'reconciliation_pending', boundary: 'none', detail: `job ${job.job_id} reconcile=${result.state}`, jobId: job.job_id };
      }
      case 'RECONCILING': {
        const job = await this.findJobByOffer(offer.offerId);
        if (!job || !this.deps.reconcileJob) {
          return { ...base, newStage: offer.stage, action: 'noop', boundary: job ? 'not_wired' : 'none', detail: job ? 'reconciler not wired' : 'no job bound', jobId: job?.job_id };
        }
        const result = await this.deps.reconcileJob(job.job_id);
        if (result.state === 'CONSISTENT') {
          await transitionOffer(this.pool, offer.offerId, 'RECONCILED', actor, `job ${job.job_id} reconciled CONSISTENT`);
          return { ...base, newStage: 'RECONCILED', action: 'reconciled', boundary: 'none', detail: `job ${job.job_id} CONSISTENT`, jobId: job.job_id };
        }
        return { ...base, newStage: offer.stage, action: 'observe', boundary: 'none', detail: `reconcile=${result.state} — waiting for evidence`, jobId: job.job_id };
      }

      // RECONCILED → REVENUE_PROVEN is asserted by ProofEngine, not this
      // runtime — the runtime never upgrades itself to "proven".
      default:
        return { ...base, newStage: offer.stage, action: 'noop', boundary: 'none', detail: `stage ${offer.stage} has no autonomous transition` };
    }
  }
}

/** Error classification helper for the runner path. */
export function classifyRevenueError(reason: string): 'transient' | 'deterministic' | 'governance' {
  return classifyFailure(reason);
}
