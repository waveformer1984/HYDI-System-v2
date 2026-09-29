/**
 * HEIDI Proof Engine — HYDI 4, Phase D
 *
 * Claims have provenance. A claim is never "true" because an event name
 * sounds right — it is true because the evidence chain bottoms out in a
 * durable, timestamped row, and it is REFUSED when the chain is missing,
 * stale, or fails to prove the claim. The engine's job is to answer
 * "how do you know?" honestly: PROVEN with the chain, or REFUSED with
 * the gap.
 *
 *   claim → evidence[] → verdict
 *
 * Every verdict carries:
 *   - provenance  — the durable rows/events that support it
 *   - freshness   — how old the newest supporting evidence is (ms)
 *   - confidence  — 0..1 derived from evidence completeness
 *   - refused     — explicit refusal when evidence is insufficient
 *
 * Identity: HYDI is a machine that refuses to confuse intention,
 * belief, and evidence. "We produced a goal" is not "we succeeded";
 * "payment recorded" is not "revenue verified".
 */

import type { Pool } from 'pg';

export type ClaimVerdict = 'PROVEN' | 'REFUSED' | 'UNKNOWN';

export interface EvidenceLink {
  /** What kind of durable thing this is. */
  kind: 'event' | 'row' | 'goal' | 'offer' | 'payment' | 'reconciliation' | 'observation';
  /** Durable identity — event id, row id, goal id, table+pk. */
  ref: string;
  /** Human-readable summary of what this link proves. */
  summary: string;
  at?: string;
}

export interface ProofResult {
  claim: string;
  verdict: ClaimVerdict;
  /** 0..1 — fraction of required evidence present. */
  confidence: number;
  /** ms since the newest supporting evidence, or null if none. */
  freshnessMs: number | null;
  /** The chain — empty when refused. */
  provenance: EvidenceLink[];
  /** What evidence was missing — populated when refused. */
  gap?: string;
  evaluatedAt: string;
}

interface ClaimEvaluator {
  /** Required evidence links for PROVEN. */
  required: EvidenceLink['kind'][];
  evaluate: (pool: Pool) => Promise<{ links: EvidenceLink[]; newestAt?: string; gap?: string }>;
}

/**
 * The claim catalog — bounded, inspectable. A claim not in the catalog
 * is UNKNOWN, never PROVEN.
 */
const CLAIMS: Record<string, ClaimEvaluator> = {
  /**
   * daemon_alive — a cognitive_cycle event (timeout heartbeat OR success)
   * written within 3× the configured cycle interval proves the loop is
   * executing work, not just that a process exists.
   */
  daemon_alive: {
    required: ['event'],
    evaluate: async (pool) => {
      const r = await pool.query(
        `SELECT created_at, payload->>'outcome' outcome FROM heidi_events
         WHERE event_type = 'cognitive_cycle'
         ORDER BY created_at DESC LIMIT 1`);
      const row = r.rows[0];
      if (!row) return { links: [], gap: 'no cognitive_cycle events exist' };
      const ageMs = Date.now() - new Date(row.created_at).getTime();
      const staleMs = 3 * 60_000; // 3× the 60s cadence
      if (ageMs > staleMs) {
        return {
          links: [{ kind: 'event', ref: 'cognitive_cycle', summary: `last cycle ${Math.round(ageMs / 1000)}s ago — stale`, at: row.created_at }],
          newestAt: row.created_at,
          gap: `latest cycle is ${Math.round(ageMs / 1000)}s old (stale threshold ${staleMs / 1000}s)`,
        };
      }
      return {
        links: [{ kind: 'event', ref: 'cognitive_cycle', summary: `cycle ${row.outcome} ${Math.round(ageMs / 1000)}s ago`, at: row.created_at }],
        newestAt: row.created_at,
      };
    },
  },

  /**
   * goals_producing — at least one heidi_goals row created within the
   * last hour by the mission producer proves production is flowing.
   */
  goals_producing: {
    required: ['goal'],
    evaluate: async (pool) => {
      const r = await pool.query(
        `SELECT id, created_at, context->>'producerKey' pk FROM heidi_goals
         WHERE context->>'producedBy' = 'heidi-mission-producer'
         ORDER BY created_at DESC LIMIT 1`);
      const row = r.rows[0];
      if (!row) return { links: [], gap: 'no produced goals found' };
      const ageMs = Date.now() - new Date(row.created_at).getTime();
      const staleMs = 60 * 60_000;
      if (ageMs > staleMs) {
        return {
          links: [{ kind: 'goal', ref: row.id, summary: `latest produced goal ${Math.round(ageMs / 60000)}min ago`, at: row.created_at }],
          newestAt: row.created_at,
          gap: `no produced goal in ${staleMs / 60000}min`,
        };
      }
      return {
        links: [{ kind: 'goal', ref: row.id, summary: `goal '${row.pk}' produced ${Math.round(ageMs / 60000)}min ago`, at: row.created_at }],
        newestAt: row.created_at,
      };
    },
  },

  /**
   * revenue_verified — the ONLY proof path is a verified revenue_ledger
   * entry from a live-mode Stripe event. Checkout, payment intent,
   * test-mode rows (evt_test_, evt_processed_, evt_idempotent_, test
   * customers, sk_test_ system mode) are not revenue. A claim is REFUSED
   * when the mode is not live — test-mode revenue cannot exist.
   */
  revenue_verified: {
    required: ['reconciliation'],
    evaluate: async (pool) => {
      const { getStripeMode } = await import('../revenue/stripe-mode');
      const mode = getStripeMode();
      if (mode.mode !== 'live') {
        return {
          links: [],
          gap: `system is in ${mode.mode} mode — live revenue cannot exist; verified test entries are not revenue`,
        };
      }
      const r = await pool.query(
        `SELECT ledger_entry_id, amount_gross, currency, verified_at, recorded_at
         FROM revenue_ledger
         WHERE verified = true
           AND stripe_event_id NOT LIKE 'evt_test_%'
           AND stripe_event_id NOT LIKE 'evt_processed_%'
           AND stripe_event_id NOT LIKE 'evt_idempotent_%'
           AND COALESCE(metadata->>'customerEmail','') NOT LIKE 'heidi-test%'
         ORDER BY recorded_at DESC LIMIT 1`);
      const row = r.rows[0];
      if (!row) {
        return { links: [], gap: 'no verified live-mode revenue_ledger entry — checkout/payment/test-mode are not revenue' };
      }
      return {
        links: [{ kind: 'reconciliation', ref: row.ledger_entry_id, summary: `$${(row.amount_gross / 100).toFixed(2)} ${row.currency} verified ${row.verified_at ?? row.recorded_at}`, at: row.verified_at ?? row.recorded_at }],
        newestAt: row.verified_at ?? row.recorded_at,
      };
    },
  },

  /**
   * revenue_proven — the strongest claim the engine can make: a durable
   * offer chain reached RECONCILED, the bound job was delivered, and a
   * verified LIVE-mode ledger entry exists for it. All three must link
   * by durable identifiers (offerId → job requirements.offerId → ledger
   * metadata.jobId / stripe ids) — never inferred by amount or timing.
   * Test-mode and synthetic records are excluded at the ID level.
   */
  revenue_proven: {
    required: ['offer', 'payment', 'reconciliation'],
    evaluate: async (pool) => {
      const { getStripeMode } = await import('../revenue/stripe-mode');
      const mode = getStripeMode();
      if (mode.mode !== 'live') {
        return { links: [], gap: `system is in ${mode.mode} mode — no live revenue can exist; test/simulated payments cannot be proven as revenue` };
      }

      // A RECONCILED commercial offer with a bound job.
      const offerQ = await pool.query(
        `SELECT payload->>'offerId' offer_id, payload->>'jobId' job_id, created_at
           FROM heidi_events
          WHERE division='commercial' AND event_type='commercial_offer_transition'
            AND payload->>'newStage' IN ('RECONCILED','REVENUE_PROVEN')
          ORDER BY created_at DESC LIMIT 1`);
      const offerRow = offerQ.rows[0];
      if (!offerRow) {
        return { links: [], gap: 'no offer has reached RECONCILED — reconciliation evidence absent' };
      }
      const links: EvidenceLink[] = [{ kind: 'offer', ref: offerRow.offer_id, summary: 'offer reached RECONCILED', at: offerRow.created_at }];
      const newestAt = offerRow.created_at;

      // The bound job must exist, be delivered, and be paid.
      let jobId: string | null = offerRow.job_id;
      if (!jobId) {
        const j = await pool.query(
          `SELECT job_id FROM customer_jobs WHERE requirements->>'offerId' = $1 ORDER BY created_at DESC LIMIT 1`,
          [offerRow.offer_id]);
        jobId = j.rows[0]?.job_id ?? null;
      }
      if (!jobId) {
        return { links, newestAt, gap: 'reconciled offer has no bound customer_job — chain breaks at fulfillment evidence' };
      }
      const jobQ = await pool.query(
        `SELECT job_id, job_status, payment_status, delivery_status, stripe_checkout_session_id
           FROM customer_jobs WHERE job_id = $1`, [jobId]);
      const job = jobQ.rows[0];
      if (!job || job.payment_status !== 'paid' || job.job_status !== 'delivered') {
        return { links, newestAt, gap: `job ${jobId} is ${job ? `${job.job_status}/${job.payment_status}` : 'missing'} — payment+delivery not both proven` };
      }
      links.push({ kind: 'payment', ref: job.stripe_checkout_session_id ?? job.job_id, summary: `job ${job.job_id} paid+delivered`, at: newestAt });

      // A verified ledger entry bound to this job — live IDs only.
      const led = await pool.query(
        `SELECT ledger_entry_id, amount_gross, currency, verified_at
           FROM revenue_ledger
          WHERE verified = true
            AND (metadata->>'jobId' = $1 OR stripe_payment_intent_id IN (
                   SELECT stripe_payment_intent_id FROM customer_jobs WHERE job_id = $1))
            AND stripe_event_id NOT LIKE 'evt_test_%'
            AND stripe_event_id NOT LIKE 'evt_processed_%'
            AND stripe_event_id NOT LIKE 'evt_idempotent_%'
          ORDER BY recorded_at DESC LIMIT 1`, [jobId]);
      const row = led.rows[0];
      if (!row) {
        return { links, newestAt, gap: `no verified live ledger entry bound to job ${jobId}` };
      }
      links.push({ kind: 'reconciliation', ref: row.ledger_entry_id, summary: `ledger $${(row.amount_gross / 100).toFixed(2)} ${row.currency} verified`, at: row.verified_at });
      return { links, newestAt };
    },
  },

  /**
   * checkout_ready — an offer that has been authorized AND has a payment
   * route AND executor binding. Requires the offer event chain to exist.
   */
  checkout_ready: {
    required: ['offer', 'observation'],
    evaluate: async (pool) => {
      // Fold the commercial event stream — the latest stage wins.
      const { collectOffers, EXECUTABLE_PRODUCTS } = await import('./CommercialBridge');
      const offers = await collectOffers(pool);
      const ready = offers.find(o => o.stage === 'CHECKOUT_READY' || o.stage === 'PAYMENT_PENDING');
      if (!ready) {
        return { links: [], gap: `no offer at CHECKOUT_READY or beyond (stages seen: ${offers.map(o => `${o.offerId.slice(0, 12)}=${o.stage}`).join(', ') || 'none'})` };
      }
      const links: EvidenceLink[] = [{ kind: 'offer', ref: ready.offerId, summary: `offer ${ready.stage}`, at: ready.updatedAt }];
      // Bound executor = the offer's product has a real artifact executor
      // (structural check, same predicate CommercialBridge uses).
      if (!EXECUTABLE_PRODUCTS.has(ready.product)) {
        return { links, newestAt: ready.updatedAt, gap: `product '${ready.product}' has no executor — REVENUE_PATH_NOT_WIRED` };
      }
      links.push({ kind: 'observation', ref: ready.product, summary: `executor bound via product '${ready.product}'`, at: ready.updatedAt });
      return { links, newestAt: ready.updatedAt };
    },
  },
};

export class ProofEngine {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /** List the claims this engine can evaluate. */
  listClaims(): string[] {
    return Object.keys(CLAIMS);
  }

  /**
   * Evaluate a claim. Unknown claims are UNKNOWN. Evaluation never throws —
   * a broken evaluator is a refused claim with the error as the gap.
   */
  async evaluate(claim: string): Promise<ProofResult> {
    const base = { claim, confidence: 0, freshnessMs: null, provenance: [] as EvidenceLink[], evaluatedAt: new Date().toISOString() };
    const evaluator = CLAIMS[claim];
    if (!evaluator) {
      return { ...base, verdict: 'UNKNOWN', gap: `no evaluator registered for claim '${claim}'` };
    }
    try {
      const { links, newestAt, gap } = await evaluator.evaluate(this.pool);
      const covered = new Set(links.map(l => l.kind));
      const missing = evaluator.required.filter(k => !covered.has(k));
      const confidence = links.length === 0 ? 0 : covered.size / evaluator.required.length;
      const freshnessMs = newestAt ? Date.now() - new Date(newestAt).getTime() : null;

      if (gap || missing.length > 0) {
        return { ...base, verdict: 'REFUSED', confidence, freshnessMs, provenance: links, gap: gap ?? `missing evidence kinds: ${missing.join(', ')}` };
      }
      return { ...base, verdict: 'PROVEN', confidence, freshnessMs, provenance: links };
    } catch (e) {
      return { ...base, verdict: 'REFUSED', gap: `evaluator threw: ${e instanceof Error ? e.message : 'unknown'}` };
    }
  }

  /** Evaluate every registered claim. */
  async evaluateAll(): Promise<ProofResult[]> {
    const results: ProofResult[] = [];
    for (const claim of Object.keys(CLAIMS)) {
      results.push(await this.evaluate(claim));
    }
    return results;
  }
}
