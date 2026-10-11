'use strict';

/**
 * Billing acceptance scenarios (docs/billing/REVENUE_STREAMS_MODULE.md §H).
 * Defined once, run against the memory store (acceptance.memory.test.js,
 * Tier 1) and against real Postgres (acceptance.pg.test.js, Tier 2), so the
 * SQL functions and the JS emulation are held to the same contract.
 */

const { createHarness, DAY } = require('./harness');

function defineAcceptanceScenarios(kind) {
  let h;
  afterEach(async () => { if (h) await h.close(); h = null; });

  const setup = async (policy) => { h = await createHarness(kind, policy); return h; };
  const access = async (tenant, feature = 'ai_completions') => (await h.service.checkEntitlement(tenant.tenant_id, feature)).allowed;

  describe('purchase → entitlement', () => {
    it('a successful payment grants access to exactly the purchasing tenant', async () => {
      await setup();
      const a = await h.tenant('Alpha');
      const b = await h.tenant('Beta');
      const { sub } = await h.subscribe(a);
      expect(sub.status).toBe('active');
      expect(sub.tenant_id).toBe(a.tenant_id);
      expect(await access(a)).toBe(true);
      expect(await access(a, 'api_access')).toBe(true);
      expect(await access(b)).toBe(false);
      const overview = await h.service.getAccountOverview(a.tenant_id);
      expect(overview.subscription.has_access).toBe(true);
      expect(overview.subscription.plan.plan_key).toBe('starter');
      expect(overview.payments).toHaveLength(1);
      expect(overview.payments[0]).toMatchObject({ status: 'succeeded', amount_minor: 2900, currency: 'usd' });
    });

    it('a checkout redirect alone grants nothing', async () => {
      await setup();
      const a = await h.tenant();
      const started = await h.service.startCheckout(a.tenant_id, { priceVersionId: h.price.price_version_id, idempotencyKey: h.key() });
      expect(started.url).toMatch(/^https:\/\/checkout\.fake\.local\//);
      // The customer lands on the success URL; nothing has been verified.
      const overview = await h.service.getAccountOverview(a.tenant_id);
      expect(overview.subscription).toBeNull();
      expect(overview.pending_checkouts).toHaveLength(1);
      expect(await access(a)).toBe(false);
      await expect(h.use(a)).rejects.toMatchObject({ code: 'not_entitled' });
    });

    it('a forged or tampered webhook is rejected and grants nothing', async () => {
      await setup();
      const a = await h.tenant();
      const c = await h.checkout(a);
      const forged = { rawBody: Buffer.from(JSON.stringify(c.events[0])), headers: { 'x-fake-billing-signature': 'ab'.repeat(32) } };
      await expect(h.service.receiveWebhook(forged.rawBody, forged.headers)).rejects.toMatchObject({ code: 'invalid_signature', status: 400 });
      const tampered = h.provider.deliver(c.events[0], { tamper: true });
      await expect(h.service.receiveWebhook(tampered.rawBody, tampered.headers)).rejects.toMatchObject({ code: 'invalid_signature' });
      await expect(h.service.receiveWebhook(Buffer.from('{}'), {})).rejects.toMatchObject({ code: 'invalid_signature' });
      expect(await h.store.findMany('billing_webhook_events', {})).toHaveLength(0);
      expect(await access(a)).toBe(false);
    });

    it('a failed first payment grants no access', async () => {
      await setup();
      const a = await h.tenant();
      const { sub } = await h.subscribe(a, { paymentSucceeds: false });
      expect(sub.status).toBe('incomplete');
      expect(await access(a)).toBe(false);
      await expect(h.use(a)).rejects.toMatchObject({ code: 'not_entitled', status: 402 });
      const payments = await h.store.findMany('billing_payments', { tenant_id: a.tenant_id });
      expect(payments.map((p) => p.status)).toEqual(['failed']);
    });

    it('a trial grants access without a charge', async () => {
      await setup();
      const pid = h.provider.registerPrice({ unitAmountMinor: 2900, currency: 'usd', interval: 'month' });
      const pv = await h.service.createPriceVersion({ plan_id: h.plan.plan_id, currency: 'usd', unit_amount_minor: 2900, billing_interval: 'month', trial_days: 14, provider_price_id: pid }, h.OPERATOR);
      await h.service.publishPriceVersion(pv.price_version_id, { confirm: true, reason: 'trial offer' }, h.OPERATOR);
      const a = await h.tenant();
      const { sub } = await h.subscribe(a, { priceVersionId: pv.price_version_id });
      expect(sub.status).toBe('trialing');
      expect(await access(a)).toBe(true);
      h.advanceDays(16); // trial over, no conversion event received
      expect(await access(a)).toBe(false);
    });

    it('checkout is idempotent per key and blocked while a subscription is live', async () => {
      await setup();
      const a = await h.tenant();
      const key = h.key();
      const first = await h.service.startCheckout(a.tenant_id, { priceVersionId: h.price.price_version_id, idempotencyKey: key });
      const again = await h.service.startCheckout(a.tenant_id, { priceVersionId: h.price.price_version_id, idempotencyKey: key });
      expect(again).toMatchObject({ intent_id: first.intent_id, url: first.url, reused: true });
      expect(h.provider.calls.filter((c) => c === 'createCheckoutSession')).toHaveLength(1);
      await h.subscribe(a);
      await expect(h.service.startCheckout(a.tenant_id, { priceVersionId: h.price.price_version_id, idempotencyKey: h.key() }))
        .rejects.toMatchObject({ code: 'subscription_exists', status: 409 });
    });

    it('only published prices can be bought; amounts never come from the client', async () => {
      await setup();
      const a = await h.tenant();
      const draft = await h.service.createPriceVersion({ plan_id: h.plan.plan_id, currency: 'usd', unit_amount_minor: 1, billing_interval: 'month', provider_price_id: 'price_draft_x' }, h.OPERATOR);
      await expect(h.service.startCheckout(a.tenant_id, { priceVersionId: draft.price_version_id, idempotencyKey: h.key() }))
        .rejects.toMatchObject({ code: 'price_not_available', status: 404 });
      await expect(h.service.startCheckout(a.tenant_id, { priceVersionId: 'not-a-uuid', idempotencyKey: h.key() }))
        .rejects.toMatchObject({ code: 'invalid_request' });
    });
  });

  describe('webhook reliability', () => {
    it('duplicate deliveries do not duplicate payments, subscriptions or entitlements', async () => {
      await setup();
      const a = await h.tenant();
      const c = await h.checkout(a);
      for (let i = 0; i < 3; i++) {
        const results = await h.deliverAll(c.events);
        if (i > 0) expect(results.every((r) => r.duplicate)).toBe(true);
      }
      expect(await h.store.findMany('billing_subscriptions', { tenant_id: a.tenant_id })).toHaveLength(1);
      expect(await h.store.findMany('billing_payments', { tenant_id: a.tenant_id })).toHaveLength(1);
      expect(await h.store.findMany('billing_entitlements', { tenant_id: a.tenant_id })).toHaveLength(2);
      expect(await h.store.findMany('billing_webhook_events', {})).toHaveLength(c.events.length);
    });

    it('concurrent processing of one stored event runs it once', async () => {
      await setup();
      const a = await h.tenant();
      const c = await h.checkout(a);
      const { rawBody, headers } = h.provider.deliver(c.events[1]);
      const stored = await h.service.receiveWebhook(rawBody, headers);
      const results = await Promise.all([1, 2, 3, 4].map(() => h.service.processWebhookEvent(stored.eventRowId)));
      expect(results.filter((r) => r.outcome === 'processed')).toHaveLength(1);
      expect(results.filter((r) => r.outcome === 'not_claimable')).toHaveLength(3);
    });

    it('an out-of-order (older) event cannot restore canceled access', async () => {
      await setup();
      const a = await h.tenant();
      const { subscriptionId } = await h.subscribe(a);
      h.advanceDays(3);
      const activeUpdate = h.provider._emit('customer.subscription.updated', h.provider.subscriptions.get(subscriptionId));
      h.advanceDays(1);
      const [deleted] = h.provider.endSubscription(subscriptionId);
      await h.deliver(deleted); // newer, terminal — arrives first
      expect(await access(a)).toBe(false);
      const late = await h.deliver(activeUpdate); // older "active" snapshot arrives late
      expect(late.outcome).toBe('ignored');
      const sub = await h.store.findOne('billing_subscriptions', { provider_subscription_id: subscriptionId });
      expect(sub.status).toBe('canceled');
      expect(await access(a)).toBe(false);
    });

    it('a terminal state is never left, even by a newer snapshot', async () => {
      await setup();
      const a = await h.tenant();
      const { subscriptionId } = await h.subscribe(a);
      await h.deliverAll(h.provider.endSubscription(subscriptionId));
      h.advanceDays(1);
      const bogus = { ...h.provider.subscriptions.get(subscriptionId), status: 'active', canceled_at: null, ended_at: null };
      const r = await h.deliver(h.provider._emit('customer.subscription.updated', bogus));
      expect(r.outcome).toBe('ignored');
      expect(await access(a)).toBe(false);
    });

    it('provider outage during processing leaves a recoverable failed event', async () => {
      await setup();
      const a = await h.tenant();
      const c = await h.checkout(a);
      const completed = c.events.find((e) => e.type === 'checkout.session.completed');
      h.provider.setOutage(true);
      const r = await h.deliver(completed); // needs a provider read → fails
      expect(r.outcome).toBe('failed');
      expect(await access(a)).toBe(false);
      const ev = await h.store.findOne('billing_webhook_events', { event_row_id: r.eventRowId });
      expect(ev.status).toBe('failed');
      expect(ev.last_error).toMatch(/simulated outage/);
      h.provider.setOutage(false);
      expect(await h.service.processDueWebhookEvents()).toHaveLength(0); // backoff not yet elapsed
      h.advance(60 * 1000);
      const retried = await h.service.processDueWebhookEvents();
      expect(retried.map((x) => x.outcome)).toEqual(['processed']);
      expect(await access(a)).toBe(true);
    });

    it('repeated failures dead-letter the event; operator replay recovers it with an audit record', async () => {
      await setup({ webhookMaxAttempts: 2 });
      const a = await h.tenant();
      const c = await h.checkout(a);
      const completed = c.events.find((e) => e.type === 'checkout.session.completed');
      h.provider.setOutage(true);
      const r = await h.deliver(completed);
      h.advance(10 * 60 * 1000);
      await h.service.processDueWebhookEvents();
      const ev = await h.store.findOne('billing_webhook_events', { event_row_id: r.eventRowId });
      expect(ev.status).toBe('dead_letter');
      h.provider.setOutage(false);
      await expect(h.service.replayWebhookEvent(r.eventRowId, { reason: 'provider back' }, h.OPERATOR)).rejects.toMatchObject({ code: 'confirmation_required' });
      const replay = await h.service.replayWebhookEvent(r.eventRowId, { reason: 'provider recovered', confirm: true }, h.OPERATOR);
      expect(replay.outcome).toBe('processed');
      expect(await access(a)).toBe(true);
      const audit = await h.store.findMany('billing_audit_events', { action: 'webhook.replayed' });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor_type: 'operator', reason: 'provider recovered' });
    });

    it('checkout start survives a provider outage and resumes with the same key', async () => {
      await setup();
      const a = await h.tenant();
      const key = h.key();
      h.provider.setOutage(true);
      await expect(h.service.startCheckout(a.tenant_id, { priceVersionId: h.price.price_version_id, idempotencyKey: key }))
        .rejects.toMatchObject({ code: 'provider_unavailable', status: 503 });
      h.provider.setOutage(false);
      const ok = await h.service.startCheckout(a.tenant_id, { priceVersionId: h.price.price_version_id, idempotencyKey: key });
      expect(ok.url).toBeTruthy();
      expect(await h.store.findMany('billing_checkout_intents', { tenant_id: a.tenant_id })).toHaveLength(1);
    });

    it('reconciliation repairs state when webhooks were never delivered', async () => {
      await setup();
      const a = await h.tenant();
      const c = await h.checkout(a); // events emitted but never delivered
      expect(await access(a)).toBe(false);
      h.advance(31 * 60 * 1000);
      const report = await h.service.reconcile();
      expect(report.checkouts_checked).toBe(1);
      expect(report.errors).toEqual([]);
      expect(await access(a)).toBe(true);
      // Later the provider ends it without a webhook: reconcile revokes.
      h.provider.endSubscription(c.subscriptionId);
      h.advance(1000);
      const r2 = await h.service.reconcile();
      expect(r2.subscriptions_changed).toBe(1);
      expect(await access(a)).toBe(false);
    });
  });

  describe('renewals, grace, cancellation, refunds, disputes', () => {
    it('a failed renewal keeps access through the grace period only', async () => {
      await setup();
      const a = await h.tenant();
      const { subscriptionId } = await h.subscribe(a);
      h.advanceDays(30);
      await h.deliverAll(h.provider.renew(subscriptionId, { paymentSucceeds: false }));
      const sub = await h.store.findOne('billing_subscriptions', { provider_subscription_id: subscriptionId });
      expect(sub.status).toBe('past_due');
      expect(await access(a)).toBe(true);
      h.advanceDays(6);
      expect(await access(a)).toBe(true);
      h.advanceDays(2); // beyond 7-day grace
      expect(await access(a)).toBe(false);
      await h.deliverAll(h.provider.renew(subscriptionId, { paymentSucceeds: true }));
      expect(await access(a)).toBe(true);
    });

    it('cancel at period end keeps access until the period ends, then revokes', async () => {
      await setup({ cancelPolicy: 'period_end' });
      const a = await h.tenant();
      const { sub } = await h.subscribe(a);
      const overview = await h.service.cancelSubscription(a.tenant_id, { subscriptionId: sub.subscription_id, reason: 'too expensive' });
      expect(overview.subscription.cancel_at_period_end).toBe(true);
      expect(overview.subscription.has_access).toBe(true);
      expect(await access(a)).toBe(true);
      const end = new Date(sub.current_period_end).getTime();
      h.clock.t = new Date(end - 1000);
      expect(await access(a)).toBe(true);
      h.clock.t = new Date(end + 1000); // no renewal slack for a scheduled cancel
      expect(await access(a)).toBe(false);
    });

    it('reactivation before period end restores renewal', async () => {
      await setup();
      const a = await h.tenant();
      const { sub } = await h.subscribe(a);
      await h.service.cancelSubscription(a.tenant_id, { subscriptionId: sub.subscription_id });
      const back = await h.service.reactivateSubscription(a.tenant_id, { subscriptionId: sub.subscription_id });
      expect(back.subscription.cancel_at_period_end).toBe(false);
    });

    it('immediate cancel policy revokes access at once', async () => {
      await setup({ cancelPolicy: 'immediate' });
      const a = await h.tenant();
      const { sub } = await h.subscribe(a);
      await h.service.cancelSubscription(a.tenant_id, { subscriptionId: sub.subscription_id });
      expect(await access(a)).toBe(false);
      expect((await h.store.findOne('billing_subscriptions', { subscription_id: sub.subscription_id })).status).toBe('canceled');
    });

    it('refunds follow the retain_access policy and are counted once', async () => {
      await setup({ refundPolicy: 'retain_access' });
      const a = await h.tenant();
      const { invoiceId } = await h.subscribe(a);
      const p1 = h.provider.refund(invoiceId, 900);
      await h.deliver(p1.event);
      await h.deliver(p1.event); // duplicate delivery
      let pay = await h.store.findOne('billing_payments', { provider_invoice_id: invoiceId });
      expect(pay).toMatchObject({ status: 'partially_refunded', amount_refunded_minor: 900 });
      const p2 = h.provider.refund(invoiceId, 2000);
      await h.deliver(p2.event);
      pay = await h.store.findOne('billing_payments', { provider_invoice_id: invoiceId });
      expect(pay).toMatchObject({ status: 'refunded', amount_refunded_minor: 2900 });
      expect(await h.store.findMany('billing_refunds', { payment_id: pay.payment_id })).toHaveLength(2);
      expect(await access(a)).toBe(true);
    });

    it('revoke_on_full_refund removes access after a full refund', async () => {
      await setup({ refundPolicy: 'revoke_on_full_refund' });
      const a = await h.tenant();
      const { invoiceId } = await h.subscribe(a);
      await h.deliver(h.provider.refund(invoiceId, 1000).event);
      expect(await access(a)).toBe(true);
      await h.deliver(h.provider.refund(invoiceId, 1900).event);
      expect(await access(a)).toBe(false);
    });

    it('operator refund requires confirmation + reason and is audited; effect arrives by webhook', async () => {
      await setup();
      const a = await h.tenant();
      await h.subscribe(a);
      const pay = (await h.store.findMany('billing_payments', { tenant_id: a.tenant_id }))[0];
      await expect(h.service.requestRefund({ paymentId: pay.payment_id, reason: 'goodwill credit' }, h.OPERATOR)).rejects.toMatchObject({ code: 'confirmation_required' });
      await expect(h.service.requestRefund({ paymentId: pay.payment_id, confirm: true }, h.OPERATOR)).rejects.toMatchObject({ code: 'reason_required' });
      await expect(h.service.requestRefund({ paymentId: pay.payment_id, amountMinor: 999999, reason: 'too much', confirm: true }, h.OPERATOR)).rejects.toMatchObject({ code: 'invalid_amount' });
      const r = await h.service.requestRefund({ paymentId: pay.payment_id, amountMinor: 500, reason: 'service outage credit', confirm: true }, h.OPERATOR);
      expect(r).toMatchObject({ amount_minor: 500, status: 'requested' });
      expect((await h.store.findOne('billing_payments', { payment_id: pay.payment_id })).amount_refunded_minor).toBe(0);
      await h.deliverAll(h.provider.events.filter((e) => e.type === 'charge.refunded'));
      expect((await h.store.findOne('billing_payments', { payment_id: pay.payment_id })).amount_refunded_minor).toBe(500);
      expect(await h.store.findMany('billing_audit_events', { action: 'refund.requested' })).toHaveLength(1);
    });

    it('an opened dispute suspends access; a won dispute restores it', async () => {
      await setup({ disputePolicy: 'suspend' });
      const a = await h.tenant();
      const { invoiceId } = await h.subscribe(a);
      await h.deliver(h.provider.dispute(invoiceId));
      expect(await access(a)).toBe(false);
      await h.deliver(h.provider.dispute(invoiceId, { closedStatus: 'won' }));
      expect(await access(a)).toBe(true);
    });
  });

  describe('metering', () => {
    it('usage retries with the same idempotency key are charged once', async () => {
      await setup();
      const a = await h.tenant();
      await h.subscribe(a);
      const key = h.key();
      let runs = 0;
      const op = async () => { runs += 1; return { result: runs }; };
      const first = await h.use(a, key, { operation: op });
      const second = await h.use(a, key, { operation: op });
      expect(first.duplicate).toBe(false);
      expect(second).toMatchObject({ duplicate: true, usage_id: first.usage_id });
      expect(runs).toBe(1);
      expect((await h.service.checkEntitlement(a.tenant_id, 'ai_completions')).used_units).toBe(1);
    });

    it('a failed operation releases its reservation; the retry is charged once', async () => {
      await setup();
      const a = await h.tenant();
      await h.subscribe(a);
      const key = h.key();
      const boom = Object.assign(new Error('model crashed'), { billingCosts: [{ provider: 'ollama', model: 'llama3', inputUnits: 5, outputUnits: 0 }] });
      await expect(h.use(a, key, { operation: async () => { throw boom; } })).rejects.toThrow('model crashed');
      expect((await h.service.checkEntitlement(a.tenant_id, 'ai_completions')).used_units).toBe(0);
      const ok = await h.use(a, key);
      expect(ok.duplicate).toBe(false);
      const row = await h.store.findOne('billing_usage_events', { usage_id: ok.usage_id });
      expect(row).toMatchObject({ status: 'committed', units_committed: 1, attempts: 2 });
      const costs = await h.store.findMany('billing_provider_cost_records', { usage_id: ok.usage_id });
      expect(costs.map((c) => c.succeeded).sort()).toEqual([false, true]);
      expect(costs.every((c) => c.cost_status === 'unpriced' && c.cost_micros === null)).toBe(true);
    });

    it('concurrent requests cannot overspend the allowance', async () => {
      await setup();
      const a = await h.tenant();
      await h.subscribe(a); // ai_completions limit = 5 per period
      const slowOp = async () => { await new Promise((r) => setTimeout(r, 5)); return { result: 'ok' }; };
      const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => h.use(a, `conc-${String(i).padStart(4, '0')}`, { operation: slowOp })));
      const ok = results.filter((r) => r.status === 'fulfilled');
      const refused = results.filter((r) => r.status === 'rejected');
      expect(ok).toHaveLength(5);
      expect(refused.every((r) => r.reason.code === 'quota_exceeded')).toBe(true);
      const ent = await h.service.checkEntitlement(a.tenant_id, 'ai_completions');
      expect(ent).toMatchObject({ used_units: 5, remaining_units: 0, allowed: false });
    });

    it('quota resets at the billing-period boundary', async () => {
      await setup();
      const a = await h.tenant();
      const { subscriptionId } = await h.subscribe(a);
      for (let i = 0; i < 5; i++) await h.use(a);
      await expect(h.use(a)).rejects.toMatchObject({ code: 'quota_exceeded', status: 429 });
      h.advanceDays(31);
      await h.deliverAll(h.provider.renew(subscriptionId));
      const after = await h.use(a);
      expect(after.duplicate).toBe(false);
      expect((await h.service.checkEntitlement(a.tenant_id, 'ai_completions')).used_units).toBe(1);
    });

    it('an expired, never-finalized reservation stops counting and can be retried', async () => {
      await setup();
      const a = await h.tenant();
      await h.subscribe(a);
      const r = await h.store.reserveUsage({ tenantId: a.tenant_id, featureKey: 'ai_completions', units: 5, idempotencyKey: 'crashed-worker-1', now: h.now(), ttlSeconds: 60 });
      expect(r.outcome).toBe('reserved');
      await expect(h.use(a)).rejects.toMatchObject({ code: 'quota_exceeded' });
      h.advance(61 * 1000);
      await expect(h.use(a)).resolves.toMatchObject({ duplicate: false });
      const retry = await h.store.reserveUsage({ tenantId: a.tenant_id, featureKey: 'ai_completions', units: 1, idempotencyKey: 'crashed-worker-1', now: h.now(), ttlSeconds: 60 });
      expect(retry.outcome).toBe('reserved');
    });
  });

  describe('tenant isolation', () => {
    it('tenant B cannot read or change tenant A’s billing records', async () => {
      await setup();
      const a = await h.tenant('Alpha');
      const b = await h.tenant('Beta');
      const { sub } = await h.subscribe(a);
      await expect(h.service.cancelSubscription(b.tenant_id, { subscriptionId: sub.subscription_id })).rejects.toMatchObject({ code: 'not_found', status: 404 });
      await expect(h.service.reactivateSubscription(b.tenant_id, { subscriptionId: sub.subscription_id })).rejects.toMatchObject({ code: 'not_found' });
      const ob = await h.service.getAccountOverview(b.tenant_id);
      expect(ob.subscription).toBeNull();
      expect(ob.payments).toEqual([]);
      expect(ob.usage).toEqual([]);
      await expect(h.use(b)).rejects.toMatchObject({ code: 'not_entitled' });
      expect((await h.store.findOne('billing_subscriptions', { subscription_id: sub.subscription_id })).cancel_at_period_end).toBe(false);
    });

    it('a webhook cannot attach a subscription to a tenant other than the paying customer', async () => {
      await setup();
      const a = await h.tenant('Alpha');
      const b = await h.tenant('Beta');
      const c = await h.checkout(a);
      const sub = h.provider.subscriptions.get(c.subscriptionId);
      sub.metadata.hydi_tenant_id = b.tenant_id; // provider-side metadata says B, customer is A's
      const r = await h.deliver(h.provider._emit('customer.subscription.created', sub));
      expect(r.outcome).toBe('failed');
      expect(await access(b)).toBe(false);
    });
  });

  describe('catalog governance', () => {
    it('published prices are immutable; a new version grandfathers existing subscribers', async () => {
      await setup();
      const a = await h.tenant();
      const { sub } = await h.subscribe(a);
      await expect(h.store.update('billing_price_versions', { price_version_id: h.price.price_version_id }, { unit_amount_minor: 1 }))
        .rejects.toMatchObject({ code: '23514' });
      const pid = h.provider.registerPrice({ unitAmountMinor: 3900, currency: 'usd', interval: 'month' });
      const v2 = await h.service.createPriceVersion({ plan_id: h.plan.plan_id, currency: 'usd', unit_amount_minor: 3900, billing_interval: 'month', provider_price_id: pid }, h.OPERATOR);
      expect(v2.version).toBe(2);
      await h.service.publishPriceVersion(v2.price_version_id, { confirm: true, reason: 'price increase for new customers' }, h.OPERATOR);
      const catalog = await h.service.listPublishedCatalog();
      expect(catalog[0].plans[0].prices).toHaveLength(1);
      expect(catalog[0].plans[0].prices[0]).toMatchObject({ version: 2, unit_amount_minor: 3900 });
      expect((await h.store.findOne('billing_subscriptions', { subscription_id: sub.subscription_id })).price_version_id).toBe(h.price.price_version_id);
      const ov = await h.service.getAccountOverview(a.tenant_id);
      expect(ov.subscription.price.unit_amount_minor).toBe(2900);
    });

    it('archived items are not offered and archiving is final', async () => {
      await setup();
      await h.service.setCatalogStatus('plan', h.plan.plan_id, 'archived', { reason: 'retire starter' }, h.OPERATOR);
      expect(await h.service.listPublishedCatalog()).toEqual([]);
      await expect(h.service.setCatalogStatus('plan', h.plan.plan_id, 'published', { reason: 'bring it back' }, h.OPERATOR))
        .rejects.toMatchObject({ code: 'invalid_transition' });
    });

    it('the audit trail is append-only', async () => {
      await setup();
      const [row] = await h.store.findMany('billing_audit_events', {}, { limit: 1 });
      expect(row).toBeTruthy();
      await expect(h.store.update('billing_audit_events', { audit_id: row.audit_id }, { reason: 'edited' })).rejects.toBeTruthy();
    });
  });
}

module.exports = { defineAcceptanceScenarios, DAY };
