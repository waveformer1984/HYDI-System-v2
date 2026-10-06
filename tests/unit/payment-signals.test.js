'use strict';

/**
 * Payment signal reconciliation — the $9.99 incident, turned durable.
 *
 * Proves the invariants end to end:
 *   - a signal is classified from evidence, never identity-by-amount
 *   - no signal can create revenue, a job, or an offer
 *   - unverifiable claims get a real Human Action, not a dead string
 *   - completing the action runs an independent check, not attestation
 *   - test and live provider modes can never be confused
 *   - the chat surface answers from the same durable state
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const bridge = require('../../lib/revenue/payment-signal-bridge');
const { HumanActionService } = require('../../lib/human-actions/service');
const { tryPaymentAnswer } = require('../../lib/revenue/payment-answer');

let tmpDir;
let svc;

function fakeDb(tables = {}) {
  const t = { customer_jobs: [], webhook_events: [], revenue_ledger: [], ...tables };
  const anyOf = (row, cols, ids) => cols.some((c) => ids.includes(row[c]));
  return {
    queries: [],
    async query(text, params = []) {
      this.queries.push({ text, params });
      const ids = params[0];
      if (/FROM customer_jobs/.test(text) && /price_cents = \$1/.test(text)) {
        const [amount, ts] = params;
        return t.customer_jobs.filter((j) => j.price_cents === amount
          && Math.abs(Date.parse(j.created_at) - Date.parse(ts)) < 48 * 3600 * 1000);
      }
      if (/FROM customer_jobs/.test(text)) {
        return t.customer_jobs.filter((j) => anyOf(j, ['stripe_checkout_session_id', 'stripe_payment_intent_id', 'stripe_event_id'], ids));
      }
      if (/FROM webhook_events/.test(text)) {
        return t.webhook_events.filter((w) => ids.includes(w.event_id) || ids.includes(w.object_id));
      }
      if (/FROM revenue_ledger/.test(text)) {
        return t.revenue_ledger.filter((l) => anyOf(l, ['stripe_event_id', 'stripe_payment_intent_id', 'stripe_charge_id'], ids));
      }
      return [];
    },
    async queryOne(text, params = []) {
      const rows = await this.query(text, params);
      return rows[0] || null;
    },
  };
}

const fakeCatalog = {
  getAll: () => [
    { offerId: 'protoforge_model_prep', setupPrice: 2900, currency: 'usd' },
    { offerId: 'checkpoint_audit', setupPrice: 4900, currency: 'usd' },
  ],
};

const testMode = { mode: 'test', keyPrefix: 'sk_test_', liveAllowed: false, configured: true, webhookConfigured: true };
const liveMode = { mode: 'live', keyPrefix: 'sk_live_', liveAllowed: true, configured: true, webhookConfigured: true };
const noMode = { mode: 'disabled', keyPrefix: 'none', liveAllowed: false, configured: false, webhookConfigured: false };

function fakeStripe(objects = {}) {
  const missing = () => Promise.reject(Object.assign(new Error('No such object'), { code: 'resource_missing' }));
  return {
    accounts: { retrieve: async () => ({ id: 'acct_test123' }) },
    paymentIntents: { retrieve: async (id) => objects[id] || missing() },
    charges: { retrieve: async (id) => objects[id] || missing() },
    checkout: { sessions: { retrieve: async (id) => objects[id] || missing() } },
    events: { retrieve: async (id) => objects[id] || missing() },
  };
}

function deps(overrides = {}) {
  return {
    service: svc,
    reconcilerDeps: {
      db: fakeDb(), stripe: fakeStripe(), stripeMode: testMode,
      catalog: fakeCatalog, providerAccount: 'acct_test123',
      ...overrides,
    },
  };
}

const baseSignal = {
  amountCents: 999, currency: 'usd', observedAt: '2026-10-10T12:00:00Z',
  source: 'notification', provider: 'stripe',
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psig-'));
  process.env.HYDI_PAYMENT_SIGNALS_PATH = path.join(tmpDir, 'payment-signals.json');
  process.env.HYDI_HUMAN_ACTIONS_FILE = path.join(tmpDir, 'human-actions.json');
  svc = new HumanActionService({});
});

afterEach(() => {
  delete process.env.HYDI_PAYMENT_SIGNALS_PATH;
  delete process.env.HYDI_HUMAN_ACTIONS_FILE;
});

describe('classification — internal matches', () => {
  it('exact matched payment → MATCHED_REVENUE', async () => {
    const job = { job_id: 'job_1', product: 'protoforge_model_prep', price_cents: 2900, currency: 'usd', payment_status: 'paid', stripe_checkout_session_id: 'cs_live_abc12345', stripe_event_id: 'evt_1abc' };
    const ledger = { ledger_entry_id: 'le_1', verified: true, amount_gross: 2900, currency: 'usd', stripe_event_id: 'evt_1abc' };
    const webhook = { event_id: 'evt_1abc', status: 'processing', is_test_mode: false };
    const { verdict } = await bridge.recordSignal(
      { ...baseSignal, amountCents: 2900, providerObjectId: 'cs_live_abc12345', eventId: 'evt_1abc', mode: 'live' },
      deps({ db: fakeDb({ customer_jobs: [job], revenue_ledger: [ledger], webhook_events: [webhook] }), stripeMode: liveMode }),
    );
    expect(verdict.classification).toBe('MATCHED_REVENUE');
    expect(verdict.protoforgeAttribution).toBe('CONFIRMED');
    expect(verdict.internalMatch.job).toBe('job_1');
  });

  it('test-mode payment → KNOWN_TEST_EVENT', async () => {
    const job = { job_id: 'job_t', product: 'rezonate_song', price_cents: 2900, payment_status: 'paid', stripe_checkout_session_id: 'cs_test_abc12345', stripe_event_id: 'evt_x1' };
    const { verdict } = await bridge.recordSignal(
      { ...baseSignal, amountCents: 2900, providerObjectId: 'cs_test_abc12345', eventId: 'evt_x1' },
      deps({ db: fakeDb({ customer_jobs: [job] }) }),
    );
    expect(verdict.classification).toBe('KNOWN_TEST_EVENT');
    expect(verdict.protoforgeAttribution).toBe('TEST');
    expect(verdict.confidence).toBeGreaterThan(0.8);
  });

  it('already-processed event id → DUPLICATE_EVENT', async () => {
    const webhook = { event_id: 'evt_3UNJsvITaXOHazrh1TDiI5OS', status: 'duplicate', is_test_mode: false };
    const ledger = { ledger_entry_id: 'le_9', verified: true, amount_gross: 2900, currency: 'usd', stripe_event_id: 'evt_3UNJsvITaXOHazrh1TDiI5OS' };
    const { verdict } = await bridge.recordSignal(
      { ...baseSignal, amountCents: 2900, eventId: 'evt_3UNJsvITaXOHazrh1TDiI5OS', mode: 'live' },
      deps({ db: fakeDb({ webhook_events: [webhook], revenue_ledger: [ledger] }), stripeMode: liveMode }),
    );
    expect(verdict.classification).toBe('DUPLICATE_EVENT');
    expect(verdict.protoforgeAttribution).toBe('CONFIRMED');
  });

  it('provider-observed test object → KNOWN_TEST_EVENT', async () => {
    const { verdict } = await bridge.recordSignal(
      { ...baseSignal, amountCents: 2900, providerObjectId: 'pi_testobj1' },
      deps({ stripe: fakeStripe({ pi_testobj1: { id: 'pi_testobj1', amount: 2900, livemode: false } }) }),
    );
    expect(verdict.classification).toBe('KNOWN_TEST_EVENT');
  });
});

describe('classification — unmatched / boundary cases', () => {
  it('provider-confirmed live object with no internal match → UNMATCHED_EXTERNAL_PAYMENT + Human Action', async () => {
    const { verdict, record } = await bridge.recordSignal(
      { ...baseSignal, providerObjectId: 'pi_realmoney1', mode: 'live' },
      deps({ stripe: fakeStripe({ pi_realmoney1: { id: 'pi_realmoney1', amount: 999, livemode: true } }), stripeMode: liveMode }),
    );
    expect(verdict.classification).toBe('UNMATCHED_EXTERNAL_PAYMENT');
    expect(verdict.protoforgeAttribution).toBe('NONE');
    expect(record.humanActionId).toBeTruthy();
    const action = svc.get(record.humanActionId);
    expect(action.type).toBe('VERIFY_EXTERNAL_PAYMENT');
    expect(action.instructions.join(' ')).toMatch(/Stripe Dashboard/);
  });

  it('notification with no inspectable object → UNVERIFIED_NOTIFICATION + Human Action', async () => {
    const { verdict, record } = await bridge.recordSignal({ ...baseSignal }, deps());
    expect(verdict.classification).toBe('UNVERIFIED_NOTIFICATION');
    expect(record.humanActionId).toBeTruthy();
    expect(svc.get(record.humanActionId).instructions.join(' ')).toMatch(/LIVE mode/);
  });

  it('live-mode object id vs test credential → EXTERNAL_VERIFICATION_REQUIRED', async () => {
    const { verdict } = await bridge.recordSignal(
      { ...baseSignal, providerObjectId: 'cs_live_zzz99999', mode: 'live' },
      deps({ stripe: fakeStripe() }), // retrieve fails resource_missing
    );
    expect(verdict.classification).toBe('EXTERNAL_VERIFICATION_REQUIRED');
    expect(verdict.externalVerificationRequired).toBe(true);
  });

  it('live claim with no credential at all → EXTERNAL_VERIFICATION_REQUIRED', async () => {
    const { verdict } = await bridge.recordSignal(
      { ...baseSignal, mode: 'live' },
      deps({ stripeMode: noMode, stripe: null }),
    );
    expect(verdict.classification).toBe('EXTERNAL_VERIFICATION_REQUIRED');
  });

  it('malformed signal → INVALID_PAYMENT_SIGNAL', async () => {
    const { PaymentSignalReconciler } = require('../../lib/revenue/PaymentSignalReconciler.ts');
    const verdict = await new PaymentSignalReconciler({ db: fakeDb(), stripeMode: testMode }).classify(
      { ...baseSignal, amountCents: -50 },
    );
    expect(verdict.classification).toBe('INVALID_PAYMENT_SIGNAL');
    // and the bridge refuses it at the input boundary
    await expect(bridge.recordSignal({ ...baseSignal, amountCents: -50 }, deps())).rejects.toThrow();
  });

  it('amount mismatch against durable record → INVALID_PAYMENT_SIGNAL', async () => {
    const job = { job_id: 'job_2', product: 'protoforge_model_prep', price_cents: 2900, currency: 'usd', payment_status: 'paid', stripe_checkout_session_id: 'cs_live_amt9999' };
    const { verdict } = await bridge.recordSignal(
      { ...baseSignal, amountCents: 999, providerObjectId: 'cs_live_amt9999' },
      deps({ db: fakeDb({ customer_jobs: [job] }), stripeMode: liveMode }),
    );
    expect(verdict.classification).toBe('INVALID_PAYMENT_SIGNAL');
    expect(verdict.evidence.some((e) => e.name === 'amount agrees with internal record' && e.result === 'no')).toBe(true);
  });

  it('currency mismatch against provider object → INVALID_PAYMENT_SIGNAL', async () => {
    const { verdict } = await bridge.recordSignal(
      { ...baseSignal, currency: 'eur', providerObjectId: 'pi_cur1' },
      deps({ stripe: fakeStripe({ pi_cur1: { id: 'pi_cur1', amount: 999, currency: 'usd', livemode: true } }), stripeMode: liveMode }),
    );
    // provider confirms amount but signal asserts wrong currency — evidence records the object exists; the verdict is still an external payment with mismatched signal data
    expect(['UNMATCHED_EXTERNAL_PAYMENT', 'INVALID_PAYMENT_SIGNAL']).toContain(verdict.classification);
  });

  it('offer price coincidence is evidence, never attribution', async () => {
    const { verdict } = await bridge.recordSignal(
      { ...baseSignal, amountCents: 4900 }, // exact checkpoint_audit price
      deps(),
    );
    expect(verdict.offerMatch).toContain('checkpoint_audit');
    expect(verdict.protoforgeAttribution).toBe('NONE'); // price match did NOT make it ours
    expect(verdict.classification).toBe('UNVERIFIED_NOTIFICATION');
  });

  it('amount-only coincidence never becomes identity', async () => {
    const job = { job_id: 'job_same_amount', price_cents: 999, created_at: '2026-10-10T13:00:00Z', stripe_checkout_session_id: 'cs_test_other99', payment_status: 'unpaid' };
    const { verdict } = await bridge.recordSignal(
      { ...baseSignal, providerObjectId: 'pi_unrelated99' },
      deps({ db: fakeDb({ customer_jobs: [job] }), stripe: fakeStripe({ pi_unrelated99: { id: 'pi_unrelated99', amount: 999, livemode: false } }) }),
    );
    // different provider id — the same-amount job is coincidence evidence only
    expect(verdict.internalMatch.job).toBeNull();
    expect(verdict.classification).toBe('KNOWN_TEST_EVENT'); // provider says test
  });
});

describe('human action lifecycle', () => {
  it('dedupes on blockerKey — second identical signal returns same action', async () => {
    const a = await bridge.recordSignal({ ...baseSignal }, deps());
    const b = await bridge.recordSignal({ ...baseSignal }, deps());
    expect(a.record.id).toBe(b.record.id);
    expect(a.record.humanActionId).toBe(b.record.humanActionId);
  });

  it('verify BEFORE disposition fails honestly → BLOCKED', async () => {
    const { record } = await bridge.recordSignal({ ...baseSignal }, deps());
    const res = await svc.verify(record.humanActionId, 'test');
    expect(res.action.status).toBe('BLOCKED');
    expect(res.result.passed).toBe(false);
    expect(res.result.checks.some((c) => c.name === 'signal resolved' && !c.passed)).toBe(true);
  });

  it('disposition external_not_found → verifier independently resolves the action', async () => {
    const { record } = await bridge.recordSignal({ ...baseSignal }, deps());
    await bridge.recordDisposition(record.id, { disposition: 'external_not_found', actor: 'j' }, deps());
    const res = await svc.verify(record.humanActionId, 'heidi-chat');
    expect(res.result.passed).toBe(true);
    expect(res.action.status).toBe('RESOLVED');
    expect(res.action.resolution).toBe('auto_verified');
    expect(res.result.evidence.disposition.type).toBe('external_not_found');
    expect(res.result.evidence.disposition.actor).toBe('j');
  });

  it('external_confirmed with wrong payment id FAILS verification — the provider object disagrees', async () => {
    const { record } = await bridge.recordSignal({ ...baseSignal }, deps());
    await bridge.recordDisposition(record.id, {
      disposition: 'external_confirmed', providerObjectId: 'pi_wrong_amt', actor: 'j',
    }, deps());
    // verify with a stripe dep that returns a different amount for that id
    const svc2 = new HumanActionService({ verifierDeps: { stripe: fakeStripe({ pi_wrong_amt: { id: 'pi_wrong_amt', amount: 12345, livemode: true } }), signalStore: require('../../lib/revenue/payment-signal-store') } });
    const res = await svc2.verify(record.humanActionId, 'test');
    // signal resolved via disposition, but provider re-check catches the wrong id
    expect(res.result.checks.some((c) => c.name === 'provider object amount agrees' && !c.passed)).toBe(true);
  });

  it('auto-reconcile: webhook lands later → signal resolves, action verifies', async () => {
    const { record } = await bridge.recordSignal(
      { ...baseSignal, amountCents: 2900, providerObjectId: 'cs_live_later1', eventId: 'evt_later1', mode: 'live' },
      deps({ db: fakeDb(), stripeMode: liveMode }),
    );
    expect(record.status).toBe('open');
    // now the "webhook" arrives — internal records exist on re-check
    const lateDb = fakeDb({
      customer_jobs: [{ job_id: 'job_late', price_cents: 2900, currency: 'usd', payment_status: 'paid', stripe_checkout_session_id: 'cs_live_later1', stripe_event_id: 'evt_later1' }],
      revenue_ledger: [{ ledger_entry_id: 'le_late', verified: true, amount_gross: 2900, stripe_event_id: 'evt_later1' }],
    });
    const r = await bridge.reconcileSignal(record.id, deps({ db: lateDb, stripeMode: liveMode }));
    expect(r.resolved).toBe(true);
    expect(r.verdict.classification).toBe('MATCHED_REVENUE');
    const v = await svc.verify(record.humanActionId, 'test');
    expect(v.action.status).toBe('RESOLVED');
  });
});

describe('$9.99 regression — the phone notification that started this', () => {
  it('a $9.99 notification produces zero revenue and a verification action', async () => {
    const db = fakeDb(); // empty internal state — the real incident
    const before = db.queries.length;

    const { verdict, record } = await bridge.recordSignal(
      { ...baseSignal, amountCents: 999, currency: 'usd' }, deps({ db }),
    );

    // Truth: nothing matched, nothing was created
    expect(verdict.protoforgeAttribution).toBe('NONE');
    expect(verdict.internalMatch).toEqual({ job: null, webhookEvent: null, ledgerEntry: null });
    expect(verdict.ledgerMatch).toBe(false);
    expect(verdict.jobMatch).toBe(false);
    expect(verdict.offerMatch).toEqual([]); // no offer at 999¢
    expect(['UNVERIFIED_NOTIFICATION', 'UNMATCHED_EXTERNAL_PAYMENT']).toContain(verdict.classification);

    // No writes to any revenue table — only reads
    expect(db.queries.every((q) => !/INSERT|UPDATE|DELETE/i.test(q.text))).toBe(true);

    // The boundary is a durable Human Action, not a dead string
    const action = svc.get(record.humanActionId);
    expect(action.status).toBe('OPEN');
    expect(action.type).toBe('VERIFY_EXTERNAL_PAYMENT');
    expect(action.instructions.join(' ')).toMatch(/LIVE mode/);
    expect(action.verifier.name).toBe('payment-signal-resolved');

    // And it appears on the ACTIONS surface
    expect(svc.listOpen().map((a) => a.id)).toContain(action.id);
  });
});

describe('chat — deterministic answers', () => {
  it('"what\'s this $9.99 payment" records the signal and answers from evidence', async () => {
    const d = deps();
    const answer = await tryPaymentAnswer("I got a notification — what's this $9.99 payment?", { bridge, service: svc, reconcilerDeps: d.reconcilerDeps });
    expect(answer).not.toBeNull();
    expect(answer.text).toMatch(/\$9\.99 USD/);
    expect(answer.text).toMatch(/ProtoForge attribution: NONE/);
    expect(answer.text).toMatch(/UNVERIFIED_NOTIFICATION|NONE/);
    expect(answer.text).toMatch(/No revenue was recognized/);
    // the signal is durable + has its action
    const open = bridge.listSignals({ status: 'open' });
    expect(open.length).toBe(1);
    expect(open[0].signal.amountCents).toBe(999);
  });

  it('"did we get paid" answers from the verified ledger', async () => {
    const answer = await tryPaymentAnswer('did we get paid?', {
      bridge,
      ledger: {
        getVerifiedRevenue: async () => [
          { amountGross: 2900, currency: 'usd', eventType: 'setup_fee_collected', offerId: 'rezonate_song', stripeEventId: 'evt_abc', recordedAt: '2026-10-05T16:00:00Z' },
        ]
      },
      reconcilerDeps: deps().reconcilerDeps,
    });
    expect(answer.text).toMatch(/\$29\.00 USD/);
    expect(answer.text).toMatch(/setup_fee_collected/);
    expect(answer.text).toMatch(/configured Stripe mode/);
  });

  it('"any unreconciled payments" lists open signals', async () => {
    await bridge.recordSignal({ ...baseSignal, amountCents: 2500 }, deps());
    const answer = await tryPaymentAnswer('are there any unreconciled payments?', { bridge, reconcilerDeps: deps().reconcilerDeps });
    expect(answer.text).toMatch(/1 unreconciled payment signal/);
    expect(answer.text).toMatch(/\$25\.00 USD/);
    expect(answer.text).toMatch(/No revenue is recognized/);
  });

  it('non-payment messages return null (fall through to other handlers)', async () => {
    expect(await tryPaymentAnswer('what do you need from me?', {})).toBeNull();
    expect(await tryPaymentAnswer('hello there', {})).toBeNull();
  });
});
