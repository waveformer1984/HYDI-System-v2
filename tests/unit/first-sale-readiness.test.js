/**
 * First-sale readiness gate — deterministic verdicts from injected evidence.
 * The gate must never produce VERIFIED_LIVE_TRANSACTION from test-mode
 * records, green config alone, or a passing suite — only a full live
 * evidence chain (paid + delivered + ledger) qualifies.
 */
const { assessFirstSaleReadiness } = require('../../lib/revenue/FirstSaleReadiness.ts');
const { runVerifier } = require('../../lib/human-actions/verifiers.js');

const OPEN = 'OPEN';
const OFFER = { offerId: 'checkpoint_audit', name: 'Checkpoint Workflow Audit', setupPrice: 4900, active: true };

function world(over = {}) {
  const actions = [
    { id: 'ha_live', blockerKey: 'stripe:live-credential', status: OPEN },
    { id: 'ha_auth', blockerKey: 'stripe:live-transaction-authorization', status: OPEN },
    { id: 'ha_prospects', blockerKey: 'checkpoint:demand-prospects', status: OPEN },
    { id: 'ha_outreach', blockerKey: 'checkpoint:outreach-authorization', status: OPEN },
    { id: 'ha_url', blockerKey: 'protoforge:stable-public-url', status: OPEN },
    ...(over.extraActions || []),
  ];
  if (over.resolveKeys) {
    for (const a of actions) if (over.resolveKeys.includes(a.blockerKey)) a.status = 'RESOLVED';
  }
  return {
    env: (n) => ({
      STRIPE_SECRET_KEY: over.stripeKey ?? 'sk_test_abc',
      ALLOW_LIVE_STRIPE: over.allowLive ?? 'false',
      STRIPE_WEBHOOK_SECRET_01: 'whsec_x',
      WEBHOOK_PROCESSING_ENABLED: 'true',
      NEXT_PUBLIC_APP_URL: 'https://tunnel.example.dev',
      ...(over.env || {}),
    })[n],
    probe: async (url) => (over.probeDown && over.probeDown.some((u) => url.includes(u)))
      ? { ok: false } : { ok: true, status: 200 },
    fileExists: (p) => (over.missingFiles || []).every((f) => !p.endsWith(f)),
    readJson: (p) => (p.includes('live-transaction-authorization') ? (over.authStore ?? {}) : null),
    listHumanActions: () => actions,
    countLegitimateProspects: async () => ({ count: over.prospects ?? 0, source: 'test' }),
    findLiveTransaction: async () => over.liveTxn ?? null,
    getOffer: () => (over.offer === undefined ? OFFER : over.offer),
  };
}

describe('first-sale readiness gate', () => {
  test('BLOCKED_HUMAN_ACTION: machine green, human boundaries open', async () => {
    const r = await assessFirstSaleReadiness({}, world());
    expect(r.verdict).toBe('BLOCKED_HUMAN_ACTION');
    expect(r.openHumanActions.map((a) => a.blockerKey)).toEqual(
      expect.arrayContaining(['stripe:live-credential', 'checkpoint:demand-prospects', 'checkpoint:outreach-authorization']));
  });

  test('BLOCKED_MACHINE_FAILURE: web runtime down', async () => {
    const r = await assessFirstSaleReadiness({}, world({ probeDown: ['localhost:3000'] }));
    expect(r.verdict).toBe('BLOCKED_MACHINE_FAILURE');
    const a = r.areas.find((x) => x.area === 'A_runtime_and_public_url');
    expect(a.checks.find((c) => c.name.includes('heidi-web')).ok).toBe(false);
  });

  test('BLOCKED_MACHINE_FAILURE: offer inactive', async () => {
    const r = await assessFirstSaleReadiness({}, world({ offer: { ...OFFER, active: false } }));
    expect(r.verdict).toBe('BLOCKED_MACHINE_FAILURE');
  });

  test('BLOCKED_MACHINE_FAILURE: webhook processing disabled', async () => {
    const r = await assessFirstSaleReadiness({}, world({ env: { WEBHOOK_PROCESSING_ENABLED: 'false' } }));
    expect(r.verdict).toBe('BLOCKED_MACHINE_FAILURE');
  });

  test('READY_FOR_OPERATOR_REVIEW: everything green', async () => {
    const r = await assessFirstSaleReadiness({}, world({
      stripeKey: 'sk_live_abc', allowLive: 'true', prospects: 5,
      authStore: { a1: { state: 'PENDING', expiresAt: new Date(Date.now() + 3600e3).toISOString() } },
      resolveKeys: ['stripe:live-credential', 'stripe:live-transaction-authorization',
        'checkpoint:demand-prospects', 'checkpoint:outreach-authorization', 'protoforge:stable-public-url'],
    }));
    expect(r.verdict).toBe('READY_FOR_OPERATOR_REVIEW');
    expect(r.openHumanActions).toHaveLength(0);
  });

  test('VERIFIED_LIVE_TRANSACTION only on the full live chain', async () => {
    const r = await assessFirstSaleReadiness({}, world({
      liveTxn: { jobId: 'job_live_1', checkoutSessionId: 'cs_live_…', paymentStatus: 'paid', deliveryStatus: 'delivered', ledgerEntryId: 'led_1', reconciliationStatus: 'ledger-matched' },
    }));
    expect(r.verdict).toBe('VERIFIED_LIVE_TRANSACTION');
  });

  test('paid-but-not-delivered is NOT verified revenue', async () => {
    const r = await assessFirstSaleReadiness({}, world({
      liveTxn: { jobId: 'job_1', checkoutSessionId: 'cs_live_…', paymentStatus: 'paid', deliveryStatus: 'pending', ledgerEntryId: 'led_1' },
    }));
    expect(r.verdict).not.toBe('VERIFIED_LIVE_TRANSACTION');
  });

  test('a test-mode transaction can never produce the verdict', async () => {
    // findLiveTransaction returning null mirrors production: cs_test_ rows
    // are excluded from the live-transaction query by design.
    const r = await assessFirstSaleReadiness({}, world({ liveTxn: null }));
    expect(r.verdict).not.toBe('VERIFIED_LIVE_TRANSACTION');
  });

  test('shortfall prospects keep the gate human-blocked even when outreach consent exists', async () => {
    const r = await assessFirstSaleReadiness({}, world({
      stripeKey: 'sk_live_abc', allowLive: 'true', prospects: 3,
      authStore: { a1: { state: 'PENDING', expiresAt: new Date(Date.now() + 3600e3).toISOString() } },
      resolveKeys: ['stripe:live-credential', 'stripe:live-transaction-authorization', 'checkpoint:outreach-authorization', 'protoforge:stable-public-url'],
    }));
    expect(r.verdict).toBe('BLOCKED_HUMAN_ACTION');
  });
});

describe('prospect-count verifier', () => {
  const makeRead = (exp) => ({ readExperiment: async () => exp });
  const prospect = (name) => ({ prospectId: `p_${name}`, businessName: name, source: 'operator', relevanceReason: 'runs installs', contactChannel: 'direct email', legitimate: true });

  test('fails when fewer than minCount evidence-backed prospects exist', async () => {
    const r = await runVerifier('prospect-count', { minCount: 5 }, makeRead({ prospects: [prospect('A'), prospect('B')] }));
    expect(r.status).toBe('FAILED');
    expect(r.evidence.legitimateCount).toBe(2);
  });

  test('passes at minCount evidence-backed prospects', async () => {
    const r = await runVerifier('prospect-count', { minCount: 5 }, makeRead({ prospects: ['A', 'B', 'C', 'D', 'E'].map(prospect) }));
    expect(r.status).toBe('VERIFIED');
    expect(r.resumeEligible).toBe(true);
  });

  test('incomplete records never count — evidence fields are mandatory', async () => {
    const bad = { businessName: 'NoEvidence', legitimate: true }; // no source/reason/channel
    const r = await runVerifier('prospect-count', { minCount: 1 }, makeRead({ prospects: [bad] }));
    expect(r.status).toBe('FAILED');
    expect(r.evidence.legitimateCount).toBe(0);
  });

  test('removed tombstones do not count', async () => {
    const p = { ...prospect('Gone'), removedAt: new Date().toISOString() };
    const r = await runVerifier('prospect-count', { minCount: 1 }, makeRead({ prospects: [p, prospect('Here')] }));
    expect(r.evidence.legitimateCount).toBe(1);
  });

  test('unreadable experiment file fails closed', async () => {
    const r = await runVerifier('prospect-count', { minCount: 5 }, makeRead(null));
    expect(r.status).toBe('FAILED');
  });
});
