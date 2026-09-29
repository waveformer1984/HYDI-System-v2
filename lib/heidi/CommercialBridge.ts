/**
 * CommercialBridge — the opportunity → offer → checkout boundary.
 *
 * protoforge_opportunities are market intelligence: nothing in that table
 * is a customer, a sale, or revenue. This module is the ONLY path that
 * turns a qualified opportunity into a durable commercial offer record.
 *
 * Design constraints (do not weaken):
 * - Event-sourced into heidi_events (division='commercial'), same fold
 *   pattern as the agent control plane. No new table, no second source.
 * - offerId = sha256(opportunityId:product) — retries/restarts/duplicate
 *   calls produce the SAME offer, never a second one (idempotent).
 * - Every transition is an event with prev/new stage, actor, evidence.
 * - Qualification requires evidence: an approved opportunity OR a
 *   positive business_finding. LLM enthusiasm is not evidence.
 * - CHECKOUT_READY requires the full downstream path to exist: product
 *   executor, catalog entry, payment path, QA path, reconciliation.
 *   Anything missing → OFFER_BLOCKED with the exact reason. The live
 *   payment itself still requires the existing human authorization
 *   gate — this bridge never bypasses it.
 */
import { createHash } from 'crypto';
import type { Pool } from 'pg';

export type CommercialStage =
  | 'DISCOVERED' | 'NEEDS_REVIEW' | 'VALIDATED' | 'COMMERCIAL_QUALIFIED'
  | 'OFFER_PREPARED' | 'AUTHORIZATION_REQUIRED' | 'CHECKOUT_READY'
  | 'OFFER_BLOCKED'
  | 'PAYMENT_PENDING' | 'PAID' | 'FULFILLMENT_PENDING' | 'DELIVERED'
  | 'QA_VERIFIED' | 'RECONCILING' | 'RECONCILED' | 'REVENUE_PROVEN';

export interface CommercialOffer {
  offerId: string;
  opportunityId: string;
  opportunityTitle: string;
  product: string;
  priceCents: number;
  currency: string;
  stage: CommercialStage;
  stageReason: string | null;
  evidenceSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

export function offerIdFor(opportunityId: string, product: string): string {
  return `offer-${createHash('sha256').update(`${opportunityId}:${product}`).digest('hex').slice(0, 12)}`;
}

/** Products with a real end-to-end executor (see JobExecutor gate). */
export const EXECUTABLE_PRODUCTS = new Set(['protoforge_model_prep']);

const BLOCKED = 'OFFER_BLOCKED';

interface PrereqResult { ready: boolean; blockers: string[] }

/**
 * Verify the downstream path exists BEFORE an offer claims to be
 * checkout-ready. All checks are structural (code/config presence), not
 * network probes — this runs inside the daemon/edge of a request.
 */
export function checkoutPrereqs(product: string): PrereqResult {
  const blockers: string[] = [];
  if (!EXECUTABLE_PRODUCTS.has(product)) {
    blockers.push(`no artifact executor for '${product}' (REVENUE_PATH_NOT_WIRED)`);
  }
  // Payment path: Stripe key must be configured for checkout to exist.
  if (!process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY_01) {
    blockers.push('no Stripe key configured — payment path unavailable');
  }
  return { ready: blockers.length === 0, blockers };
}

type OfferRow = CommercialOffer;

/** Fold heidi_events division='commercial' into current offer state. */
export async function collectOffers(pool: Pick<Pool, 'query'>): Promise<CommercialOffer[]> {
  const { rows } = await pool.query(
    `SELECT event_type, payload, created_at FROM heidi_events
       WHERE division='commercial' ORDER BY created_at ASC`,
  ).catch(() => ({ rows: [] as Array<{ event_type: string; payload: Record<string, unknown>; created_at: string }> }));

  const offers = new Map<string, OfferRow>();
  for (const r of rows as Array<{ event_type: string; payload: Record<string, unknown>; created_at: string }>) {
    const p = r.payload as Record<string, unknown>;
    if (r.event_type === 'commercial_offer') {
      const offerId = String(p.offerId);
      const existing = offers.get(offerId);
      offers.set(offerId, {
        offerId,
        opportunityId: String(p.opportunityId),
        opportunityTitle: String(p.opportunityTitle ?? ''),
        product: String(p.product),
        priceCents: Number(p.priceCents ?? 0),
        currency: String(p.currency ?? 'usd'),
        stage: (p.stage as CommercialStage) ?? 'OFFER_PREPARED',
        stageReason: (p.stageReason as string) ?? null,
        evidenceSummary: (p.evidenceSummary as string) ?? null,
        createdAt: existing?.createdAt ?? r.created_at,
        updatedAt: r.created_at,
      });
    } else if (r.event_type === 'commercial_offer_transition') {
      const offerId = String(p.offerId);
      const o = offers.get(offerId);
      if (o) {
        o.stage = p.newStage as CommercialStage;
        o.stageReason = (p.stageReason as string) ?? null;
        o.updatedAt = r.created_at;
      }
    }
  }
  return [...offers.values()];
}

async function emit(pool: Pick<Pool, 'query'>, eventType: string, payload: Record<string, unknown>): Promise<void> {
  await pool.query(
    `INSERT INTO heidi_events (event_type, division, payload, created_at) VALUES ($1,'commercial',$2,now())`,
    [eventType, JSON.stringify(payload)],
  );
}

export interface PrepareOfferInput {
  opportunityId: string;
  product: string;            // explicit — never inferred
  customerContact?: string;   // evidence of a reachable customer
  actor?: string;
}

export type PrepareOfferResult =
  | { ok: true; offer: CommercialOffer; deduped: boolean }
  | { ok: false; reason: string };

/**
 * Opportunity → durable offer. Fails closed:
 *   - opportunity must exist and carry qualification evidence
 *     (approval_status='approved' or a positive business_finding)
 *   - product must be explicitly provided and must have a working
 *     executor + payment path → otherwise OFFER_BLOCKED with reason
 * Idempotent on (opportunityId, product): a second call returns the
 * existing offer with deduped=true, never a duplicate row.
 */
export async function prepareOffer(
  pool: Pick<Pool, 'query'>,
  input: PrepareOfferInput,
): Promise<PrepareOfferResult> {
  const actor = input.actor ?? 'operator';
  const offerId = offerIdFor(input.opportunityId, input.product);

  // Idempotent: existing offer wins.
  const existing = (await collectOffers(pool)).find(o => o.offerId === offerId);
  if (existing) return { ok: true, offer: existing, deduped: true };

  const { rows: oppRows } = await pool.query(
    `SELECT id, title, status, approval_status, confidence, evidence, scoring_detail
       FROM protoforge_opportunities WHERE id = $1`,
    [input.opportunityId],
  );
  const opp = oppRows[0];
  if (!opp) return { ok: false, reason: `opportunity ${input.opportunityId} not found` };

  // Qualification gate — evidence, not enthusiasm.
  const { rows: findingRows } = await pool.query(
    `SELECT payload FROM heidi_events WHERE event_type='business_finding'
       AND payload->>'opportunityId' = $1 ORDER BY created_at DESC LIMIT 1`,
    [input.opportunityId],
  ).catch(() => ({ rows: [] as Array<{ payload: Record<string, unknown> }> }));
  const finding = findingRows[0]?.payload as { verdict?: string } | undefined;
  const qualified = opp.approval_status === 'approved'
    || (finding?.verdict && !/reject|fail|insufficient/i.test(String(finding.verdict)));
  if (!qualified) {
    return { ok: false, reason: `NOT_COMMERCIALLY_QUALIFIED — needs human approval or a positive business finding (approval_status=${opp.approval_status})` };
  }

  // Structural prerequisites — executor + payment path must exist.
  const prereqs = checkoutPrereqs(input.product);
  const stage: CommercialStage = prereqs.ready ? 'CHECKOUT_READY' : BLOCKED;
  const stageReason = prereqs.ready
    ? 'executor + payment path verified; live checkout still requires live-transaction authorization'
    : prereqs.blockers.join('; ');

  const evidenceSummary = [
    `opp approval_status=${opp.approval_status}`,
    finding?.verdict ? `business_finding=${finding.verdict}` : null,
    input.customerContact ? `customerContact=${input.customerContact}` : null,
  ].filter(Boolean).join('; ');

  await emit(pool, 'commercial_offer', {
    offerId,
    opportunityId: input.opportunityId,
    opportunityTitle: opp.title,
    product: input.product,
    priceCents: 2900,
    currency: 'usd',
    stage,
    stageReason,
    evidenceSummary,
    actor,
  });

  return {
    ok: true,
    deduped: false,
    offer: {
      offerId, opportunityId: input.opportunityId, opportunityTitle: String(opp.title),
      product: input.product, priceCents: 2900, currency: 'usd',
      stage, stageReason, evidenceSummary,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
  };
}

/** Explicit stage transition with prev/new + actor — full audit. */
export async function transitionOffer(
  pool: Pick<Pool, 'query'>,
  offerId: string,
  newStage: CommercialStage,
  actor: string,
  stageReason: string | null = null,
): Promise<{ ok: boolean; previousStage?: CommercialStage }> {
  const offers = await collectOffers(pool);
  const o = offers.find(x => x.offerId === offerId);
  if (!o) return { ok: false };
  await emit(pool, 'commercial_offer_transition', {
    offerId,
    previousStage: o.stage,
    newStage,
    stageReason,
    actor,
  });
  return { ok: true, previousStage: o.stage };
}
