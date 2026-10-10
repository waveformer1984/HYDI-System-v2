/**
 * Payment Signal Reconciler — the inverse of RevenueReconciler.
 *
 * RevenueReconciler answers: "for this job, did payment → webhook →
 * ledger all agree?" This module answers the harder direction:
 * "an external signal claims money moved — does anything internal
 * corroborate it, and what exact boundary remains?"
 *
 * Classification contract (every verdict carries inspectable evidence):
 *
 *   MATCHED_REVENUE              internal durable records corroborate a
 *                                verified non-test revenue event
 *   KNOWN_TEST_EVENT             the signal resolves to test-mode records
 *                                (internal or provider-observed)
 *   DUPLICATE_EVENT              the provider event id was already claimed/
 *                                processed — a re-notification
 *   UNMATCHED_EXTERNAL_PAYMENT   provider confirms the object exists (in a
 *                                mode we can inspect) but nothing internal
 *                                matches — real money, unknown attribution
 *   UNVERIFIED_NOTIFICATION      no provider object inspectable and no
 *                                internal match — notification only
 *   INVALID_PAYMENT_SIGNAL       the signal itself is malformed or its
 *                                assertions contradict durable/provider truth
 *   EXTERNAL_VERIFICATION_REQUIRED  the object's mode cannot be inspected
 *                                with the configured credential (e.g. live
 *                                object vs sk_test_ key)
 *
 * Invariants:
 *   - Identity is NEVER inferred from amount alone. Amount matches are
 *     reported as coincidence evidence, not attribution.
 *   - No verdict creates revenue. Revenue enters only through a verified
 *     webhook → RevenueLedger. This module is read-only against the DB.
 *   - A signal whose IDs match an internal record but whose amount or
 *     currency disagrees is INVALID — the signal as asserted is false.
 *   - Test-mode provider objects can never classify as revenue.
 */

import { getStripeMode, StripeModeInfo } from './stripe-mode';

export type PaymentSignalClassification =
  | 'MATCHED_REVENUE'
  | 'KNOWN_TEST_EVENT'
  | 'DUPLICATE_EVENT'
  | 'UNMATCHED_EXTERNAL_PAYMENT'
  | 'UNVERIFIED_NOTIFICATION'
  | 'INVALID_PAYMENT_SIGNAL'
  | 'EXTERNAL_VERIFICATION_REQUIRED';

export type ProtoforgeAttribution = 'CONFIRMED' | 'TEST' | 'NONE' | 'UNKNOWN';

export interface PaymentSignal {
  provider: string;                              // 'stripe' (only provider understood today)
  providerAccount?: string | null;
  mode?: 'test' | 'live' | 'unknown' | null;     // mode the signal claims, if known
  amountCents: number;
  currency: string;
  providerObjectId?: string | null;              // pi_*, ch_*, cs_*, evt_* if known
  eventId?: string | null;
  observedAt: string;
  source?: string;                               // 'notification' | 'manual_report' | 'api' | 'webhook'
  reference?: string | null;                     // human-supplied order/customer reference
}

export interface EvidenceCheck {
  name: string;
  result: 'yes' | 'no' | 'unknown';
  detail?: string | null;
}

export interface PaymentSignalVerdict {
  provider: string;
  providerAccount: string | null;
  mode: 'test' | 'live' | 'unknown';
  amount: number;
  currency: string;
  providerObjectId: string | null;
  eventId: string | null;
  observedAt: string;
  internalMatch: {
    job: string | null;
    webhookEvent: string | null;
    ledgerEntry: string | null;
  };
  ledgerMatch: boolean;
  jobMatch: boolean;
  offerMatch: string[];        // offerIds with the exact price — coincidence, NOT attribution
  classification: PaymentSignalClassification;
  protoforgeAttribution: ProtoforgeAttribution;
  confidence: number;
  externalVerificationRequired: boolean;
  evidence: EvidenceCheck[];
  summary: string;
}

interface MinimalDb {
  query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  queryOne(text: string, params?: unknown[]): Promise<Record<string, unknown> | null>;
}

interface StripeLike {
  paymentIntents?: { retrieve(id: string): Promise<Record<string, unknown>> };
  charges?: { retrieve(id: string): Promise<Record<string, unknown>> };
  checkout?: { sessions: { retrieve(id: string): Promise<Record<string, unknown>> } };
  events?: { retrieve(id: string): Promise<Record<string, unknown>> };
}

export interface PaymentSignalDeps {
  db?: MinimalDb | null;
  stripe?: StripeLike | null;
  stripeMode?: StripeModeInfo;
  catalog?: { getAll(): Array<{ offerId?: string; offer_id?: string; setupPrice?: number; priceCents?: number; currency?: string }> } | null;
  providerAccount?: string | null;
  now?: () => Date;
}

const TERMINAL_ATTRIBUTIONS = new Set<PaymentSignalClassification>([
  'MATCHED_REVENUE',
  'KNOWN_TEST_EVENT',
  'DUPLICATE_EVENT',
]);

export class PaymentSignalReconciler {
  private deps: PaymentSignalDeps;

  constructor(deps: PaymentSignalDeps = {}) {
    this.deps = deps;
  }

  static terminalAttribution(c: PaymentSignalClassification): boolean {
    return TERMINAL_ATTRIBUTIONS.has(c);
  }

  /**
   * Classify a payment signal. Pure evidence production — writes nothing.
   */
  async classify(signal: PaymentSignal): Promise<PaymentSignalVerdict> {
    const mode = this.deps.stripeMode || getStripeMode();
    const ev: EvidenceCheck[] = [];
    const push = (name: string, result: 'yes' | 'no' | 'unknown', detail?: string | null) => {
      ev.push({ name, result, detail: detail ?? null });
    };

    const base = {
      provider: signal.provider,
      providerAccount: signal.providerAccount || this.deps.providerAccount || null,
      amount: signal.amountCents,
      currency: (signal.currency || '').toLowerCase(),
      providerObjectId: signal.providerObjectId || null,
      eventId: signal.eventId || null,
      observedAt: signal.observedAt,
    };

    const verdict = (
      classification: PaymentSignalClassification,
      attribution: ProtoforgeAttribution,
      confidence: number,
      summary: string,
      opts: Partial<PaymentSignalVerdict> = {},
    ): PaymentSignalVerdict => ({
      ...base,
      mode: signal.mode === 'test' || signal.mode === 'live' ? signal.mode : 'unknown',
      internalMatch: { job: null, webhookEvent: null, ledgerEntry: null },
      ledgerMatch: false,
      jobMatch: false,
      offerMatch: [],
      classification,
      protoforgeAttribution: attribution,
      confidence,
      externalVerificationRequired: classification === 'EXTERNAL_VERIFICATION_REQUIRED',
      evidence: ev,
      summary,
      ...opts,
    });

    // ---- 1. Signal validity -------------------------------------------------
    if (signal.provider !== 'stripe') {
      push('provider recognized', 'no', `provider='${signal.provider}'`);
      return verdict('INVALID_PAYMENT_SIGNAL', 'UNKNOWN', 1.0,
        `Unrecognized provider '${signal.provider}' — cannot reconcile`);
    }
    // amountCents 0 is allowed only when a provider object id is given —
    // provider truth supplies the amount on retrieval.
    const hasObjectId = !!signal.providerObjectId;
    const validAmount = Number.isInteger(signal.amountCents)
      && (signal.amountCents > 0 || (signal.amountCents === 0 && hasObjectId));
    const validCurrency = typeof signal.currency === 'string' && /^[a-zA-Z]{3}$/.test(signal.currency);
    push('signal well-formed', validAmount && validCurrency ? 'yes' : 'no',
      validAmount && validCurrency ? null : `amount=${signal.amountCents} currency='${signal.currency}'`);
    if (!validAmount || !validCurrency) {
      return verdict('INVALID_PAYMENT_SIGNAL', 'UNKNOWN', 1.0,
        'Malformed signal — amount must be positive integer cents (or 0 with a provider object id), currency a 3-letter code');
    }

    // ---- 2. Internal durable-record lookup ---------------------------------
    const ids = [signal.providerObjectId, signal.eventId].filter((x): x is string => !!x);
    let job: Record<string, unknown> | null = null;
    let webhook: Record<string, unknown> | null = null;
    let ledger: Record<string, unknown> | null = null;

    if (this.deps.db && ids.length) {
      try {
        job = await this.deps.db.queryOne(
          `SELECT job_id, product, price_cents, currency, payment_status, job_status,
                  stripe_checkout_session_id, stripe_payment_intent_id, stripe_event_id
           FROM customer_jobs
           WHERE stripe_checkout_session_id = ANY($1)
              OR stripe_payment_intent_id = ANY($1)
              OR stripe_event_id = ANY($1) LIMIT 1`,
          [ids],
        );
        push('customer_job id match', job ? 'yes' : 'no',
          job ? `job ${job.job_id} (${job.product})` : null);

        webhook = await this.deps.db.queryOne(
          `SELECT event_id, event_type, type, status, is_test_mode
           FROM webhook_events
           WHERE event_id = ANY($1)
              OR payload->'data'->'object'->>'id' = ANY($1)
           ORDER BY created_at DESC LIMIT 1`,
          [ids],
        ).catch(() => null);
        push('webhook_event id match', webhook ? 'yes' : 'no',
          webhook ? `event ${webhook.event_id} status=${webhook.status}` : null);

        ledger = await this.deps.db.queryOne(
          `SELECT ledger_entry_id, event_type, offer_id, amount_gross, currency, verified
           FROM revenue_ledger
           WHERE stripe_event_id = ANY($1)
              OR stripe_payment_intent_id = ANY($1)
              OR stripe_charge_id = ANY($1) LIMIT 1`,
          [ids],
        );
        push('ledger id match', ledger ? 'yes' : 'no',
          ledger ? `entry ${ledger.ledger_entry_id} verified=${ledger.verified}` : null);
      } catch (e) {
        push('internal store readable', 'unknown', e instanceof Error ? e.message : 'query error');
      }
    }

    // Coincidence scan — same amount+currency nearby. Evidence only, never identity.
    if (!job && !ledger && this.deps.db && signal.observedAt) {
      try {
        const near = await this.deps.db.query(
          `SELECT job_id, price_cents, created_at FROM customer_jobs
           WHERE price_cents = $1 AND created_at BETWEEN $2::timestamptz - interval '48 hours'
                                                AND $2::timestamptz + interval '48 hours'
           LIMIT 5`,
          [signal.amountCents, signal.observedAt],
        );
        push('amount coincidence (informational only)', near.length ? 'unknown' : 'no',
          near.length
            ? `${near.length} job(s) share the amount — coincidence is NOT attribution`
            : 'no jobs share the amount');
      } catch { push('amount coincidence scan', 'unknown', 'query failed'); }
    }

    // Offer price coincidence — an offer at this price does not make it ours.
    const offers = this.deps.catalog?.getAll?.() || [];
    const priceCoincidence = offers
      .filter((o) => (o.setupPrice ?? o.priceCents) === signal.amountCents)
      .map((o) => String(o.offerId || o.offer_id));
    push('offer price coincidence', priceCoincidence.length ? 'unknown' : 'no',
      priceCoincidence.length
        ? `${priceCoincidence.join(', ')} at ${signal.amountCents}¢ — a price match is not attribution`
        : 'no offer at this price');

    // ---- 3. Internal match found -------------------------------------------
    if (job || webhook || ledger) {
      const matchedIds = [job?.stripe_checkout_session_id, job?.stripe_event_id, webhook?.event_id, signal.eventId]
        .filter((x): x is string => !!x);
      const isTest =
        webhook?.is_test_mode === true ||
        matchedIds.some((id) => id.startsWith('cs_test_') || id.startsWith('evt_test_')) ||
        (mode.mode === 'test' && !matchedIds.some((id) => id.startsWith('cs_live_')));

      // Signal-vs-record amount/currency agreement. If IDs match but the
      // amounts don't, the signal as asserted is false → INVALID.
      const internalAmount = job ? Number(job.price_cents) : ledger ? Number(ledger.amount_gross) : null;
      if (internalAmount !== null && signal.amountCents > 0 && internalAmount !== signal.amountCents) {
        push('amount agrees with internal record', 'no',
          `signal ${signal.amountCents}¢ vs internal ${internalAmount}¢`);
        return verdict('INVALID_PAYMENT_SIGNAL', 'NONE', 0.9,
          `Signal asserts ${signal.amountCents}¢ but the matched internal record is ${internalAmount}¢ — signal data is wrong`,
          { internalMatch: { job: (job?.job_id as string) || null, webhookEvent: (webhook?.event_id as string) || null, ledgerEntry: (ledger?.ledger_entry_id as string) || null }, jobMatch: !!job, ledgerMatch: !!ledger });
      }
      push('amount agrees with internal record', internalAmount !== null ? 'yes' : 'unknown',
        internalAmount !== null ? `${internalAmount}¢` : null);
      const internalCurrency = (job?.currency || ledger?.currency) as string | undefined;
      if (internalCurrency && internalCurrency.toLowerCase() !== signal.currency.toLowerCase()) {
        push('currency agrees with internal record', 'no', `signal ${signal.currency} vs ${internalCurrency}`);
        return verdict('INVALID_PAYMENT_SIGNAL', 'NONE', 0.9,
          `Signal asserts ${signal.currency} but the matched internal record is ${internalCurrency}`);
      }

      const internalMatch = {
        job: (job?.job_id as string) || null,
        webhookEvent: (webhook?.event_id as string) || null,
        ledgerEntry: (ledger?.ledger_entry_id as string) || null,
      };
      const common = { internalMatch, jobMatch: !!job, ledgerMatch: !!ledger, offerMatch: priceCoincidence };

      // Duplicate: the event id itself is recorded as a duplicate delivery
      // — a re-notification of an already-claimed event, not new revenue.
      const alreadyProcessed =
        signal.eventId !== null && webhook?.status === 'duplicate';
      if (isTest) {
        push('record mode', 'yes', 'test-mode identifiers');
        return verdict('KNOWN_TEST_EVENT', 'TEST', 0.9,
          'Signal resolves to test-mode internal records — never revenue', common);
      }
      if (alreadyProcessed) {
        push('event already processed', 'yes', `event ${signal.eventId}`);
        return verdict('DUPLICATE_EVENT', 'CONFIRMED', 0.95,
          'This event was already processed — the signal is a re-notification of known revenue', common);
      }
      const verified = !!ledger && ledger.verified === true;
      push('verified revenue evidence', verified ? 'yes' : job?.payment_status === 'paid' ? 'yes' : 'no',
        verified ? `ledger ${ledger?.ledger_entry_id}` : `job payment_status=${job?.payment_status ?? 'n/a'}`);
      return verdict('MATCHED_REVENUE', 'CONFIRMED', 0.95,
        'Internal durable records corroborate a verified revenue event', common);
    }

    push('internal durable match', 'no', 'no job/webhook/ledger record for the given identifiers');

    // ---- 4. Provider inspection (only reachable mode, read-only) -----------
    const objId = signal.providerObjectId;
    const claimsLive = signal.mode === 'live' || (objId?.startsWith('cs_live_') ?? false);
    const canInspectLive = mode.mode === 'live';
    const canInspectTest = mode.mode === 'test';

    if (mode.mode === 'disabled') {
      push('provider inspection', 'unknown', 'no Stripe credential configured');
      return verdict('EXTERNAL_VERIFICATION_REQUIRED', 'UNKNOWN', 0.4,
        'No Stripe credential configured — the provider cannot be inspected at all. A human must verify externally.',
        { offerMatch: priceCoincidence });
    }

    if (objId && this.deps.stripe) {
      const found = await this.retrieveProviderObject(objId);
      if (found.ok && found.object) {
        const obj = found.object;
        const objMode = obj.livemode === true ? 'live' : obj.livemode === false ? 'test' : 'unknown';
        push('provider object exists', 'yes', `${objId} mode=${objMode}`);
        const objAmount = Number(obj.amount ?? obj.amount_total ?? obj.amount_received ?? 0);
        if (objAmount > 0 && signal.amountCents > 0 && objAmount !== signal.amountCents) {
          push('amount agrees with provider', 'no', `signal ${signal.amountCents}¢ vs provider ${objAmount}¢`);
          return verdict('INVALID_PAYMENT_SIGNAL', 'NONE', 0.9,
            `Provider object ${objId} is ${objAmount}¢, not ${signal.amountCents}¢ — signal data is wrong`);
        }
        push('amount agrees with provider', 'yes', `${objAmount}¢`);
        // When the signal carried no amount, provider truth supplies it.
        const effectiveAmount = signal.amountCents > 0 ? signal.amountCents : objAmount;
        if (objMode === 'test') {
          return verdict('KNOWN_TEST_EVENT', 'TEST', 0.9,
            `Provider object ${objId} exists in test mode — never revenue`,
            { amount: effectiveAmount });
        }
        return verdict('UNMATCHED_EXTERNAL_PAYMENT', 'NONE', 0.85,
          `Provider confirms ${objId} exists (${objMode}) but NO internal record matches — money with unknown attribution`,
          { offerMatch: priceCoincidence, amount: effectiveAmount });
      }
      push('provider object exists', 'no', found.error || `${objId} not retrievable with configured credential`);
      if (claimsLive && !canInspectLive) {
        return verdict('EXTERNAL_VERIFICATION_REQUIRED', 'UNKNOWN', 0.5,
          `Object ${objId} is live-mode but the configured credential is ${mode.mode} — cannot inspect. Human verification required.`,
          { offerMatch: priceCoincidence });
      }
      return verdict('UNVERIFIED_NOTIFICATION', 'NONE', 0.3,
        `Provider object ${objId} is not retrievable (${mode.mode} credential) and no internal record exists`,
        { offerMatch: priceCoincidence, externalVerificationRequired: claimsLive && !canInspectLive });
    }

    // No provider object id — notification only.
    if (claimsLive && !canInspectLive) {
      push('provider inspection possible', 'no', `signal claims live; credential is ${mode.mode}`);
      return verdict('EXTERNAL_VERIFICATION_REQUIRED', 'UNKNOWN', 0.5,
        `Signal claims a live payment (${signal.amountCents}¢ ${signal.currency}) but only ${mode.mode} credentials are configured — human must verify in Stripe Live mode`,
        { offerMatch: priceCoincidence });
    }
    push('provider object id supplied', 'no', 'notification only — nothing to retrieve');
    return verdict('UNVERIFIED_NOTIFICATION', 'NONE', 0.3,
      `Unverified notification: ${signal.amountCents}¢ ${signal.currency}. No internal match, no provider object inspectable${canInspectTest ? ' in test mode (live mode cannot be inspected with the configured credential)' : ''
      }`,
      { offerMatch: priceCoincidence, externalVerificationRequired: !canInspectLive });
  }

  /** Route a provider object id to the correct Stripe retrieve call. */
  private async retrieveProviderObject(
    id: string,
  ): Promise<{ ok: boolean; object?: Record<string, unknown>; error?: string }> {
    const s = this.deps.stripe;
    if (!s) return { ok: false, error: 'no stripe client' };
    try {
      if (id.startsWith('pi_') && s.paymentIntents) return { ok: true, object: await s.paymentIntents.retrieve(id) };
      if (id.startsWith('ch_') && s.charges) return { ok: true, object: await s.charges.retrieve(id) };
      if (id.startsWith('cs_') && s.checkout) return { ok: true, object: await s.checkout.sessions.retrieve(id) };
      if (id.startsWith('evt_') && s.events) return { ok: true, object: await s.events.retrieve(id) };
      return { ok: false, error: `unrecognized object id prefix for '${id}'` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'retrieve failed' };
    }
  }
}
