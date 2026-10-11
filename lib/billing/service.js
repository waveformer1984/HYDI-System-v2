'use strict';

/**
 * BillingService — the Revenue Streams Module's domain layer.
 *
 * The monetization loop it implements:
 *   offer (catalog) → checkout (server-validated) → verified webhook
 *   (durable inbox, idempotent) → subscription state (provider-authoritative,
 *   order-safe) → entitlements → metered usage (atomic reservation) →
 *   cost tracking → customer billing management → revenue reporting.
 *
 * Invariants (each is covered by tests/unit/billing):
 *   - Paid access is only ever derived from a provider subscription state that
 *     arrived through a signature-verified webhook or a direct provider read.
 *     A checkout redirect grants nothing.
 *   - Every customer-facing method takes the tenant from the authenticated
 *     principal and filters by it; cross-tenant ids resolve to "not found".
 *   - Amounts come from the catalog/provider, never from the client.
 *   - A terminal subscription (canceled/incomplete_expired) never regains access.
 *   - Usage reservation is atomic per tenant+feature; a retried idempotency
 *     key is never charged twice.
 */

const { BillingError } = require('./errors');
const { assertMinor, normalizeCurrency, toSafeInt } = require('./money');
const policyLib = require('./policy');
const { loadRateCard, estimateCost } = require('./cost-rates');

const KEY_RE = /^[a-z][a-z0-9_]{1,62}$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9_\-:.]{8,200}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATALOG_STATUSES = ['draft', 'published', 'archived'];
const BLOCKING_SUB_STATES = ['trialing', 'active', 'past_due', 'unpaid', 'paused'];
const NON_TERMINAL = policyLib.STATUSES.filter((s) => !policyLib.TERMINAL.includes(s));

function assertUuid(value, field) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new BillingError('invalid_request', `${field} must be a UUID`, 400);
  return value;
}

function assertIdempotencyKey(key) {
  if (typeof key !== 'string' || !IDEMPOTENCY_RE.test(key)) {
    throw new BillingError('invalid_idempotency_key', 'idempotency_key must be 8-200 chars of [A-Za-z0-9_-:.]', 400);
  }
  return key;
}

function assertText(value, field, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new BillingError('invalid_request', `${field} is required (max ${max} chars)`, 400);
  }
  return value.trim();
}

function assertReason(reason) {
  if (typeof reason !== 'string' || reason.trim().length < 5 || reason.length > 500) {
    throw new BillingError('reason_required', 'a reason of 5-500 characters is required for this action', 400);
  }
  return reason.trim();
}

function redactError(err) {
  const msg = err && err.message ? String(err.message) : 'unknown error';
  // Never persist anything that looks like a credential.
  return msg.replace(/(sk|rk|whsec|pk)_(live|test)_[A-Za-z0-9]+/g, '$1_$2_[redacted]').slice(0, 500);
}

class BillingService {
  /**
   * @param {{ store: any, provider: any, policy?: object, clock?: () => Date,
   *           appUrl?: string, rateCard?: object|null, logger?: Console }} deps
   */
  constructor({ store, provider, policy, clock, appUrl, rateCard, logger }) {
    if (!store) throw new Error('BillingService requires a store');
    this.store = store;
    this.provider = provider || null;
    this.policy = policy || policyLib.loadPolicy();
    this.clock = clock || (() => new Date());
    this.appUrl = (appUrl || process.env.BILLING_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
    this.rateCard = rateCard === undefined ? loadRateCard() : rateCard;
    this.logger = logger || console;
  }

  now() { return this.clock(); }

  _requireProvider() {
    if (!this.provider) throw new BillingError('provider_not_configured', 'no billing provider is configured', 503);
    return this.provider;
  }

  async audit(actor, action, target, extra = {}) {
    await this.store.insert('billing_audit_events', {
      actor_type: actor.type,
      actor_id: String(actor.id || 'unknown'),
      action,
      target_type: target.type,
      target_id: String(target.id),
      tenant_id: extra.tenantId || null,
      reason: extra.reason || null,
      before: extra.before === undefined ? null : extra.before,
      after: extra.after === undefined ? null : extra.after,
      created_at: this.now(),
    });
  }

  // ======================================================================
  // Tenants
  // ======================================================================

  async createTenant({ name, email, customerId }, actor) {
    const row = {
      name: assertText(name, 'name'),
      email: assertText(email, 'email', 320).toLowerCase(),
      customer_id: customerId ? assertUuid(customerId, 'customer_id') : null,
      created_at: this.now(),
      updated_at: this.now(),
    };
    if (!row.email.includes('@')) throw new BillingError('invalid_request', 'email is invalid', 400);
    const tenant = await this.store.insert('billing_tenants', row);
    await this.audit(actor, 'tenant.created', { type: 'tenant', id: tenant.tenant_id }, { tenantId: tenant.tenant_id, after: { name: tenant.name } });
    return tenant;
  }

  async getTenant(tenantId) {
    if (!UUID_RE.test(String(tenantId))) return null;
    return this.store.findOne('billing_tenants', { tenant_id: tenantId });
  }

  async _activeTenant(tenantId) {
    const tenant = await this.getTenant(tenantId);
    if (!tenant) throw new BillingError('tenant_not_found', 'tenant not found', 404);
    if (tenant.status !== 'active') throw new BillingError('tenant_inactive', `tenant is ${tenant.status}`, 403);
    return tenant;
  }

  // ======================================================================
  // Catalog (operator)
  // ======================================================================

  async createProduct({ product_key, name, description, revenue_stream }, actor) {
    if (!KEY_RE.test(String(product_key))) throw new BillingError('invalid_request', 'product_key must match ^[a-z][a-z0-9_]{1,62}$', 400);
    const stream = await this.store.findOne('billing_revenue_streams', { stream_key: String(revenue_stream || '') });
    if (!stream || stream.status !== 'active') throw new BillingError('invalid_request', 'revenue_stream is not an active revenue stream', 400);
    const product = await this._insertUnique('billing_products', {
      product_key, name: assertText(name, 'name'), description: String(description || '').slice(0, 2000),
      revenue_stream, created_at: this.now(), updated_at: this.now(),
    }, 'product_key already exists');
    await this.audit(actor, 'catalog.product.created', { type: 'product', id: product.product_id }, { after: product });
    return product;
  }

  async createPlan({ product_id, plan_key, name, description, features, limits, sort_order }, actor) {
    assertUuid(product_id, 'product_id');
    if (!KEY_RE.test(String(plan_key))) throw new BillingError('invalid_request', 'plan_key must match ^[a-z][a-z0-9_]{1,62}$', 400);
    const product = await this.store.findOne('billing_products', { product_id });
    if (!product || product.status === 'archived') throw new BillingError('not_found', 'product not found or archived', 404);
    const feats = Array.isArray(features) ? features : [];
    if (!feats.length || feats.some((f) => !KEY_RE.test(String(f))) || new Set(feats).size !== feats.length) {
      throw new BillingError('invalid_request', 'features must be a non-empty list of unique feature keys', 400);
    }
    const lim = limits && typeof limits === 'object' && !Array.isArray(limits) ? limits : {};
    for (const [k, v] of Object.entries(lim)) {
      if (!KEY_RE.test(k) || !Number.isSafeInteger(v) || v < 0) throw new BillingError('invalid_request', `limit ${k} must be a non-negative integer`, 400);
    }
    const plan = await this._insertUnique('billing_plans', {
      product_id, plan_key, name: assertText(name, 'name'), description: String(description || '').slice(0, 2000),
      features: feats, limits: lim, sort_order: Number.isSafeInteger(sort_order) ? sort_order : 0,
      created_at: this.now(), updated_at: this.now(),
    }, 'plan_key already exists');
    await this.audit(actor, 'catalog.plan.created', { type: 'plan', id: plan.plan_id }, { after: plan });
    return plan;
  }

  async createPriceVersion({ plan_id, currency, unit_amount_minor, billing_interval, interval_count, trial_days, provider_price_id }, actor) {
    assertUuid(plan_id, 'plan_id');
    const plan = await this.store.findOne('billing_plans', { plan_id });
    if (!plan || plan.status === 'archived') throw new BillingError('not_found', 'plan not found or archived', 404);
    if (!['month', 'year'].includes(billing_interval)) throw new BillingError('invalid_request', 'billing_interval must be month or year', 400);
    const intervalCount = interval_count === undefined ? 1 : interval_count;
    if (!Number.isSafeInteger(intervalCount) || intervalCount < 1 || intervalCount > 12) throw new BillingError('invalid_request', 'interval_count must be 1-12', 400);
    const trial = trial_days === undefined ? 0 : trial_days;
    if (!Number.isSafeInteger(trial) || trial < 0 || trial > 90) throw new BillingError('invalid_request', 'trial_days must be 0-90', 400);
    const existing = await this.store.findMany('billing_price_versions', { plan_id }, { orderBy: ['version', 'desc'], limit: 1 });
    const version = existing.length ? existing[0].version + 1 : 1;
    const pv = await this._insertUnique('billing_price_versions', {
      plan_id, version, currency: normalizeCurrency(currency), unit_amount_minor: assertMinor(unit_amount_minor, 'unit_amount_minor'),
      billing_interval, interval_count: intervalCount, trial_days: trial,
      provider: this.provider ? this.provider.name : 'stripe',
      provider_price_id: provider_price_id ? assertText(provider_price_id, 'provider_price_id') : null,
      created_at: this.now(),
    }, 'price version or provider price already exists');
    await this.audit(actor, 'catalog.price.created', { type: 'price_version', id: pv.price_version_id }, { after: pv });
    return pv;
  }

  /**
   * Publishes a draft price version. Requires a provider price — either one
   * already set on the draft, or created now when createInProvider is true.
   */
  async publishPriceVersion(priceVersionId, { createInProvider = false, confirm = false, reason } = {}, actor) {
    assertUuid(priceVersionId, 'price_version_id');
    if (confirm !== true) throw new BillingError('confirmation_required', 'publishing a price requires confirm: true', 400);
    const why = assertReason(reason);
    const pv = await this.store.findOne('billing_price_versions', { price_version_id: priceVersionId });
    if (!pv) throw new BillingError('not_found', 'price version not found', 404);
    if (pv.status !== 'draft') throw new BillingError('invalid_transition', `price version is ${pv.status}`, 409);
    let providerPriceId = pv.provider_price_id;
    if (!providerPriceId) {
      if (!createInProvider) throw new BillingError('provider_price_required', 'set provider_price_id or pass createInProvider: true', 400);
      const plan = await this.store.findOne('billing_plans', { plan_id: pv.plan_id });
      const product = await this.store.findOne('billing_products', { product_id: plan.product_id });
      const created = await this._requireProvider().createPrice({
        productKey: product.product_key, productName: `${product.name} — ${plan.name}`,
        unitAmountMinor: pv.unit_amount_minor, currency: pv.currency, interval: pv.billing_interval,
        intervalCount: pv.interval_count, idempotencyKey: `price-${pv.price_version_id}`,
      });
      providerPriceId = created.providerPriceId;
    }
    const [after] = await this.store.update('billing_price_versions', { price_version_id: priceVersionId, status: 'draft' }, {
      provider_price_id: providerPriceId, status: 'published', published_at: this.now(),
    });
    if (!after) throw new BillingError('invalid_transition', 'price version changed concurrently', 409);
    await this.audit(actor, 'catalog.price.published', { type: 'price_version', id: priceVersionId }, { reason: why, before: pv, after });
    return after;
  }

  /** draft → published → archived; archived is final. */
  async setCatalogStatus(kind, id, status, { reason } = {}, actor) {
    const table = { product: 'billing_products', plan: 'billing_plans', price: 'billing_price_versions' }[kind];
    if (!table) throw new BillingError('invalid_request', 'kind must be product, plan or price', 400);
    if (!CATALOG_STATUSES.includes(status) || status === 'draft') throw new BillingError('invalid_request', 'status must be published or archived', 400);
    if (kind === 'price' && status === 'published') throw new BillingError('invalid_request', 'use publishPriceVersion for prices', 400);
    const why = assertReason(reason);
    assertUuid(id, 'id');
    const pk = { product: 'product_id', plan: 'plan_id', price: 'price_version_id' }[kind];
    const before = await this.store.findOne(table, { [pk]: id });
    if (!before) throw new BillingError('not_found', `${kind} not found`, 404);
    const allowed = { draft: ['published', 'archived'], published: ['archived'], archived: [] }[before.status];
    if (!allowed.includes(status)) throw new BillingError('invalid_transition', `${kind} cannot move from ${before.status} to ${status}`, 409);
    const patch = kind === 'price' ? { status } : { status, updated_at: this.now() };
    const [after] = await this.store.update(table, { [pk]: id, status: before.status }, patch);
    if (!after) throw new BillingError('invalid_transition', `${kind} changed concurrently`, 409);
    await this.audit(actor, `catalog.${kind}.${status}`, { type: kind, id }, { reason: why, before: { status: before.status }, after: { status } });
    return after;
  }

  async _insertUnique(table, row, conflictMessage) {
    try {
      return await this.store.insert(table, row);
    } catch (err) {
      if (err && err.code === '23505') throw new BillingError('conflict', conflictMessage, 409);
      throw err;
    }
  }

  /**
   * Public catalog: published products → published plans → their latest
   * published price versions. Archived/draft never appear.
   */
  async listPublishedCatalog() {
    const products = await this.store.findMany('billing_products', { status: 'published' }, { orderBy: ['name', 'asc'] });
    const out = [];
    for (const product of products) {
      const plans = await this.store.findMany('billing_plans', { product_id: product.product_id, status: 'published' }, { orderBy: ['sort_order', 'asc'] });
      const planViews = [];
      for (const plan of plans) {
        const prices = await this.store.findMany('billing_price_versions', { plan_id: plan.plan_id, status: 'published' }, { orderBy: ['version', 'desc'] });
        // Latest published version per (currency, interval) is the one on offer.
        const seen = new Set();
        const offered = prices.filter((p) => {
          const k = `${p.currency}:${p.billing_interval}:${p.interval_count}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        }).map((p) => ({
          price_version_id: p.price_version_id, version: p.version, currency: p.currency,
          unit_amount_minor: p.unit_amount_minor, billing_interval: p.billing_interval,
          interval_count: p.interval_count, trial_days: p.trial_days,
        }));
        if (offered.length) {
          planViews.push({ plan_id: plan.plan_id, plan_key: plan.plan_key, name: plan.name, description: plan.description, features: plan.features, limits: plan.limits, prices: offered });
        }
      }
      if (planViews.length) {
        out.push({ product_id: product.product_id, product_key: product.product_key, name: product.name, description: product.description, revenue_stream: product.revenue_stream, plans: planViews });
      }
    }
    return out;
  }

  async listCatalogAdmin() {
    const [products, plans, prices] = await Promise.all([
      this.store.findMany('billing_products', {}, { orderBy: ['created_at', 'asc'] }),
      this.store.findMany('billing_plans', {}, { orderBy: ['sort_order', 'asc'] }),
      this.store.findMany('billing_price_versions', {}, { orderBy: ['version', 'asc'] }),
    ]);
    return { products, plans, prices };
  }

  // ======================================================================
  // Checkout (customer)
  // ======================================================================

  /**
   * Starts a hosted checkout for `tenantId` (from the authenticated
   * principal). The client supplies only a price_version_id; the amount is
   * whatever the provider price on that published version says.
   */
  async startCheckout(tenantId, { priceVersionId, idempotencyKey }) {
    const tenant = await this._activeTenant(tenantId);
    assertUuid(priceVersionId, 'price_version_id');
    assertIdempotencyKey(idempotencyKey);

    const pv = await this.store.findOne('billing_price_versions', { price_version_id: priceVersionId, status: 'published' });
    const plan = pv && await this.store.findOne('billing_plans', { plan_id: pv.plan_id, status: 'published' });
    const product = plan && await this.store.findOne('billing_products', { product_id: plan.product_id, status: 'published' });
    if (!pv || !plan || !product) throw new BillingError('price_not_available', 'that price is not available for purchase', 404);

    const live = await this.store.findMany('billing_subscriptions', { tenant_id: tenant.tenant_id, status: { in: BLOCKING_SUB_STATES } }, { limit: 1 });
    if (live.length) throw new BillingError('subscription_exists', 'tenant already has a subscription; change plans from billing settings', 409);

    let intent = await this.store.findOne('billing_checkout_intents', { tenant_id: tenant.tenant_id, idempotency_key: idempotencyKey });
    if (intent && intent.price_version_id !== priceVersionId) {
      throw new BillingError('idempotency_key_reused', 'idempotency_key was already used for a different price', 409);
    }
    if (intent && intent.status === 'open' && intent.checkout_url) {
      return { intent_id: intent.intent_id, url: intent.checkout_url, reused: true };
    }
    if (intent && intent.status !== 'created') {
      throw new BillingError('checkout_closed', `checkout ${intent.status}; start a new one with a new idempotency_key`, 409);
    }
    if (!intent) {
      intent = await this.store.insert('billing_checkout_intents', {
        tenant_id: tenant.tenant_id, price_version_id: priceVersionId, idempotency_key: idempotencyKey,
        provider: this._requireProvider().name, created_at: this.now(),
      }, { ignoreConflict: true })
        || await this.store.findOne('billing_checkout_intents', { tenant_id: tenant.tenant_id, idempotency_key: idempotencyKey });
    }

    const provider = this._requireProvider();
    let providerCustomerId = tenant.provider_customer_id;
    if (!providerCustomerId) {
      const created = await provider.createCustomer({
        tenantId: tenant.tenant_id, name: tenant.name, email: tenant.email, idempotencyKey: `tenant-customer-${tenant.tenant_id}`,
      });
      providerCustomerId = created.providerCustomerId;
      const [updated] = await this.store.update('billing_tenants', { tenant_id: tenant.tenant_id, provider_customer_id: null }, {
        provider_customer_id: providerCustomerId, updated_at: this.now(),
      });
      if (!updated) {
        const fresh = await this.getTenant(tenant.tenant_id);
        providerCustomerId = fresh.provider_customer_id;
      }
    }

    const metadata = {
      hydi_tenant_id: tenant.tenant_id,
      hydi_price_version_id: pv.price_version_id,
      hydi_checkout_intent_id: intent.intent_id,
    };
    const session = await provider.createCheckoutSession({
      providerCustomerId,
      providerPriceId: pv.provider_price_id,
      trialDays: pv.trial_days,
      successUrl: `${this.appUrl}/billing?checkout=return&intent=${intent.intent_id}`,
      cancelUrl: `${this.appUrl}/pricing?checkout=canceled`,
      metadata,
      idempotencyKey: `checkout-${intent.intent_id}`,
    });
    const [opened] = await this.store.update('billing_checkout_intents', { intent_id: intent.intent_id }, {
      provider_session_id: session.sessionId, checkout_url: session.url, status: 'open',
    });
    await this.audit({ type: 'customer', id: tenant.tenant_id }, 'checkout.started', { type: 'checkout_intent', id: intent.intent_id }, {
      tenantId: tenant.tenant_id, after: { price_version_id: pv.price_version_id, unit_amount_minor: pv.unit_amount_minor, currency: pv.currency },
    });
    return { intent_id: opened.intent_id, url: session.url, reused: false };
  }

  // ======================================================================
  // Webhooks: verify → store durably → process (idempotent, retryable)
  // ======================================================================

  /**
   * Verifies and durably stores a webhook delivery. Throws BillingError
   * (400) on a bad signature. Returns { duplicate, eventRowId }.
   */
  async receiveWebhook(rawBody, headers) {
    const provider = this._requireProvider();
    const event = provider.verifyWebhook(rawBody, headers);
    const meta = provider.describeEvent(event);
    if (provider.mode === 'test' && meta.livemode) throw new BillingError('livemode_mismatch', 'live event sent to a test-mode endpoint', 400);
    if (provider.mode === 'live' && !meta.livemode) throw new BillingError('livemode_mismatch', 'test event sent to a live-mode endpoint', 400);
    const row = await this.store.insert('billing_webhook_events', {
      provider: provider.name,
      provider_event_id: meta.id,
      event_type: meta.type,
      livemode: meta.livemode,
      provider_created_at: meta.created,
      payload: event,
      received_at: this.now(),
      next_attempt_at: this.now(),
    }, { ignoreConflict: true });
    if (!row) {
      const existing = await this.store.findOne('billing_webhook_events', { provider: provider.name, provider_event_id: meta.id });
      return { duplicate: true, eventRowId: existing ? existing.event_row_id : null, status: existing ? existing.status : null };
    }
    return { duplicate: false, eventRowId: row.event_row_id, status: row.status };
  }

  /** Processes one stored event. Safe to call concurrently and repeatedly. */
  async processWebhookEvent(eventRowId) {
    const now = this.now();
    const claimed = await this.store.claimWebhookEvent(eventRowId, now, 120);
    if (!claimed) return { outcome: 'not_claimable' };
    const row = await this.store.findOne('billing_webhook_events', { event_row_id: eventRowId });
    try {
      const normalized = this._requireProvider().normalizeEvent(row.payload);
      const result = await this._handleEvent(normalized, { eventId: row.provider_event_id, created: new Date(row.provider_created_at) });
      await this.store.update('billing_webhook_events', { event_row_id: eventRowId }, {
        status: result === 'ignored' ? 'ignored' : 'processed', processed_at: this.now(), last_error: null, locked_until: null,
      });
      return { outcome: result };
    } catch (err) {
      const dead = row.attempts >= this.policy.webhookMaxAttempts;
      const backoffMs = Math.min(2 ** row.attempts * 30000, 6 * 60 * 60 * 1000);
      await this.store.update('billing_webhook_events', { event_row_id: eventRowId }, {
        status: dead ? 'dead_letter' : 'failed',
        last_error: redactError(err),
        next_attempt_at: new Date(this.now().getTime() + backoffMs),
        locked_until: null,
      });
      this.logger.error(`[billing] webhook ${row.provider_event_id} (${row.event_type}) ${dead ? 'dead-lettered' : 'failed'}: ${redactError(err)}`);
      return { outcome: dead ? 'dead_letter' : 'failed', error: redactError(err) };
    }
  }

  /** Retry worker entry point: processes every due received/failed event. */
  async processDueWebhookEvents({ limit = 50 } = {}) {
    const due = await this.store.findMany('billing_webhook_events', {
      status: { in: ['received', 'failed', 'processing'] }, next_attempt_at: { lte: this.now() },
    }, { orderBy: ['provider_created_at', 'asc'], limit });
    const results = [];
    for (const ev of due) results.push({ event_row_id: ev.event_row_id, ...(await this.processWebhookEvent(ev.event_row_id)) });
    return results;
  }

  /** Operator replay of a dead-lettered (or failed/ignored) event. */
  async replayWebhookEvent(eventRowId, { reason, confirm } = {}, actor) {
    assertUuid(eventRowId, 'event_row_id');
    if (confirm !== true) throw new BillingError('confirmation_required', 'replay requires confirm: true', 400);
    const why = assertReason(reason);
    const before = await this.store.findOne('billing_webhook_events', { event_row_id: eventRowId });
    if (!before) throw new BillingError('not_found', 'event not found', 404);
    if (!['dead_letter', 'failed', 'ignored'].includes(before.status)) {
      throw new BillingError('invalid_transition', `cannot replay an event in status ${before.status}`, 409);
    }
    await this.store.update('billing_webhook_events', { event_row_id: eventRowId, status: before.status }, {
      status: 'received', next_attempt_at: this.now(), attempts: 0,
    });
    await this.audit(actor, 'webhook.replayed', { type: 'webhook_event', id: eventRowId }, { reason: why, before: { status: before.status, last_error: before.last_error } });
    return this.processWebhookEvent(eventRowId);
  }

  async _handleEvent(ev, meta) {
    switch (ev.kind) {
      case 'checkout.completed': return this._onCheckoutCompleted(ev);
      case 'checkout.expired': return this._onCheckoutExpired(ev);
      case 'subscription.snapshot': return this.applySubscriptionSnapshot(ev.subscription, meta.created, { source: `webhook:${meta.eventId}` });
      case 'invoice.paid': return this._onInvoice(ev.invoice, 'succeeded');
      case 'invoice.payment_failed': return this._onInvoice(ev.invoice, 'failed');
      case 'charge.refunded': return this._onChargeRefunded(ev.charge);
      case 'dispute.created': return this._onDispute(ev.dispute, true);
      case 'dispute.closed': return this._onDispute(ev.dispute, false);
      default: return 'ignored';
    }
  }

  async _onCheckoutCompleted(ev) {
    const intent = await this.store.findOne('billing_checkout_intents', { provider_session_id: ev.sessionId });
    if (!intent) return 'ignored'; // not a Hydi billing checkout (shared provider account)
    if (intent.status !== 'completed') {
      await this.store.update('billing_checkout_intents', { intent_id: intent.intent_id }, { status: 'completed', completed_at: this.now() });
    }
    if (ev.providerSubscriptionId) {
      // Grant nothing from the session itself: read the subscription from the
      // provider, whose status says whether payment actually succeeded.
      await this.syncSubscriptionFromProvider(ev.providerSubscriptionId, { expectedTenantId: intent.tenant_id });
    }
    return 'processed';
  }

  async _onCheckoutExpired(ev) {
    const intent = await this.store.findOne('billing_checkout_intents', { provider_session_id: ev.sessionId });
    if (!intent) return 'ignored';
    await this.store.update('billing_checkout_intents', { intent_id: intent.intent_id, status: { in: ['created', 'open'] } }, { status: 'expired' });
    return 'processed';
  }

  async syncSubscriptionFromProvider(providerSubscriptionId, opts = {}) {
    const snap = await this._requireProvider().retrieveSubscription(providerSubscriptionId);
    const existing = await this.store.findOne('billing_subscriptions', { provider: this.provider.name, provider_subscription_id: providerSubscriptionId });
    // A direct provider read is the freshest state we can have.
    let at = this.now();
    if (existing && new Date(existing.provider_state_at).getTime() >= at.getTime()) {
      at = new Date(new Date(existing.provider_state_at).getTime() + 1);
    }
    return this.applySubscriptionSnapshot(snap, at, { source: opts.source || 'provider_read', expectedTenantId: opts.expectedTenantId });
  }

  async _tenantForSnapshot(snap, expectedTenantId) {
    const byCustomer = snap.providerCustomerId
      ? await this.store.findOne('billing_tenants', { provider: this.provider.name, provider_customer_id: snap.providerCustomerId })
      : null;
    const metaTenantId = snap.metadata && snap.metadata.hydi_tenant_id;
    if (!byCustomer && !metaTenantId && !expectedTenantId) return null;
    const tenant = byCustomer || await this.getTenant(metaTenantId || expectedTenantId);
    if (!tenant) throw new BillingError('tenant_not_found', 'subscription references an unknown tenant', 422);
    for (const claimed of [metaTenantId, expectedTenantId]) {
      if (claimed && claimed !== tenant.tenant_id) {
        throw new BillingError('tenant_mismatch', 'subscription tenant metadata does not match the provider customer', 422);
      }
    }
    if (tenant.provider_customer_id && snap.providerCustomerId && tenant.provider_customer_id !== snap.providerCustomerId) {
      throw new BillingError('tenant_mismatch', 'subscription customer does not belong to tenant', 422);
    }
    return tenant;
  }

  /**
   * Applies a provider subscription snapshot taken at `stateAt`, then
   * recomputes entitlements. Order-safe: stale snapshots and anything after a
   * terminal state are ignored. Returns 'processed' | 'ignored'.
   */
  async applySubscriptionSnapshot(snap, stateAt, ctx = {}) {
    if (!policyLib.STATUSES.includes(snap.status)) throw new BillingError('invalid_state', `unknown subscription status ${snap.status}`, 422);
    const providerName = this._requireProvider().name;
    const existing = await this.store.findOne('billing_subscriptions', { provider: providerName, provider_subscription_id: snap.providerSubscriptionId });
    const decision = policyLib.compareSnapshot(existing, snap, stateAt);
    if (decision === 'stale' || decision === 'terminal' || decision === 'same') return 'ignored';
    if (decision === 'ambiguous') return this.syncSubscriptionFromProvider(snap.providerSubscriptionId, { source: 'tie_break', expectedTenantId: existing.tenant_id });

    const tenant = existing
      ? await this.getTenant(existing.tenant_id)
      : await this._tenantForSnapshot(snap, ctx.expectedTenantId);
    if (!tenant) return 'ignored'; // not a Hydi billing subscription
    if (existing && ctx.expectedTenantId && ctx.expectedTenantId !== existing.tenant_id) {
      throw new BillingError('tenant_mismatch', 'subscription belongs to a different tenant', 422);
    }

    const pv = await this.store.findOne('billing_price_versions', { provider: providerName, provider_price_id: snap.providerPriceId });
    if (!pv) throw new BillingError('unknown_price', `provider price ${snap.providerPriceId} is not in the catalog`, 422);

    const pastDueSince = snap.status === 'past_due'
      ? (existing && existing.status === 'past_due' && existing.past_due_since ? existing.past_due_since : stateAt)
      : null;
    const fields = {
      tenant_id: tenant.tenant_id,
      price_version_id: pv.price_version_id,
      status: snap.status,
      cancel_at_period_end: !!snap.cancelAtPeriodEnd,
      current_period_start: snap.currentPeriodStart,
      current_period_end: snap.currentPeriodEnd,
      trial_end: snap.trialEnd,
      past_due_since: pastDueSince,
      canceled_at: snap.canceledAt,
      ended_at: snap.endedAt,
      provider_state_at: stateAt,
      updated_at: this.now(),
    };

    let sub;
    if (existing) {
      [sub] = await this.store.update('billing_subscriptions', {
        subscription_id: existing.subscription_id,
        provider_state_at: { lte: stateAt },
        status: { in: NON_TERMINAL },
      }, fields);
      if (!sub) return 'ignored'; // lost a race to a newer snapshot
    } else {
      sub = await this.store.insert('billing_subscriptions', {
        ...fields, provider: providerName, provider_subscription_id: snap.providerSubscriptionId, created_at: this.now(),
      }, { ignoreConflict: true });
      if (!sub) return this.applySubscriptionSnapshot(snap, stateAt, ctx); // concurrent insert: re-evaluate
    }

    await this._recomputeEntitlements(sub);
    if (!existing || existing.status !== sub.status || existing.cancel_at_period_end !== sub.cancel_at_period_end
      || existing.price_version_id !== sub.price_version_id) {
      await this.audit({ type: 'provider', id: providerName }, 'subscription.state_changed', { type: 'subscription', id: sub.subscription_id }, {
        tenantId: sub.tenant_id, reason: ctx.source || null,
        before: existing ? { status: existing.status, cancel_at_period_end: existing.cancel_at_period_end, price_version_id: existing.price_version_id } : null,
        after: { status: sub.status, cancel_at_period_end: sub.cancel_at_period_end, price_version_id: sub.price_version_id },
      });
    }
    return 'processed';
  }

  async _recomputeEntitlements(sub) {
    const pv = await this.store.findOne('billing_price_versions', { price_version_id: sub.price_version_id });
    const plan = await this.store.findOne('billing_plans', { plan_id: pv.plan_id });
    const accessUntil = policyLib.computeAccessUntil(sub, this.policy);
    const periodStart = sub.current_period_start || sub.created_at;
    const periodEnd = sub.current_period_end || accessUntil || periodStart;
    const features = Array.isArray(plan.features) ? plan.features : [];
    const limits = plan.limits || {};
    for (const feature of features) {
      const values = {
        limit_units: Object.prototype.hasOwnProperty.call(limits, feature) ? toSafeInt(limits[feature]) : null,
        period_start: periodStart,
        period_end: periodEnd,
        access_until: accessUntil,
        status: accessUntil ? 'active' : 'revoked',
        updated_at: this.now(),
      };
      const key = { tenant_id: sub.tenant_id, feature_key: feature, source_type: 'subscription', source_id: sub.subscription_id };
      const updated = await this.store.update('billing_entitlements', key, values);
      if (!updated.length) {
        const inserted = await this.store.insert('billing_entitlements', { ...key, ...values }, { ignoreConflict: true });
        if (!inserted) await this.store.update('billing_entitlements', key, values);
      }
    }
    const stale = await this.store.findMany('billing_entitlements', { tenant_id: sub.tenant_id, source_type: 'subscription', source_id: sub.subscription_id, status: 'active' });
    for (const ent of stale) {
      if (!features.includes(ent.feature_key)) {
        await this.store.update('billing_entitlements', { entitlement_id: ent.entitlement_id }, { status: 'revoked', access_until: null, updated_at: this.now() });
      }
    }
  }

  async _setAccessHold(subscriptionId, hold, reason) {
    const [sub] = await this.store.update('billing_subscriptions', { subscription_id: subscriptionId }, { access_hold: hold, updated_at: this.now() });
    if (!sub) return;
    await this._recomputeEntitlements(sub);
    await this.audit({ type: 'system', id: 'billing-policy' }, hold ? 'subscription.access_held' : 'subscription.access_hold_cleared',
      { type: 'subscription', id: subscriptionId }, { tenantId: sub.tenant_id, reason, after: { access_hold: hold } });
  }

  async _onInvoice(inv, outcome) {
    const providerName = this._requireProvider().name;
    const tenant = inv.providerCustomerId
      ? await this.store.findOne('billing_tenants', { provider: providerName, provider_customer_id: inv.providerCustomerId })
      : null;
    if (!tenant) return 'ignored';
    let sub = null;
    if (inv.providerSubscriptionId) {
      sub = await this.store.findOne('billing_subscriptions', { provider: providerName, provider_subscription_id: inv.providerSubscriptionId });
      if (!sub) {
        // Invoice arrived before the subscription: read it from the provider.
        await this.syncSubscriptionFromProvider(inv.providerSubscriptionId, { expectedTenantId: tenant.tenant_id });
        sub = await this.store.findOne('billing_subscriptions', { provider: providerName, provider_subscription_id: inv.providerSubscriptionId });
      }
    }
    const existing = await this.store.findOne('billing_payments', { provider: providerName, provider_invoice_id: inv.providerInvoiceId });
    const currency = normalizeCurrency(inv.currency);
    if (existing) {
      // A late payment_failed must never downgrade a recorded success.
      if (outcome === 'failed' || existing.status !== 'failed') return 'ignored';
      await this.store.update('billing_payments', { payment_id: existing.payment_id }, {
        status: 'succeeded', amount_minor: assertMinor(inv.amountPaidMinor), tax_minor: inv.taxMinor,
        provider_payment_intent: inv.paymentIntent || existing.provider_payment_intent,
        hosted_invoice_url: inv.hostedInvoiceUrl, occurred_at: inv.occurredAt, updated_at: this.now(),
      });
      return 'processed';
    }
    await this.store.insert('billing_payments', {
      tenant_id: tenant.tenant_id,
      subscription_id: sub ? sub.subscription_id : null,
      provider: providerName,
      provider_invoice_id: inv.providerInvoiceId,
      provider_payment_intent: inv.paymentIntent,
      status: outcome,
      currency,
      amount_minor: assertMinor(outcome === 'succeeded' ? inv.amountPaidMinor : inv.amountDueMinor),
      tax_minor: inv.taxMinor,
      hosted_invoice_url: inv.hostedInvoiceUrl,
      occurred_at: inv.occurredAt,
      updated_at: this.now(),
    }, { ignoreConflict: true });
    return 'processed';
  }

  async _paymentForCharge({ paymentIntent, providerInvoiceId }) {
    const providerName = this._requireProvider().name;
    if (paymentIntent) {
      const p = await this.store.findOne('billing_payments', { provider: providerName, provider_payment_intent: paymentIntent });
      if (p) return p;
    }
    let invoiceId = providerInvoiceId;
    if (!invoiceId && paymentIntent) invoiceId = await this.provider.findInvoiceForPaymentIntent(paymentIntent);
    if (!invoiceId) return null;
    return this.store.findOne('billing_payments', { provider: providerName, provider_invoice_id: invoiceId });
  }

  _paymentStatus(p) {
    if (p.amount_disputed_minor > 0) return 'disputed';
    if (p.amount_refunded_minor >= p.amount_minor && p.amount_minor > 0) return 'refunded';
    if (p.amount_refunded_minor > 0) return 'partially_refunded';
    return 'succeeded';
  }

  async _onChargeRefunded(charge) {
    const payment = await this._paymentForCharge(charge);
    if (!payment) return 'ignored';
    for (const r of charge.refunds) {
      if (!r.providerRefundId || !Number.isSafeInteger(r.amountMinor) || r.amountMinor <= 0) continue;
      await this.store.insert('billing_refunds', {
        payment_id: payment.payment_id, tenant_id: payment.tenant_id, provider: payment.provider,
        provider_refund_id: r.providerRefundId, amount_minor: r.amountMinor, currency: payment.currency,
        status: String(r.status || 'succeeded'), occurred_at: r.occurredAt,
      }, { ignoreConflict: true });
    }
    // Refund totals only ever grow, so out-of-order refund events are safe.
    const refunded = Math.max(payment.amount_refunded_minor, assertMinor(charge.amountRefundedTotalMinor));
    const next = { ...payment, amount_refunded_minor: Math.min(refunded, payment.amount_minor) };
    await this.store.update('billing_payments', { payment_id: payment.payment_id }, {
      amount_refunded_minor: next.amount_refunded_minor, status: this._paymentStatus(next), updated_at: this.now(),
    });
    const fullyRefunded = next.amount_refunded_minor >= payment.amount_minor && payment.amount_minor > 0;
    if (fullyRefunded && this.policy.refundPolicy === 'revoke_on_full_refund' && payment.subscription_id) {
      await this._setAccessHold(payment.subscription_id, 'refunded', 'refund policy: revoke_on_full_refund');
    }
    return 'processed';
  }

  async _onDispute(dispute, opened) {
    const payment = await this._paymentForCharge({ paymentIntent: dispute.paymentIntent });
    if (!payment) return 'ignored';
    if (opened) {
      const next = { ...payment, amount_disputed_minor: Math.min(assertMinor(dispute.amountMinor), payment.amount_minor) };
      await this.store.update('billing_payments', { payment_id: payment.payment_id }, {
        amount_disputed_minor: next.amount_disputed_minor, status: this._paymentStatus(next), updated_at: this.now(),
      });
      if (this.policy.disputePolicy === 'suspend' && payment.subscription_id) {
        await this._setAccessHold(payment.subscription_id, 'dispute', 'dispute opened');
      }
      return 'processed';
    }
    if (dispute.status === 'won') {
      const next = { ...payment, amount_disputed_minor: 0 };
      await this.store.update('billing_payments', { payment_id: payment.payment_id }, {
        amount_disputed_minor: 0, status: this._paymentStatus(next), updated_at: this.now(),
      });
      if (payment.subscription_id) {
        const sub = await this.store.findOne('billing_subscriptions', { subscription_id: payment.subscription_id });
        if (sub && sub.access_hold === 'dispute') await this._setAccessHold(sub.subscription_id, null, 'dispute won');
      }
    }
    return 'processed';
  }

  // ======================================================================
  // Customer billing management
  // ======================================================================

  async getAccountOverview(tenantId) {
    const tenant = await this.getTenant(tenantId);
    if (!tenant) throw new BillingError('tenant_not_found', 'tenant not found', 404);
    const now = this.now();
    const subs = await this.store.findMany('billing_subscriptions', { tenant_id: tenant.tenant_id }, { orderBy: ['created_at', 'desc'] });
    const current = subs.find((s) => !policyLib.isTerminal(s.status)) || subs[0] || null;
    let plan = null;
    let price = null;
    if (current) {
      price = await this.store.findOne('billing_price_versions', { price_version_id: current.price_version_id });
      plan = price && await this.store.findOne('billing_plans', { plan_id: price.plan_id });
    }
    const entitlements = await this.store.findMany('billing_entitlements', { tenant_id: tenant.tenant_id, status: 'active' });
    const usage = [];
    for (const ent of entitlements) {
      if (!ent.access_until || new Date(ent.access_until).getTime() <= now.getTime()) continue;
      usage.push(await this._usageFor(ent, now));
    }
    const payments = await this.store.findMany('billing_payments', { tenant_id: tenant.tenant_id }, { orderBy: ['occurred_at', 'desc'], limit: 24 });
    const pending = await this.store.findMany('billing_checkout_intents', { tenant_id: tenant.tenant_id, status: { in: ['created', 'open'] } }, { orderBy: ['created_at', 'desc'], limit: 5 });
    const accessUntil = current ? policyLib.computeAccessUntil(current, this.policy) : null;
    return {
      tenant: { tenant_id: tenant.tenant_id, name: tenant.name, email: tenant.email, status: tenant.status },
      subscription: current ? {
        subscription_id: current.subscription_id,
        status: current.status,
        has_access: !!accessUntil && accessUntil.getTime() > now.getTime(),
        access_until: accessUntil,
        access_hold: current.access_hold,
        cancel_at_period_end: current.cancel_at_period_end,
        current_period_start: current.current_period_start,
        current_period_end: current.current_period_end,
        trial_end: current.trial_end,
        past_due_since: current.past_due_since,
        plan: plan ? { plan_id: plan.plan_id, plan_key: plan.plan_key, name: plan.name, features: plan.features, limits: plan.limits } : null,
        price: price ? { price_version_id: price.price_version_id, version: price.version, currency: price.currency, unit_amount_minor: price.unit_amount_minor, billing_interval: price.billing_interval, interval_count: price.interval_count } : null,
      } : null,
      usage,
      payments: payments.map((p) => ({
        payment_id: p.payment_id, status: p.status, currency: p.currency, amount_minor: p.amount_minor,
        amount_refunded_minor: p.amount_refunded_minor, tax_minor: p.tax_minor, occurred_at: p.occurred_at,
        invoice_url: p.hosted_invoice_url,
      })),
      pending_checkouts: pending.map((i) => ({ intent_id: i.intent_id, status: i.status, created_at: i.created_at })),
    };
  }

  async _usageFor(ent, now) {
    const rows = await this.store.findMany('billing_usage_events', { entitlement_id: ent.entitlement_id, period_start: ent.period_start });
    const used = rows.reduce((s, u) => {
      if (u.status === 'committed') return s + u.units_committed;
      if (u.status === 'reserved' && new Date(u.expires_at).getTime() > now.getTime()) return s + u.units_reserved;
      return s;
    }, 0);
    return {
      feature_key: ent.feature_key, limit_units: ent.limit_units, used_units: used,
      remaining_units: ent.limit_units === null ? null : Math.max(ent.limit_units - used, 0),
      period_start: ent.period_start, period_end: ent.period_end, access_until: ent.access_until,
    };
  }

  async createPortalSession(tenantId) {
    const tenant = await this._activeTenant(tenantId);
    if (!tenant.provider_customer_id) throw new BillingError('no_billing_account', 'no billing account exists yet; purchase a plan first', 409);
    return this._requireProvider().createPortalSession({ providerCustomerId: tenant.provider_customer_id, returnUrl: `${this.appUrl}/billing` });
  }

  async _ownSubscription(tenantId, subscriptionId) {
    assertUuid(subscriptionId, 'subscription_id');
    const sub = await this.store.findOne('billing_subscriptions', { subscription_id: subscriptionId, tenant_id: tenantId });
    if (!sub) throw new BillingError('not_found', 'subscription not found', 404);
    return sub;
  }

  /** Customer cancellation, applying BILLING_CANCEL_POLICY. */
  async cancelSubscription(tenantId, { subscriptionId, reason }) {
    const sub = await this._ownSubscription(tenantId, subscriptionId);
    if (policyLib.isTerminal(sub.status)) throw new BillingError('invalid_transition', 'subscription already ended', 409);
    const immediate = this.policy.cancelPolicy === 'immediate';
    const snap = await this._requireProvider().setCancellation({
      providerSubscriptionId: sub.provider_subscription_id, immediate, cancelAtPeriodEnd: true,
      idempotencyKey: `cancel-${sub.subscription_id}-${immediate ? 'now' : 'period_end'}-${new Date(sub.provider_state_at).getTime()}`,
    });
    await this.audit({ type: 'customer', id: tenantId }, 'subscription.cancel_requested', { type: 'subscription', id: sub.subscription_id }, {
      tenantId, reason: typeof reason === 'string' ? reason.slice(0, 500) : null, after: { policy: this.policy.cancelPolicy },
    });
    await this.syncFromSnapshotNow(snap);
    return this.getAccountOverview(tenantId);
  }

  async reactivateSubscription(tenantId, { subscriptionId }) {
    const sub = await this._ownSubscription(tenantId, subscriptionId);
    if (policyLib.isTerminal(sub.status) || !sub.cancel_at_period_end) {
      throw new BillingError('invalid_transition', 'only a subscription scheduled to cancel can be reactivated', 409);
    }
    const snap = await this._requireProvider().setCancellation({
      providerSubscriptionId: sub.provider_subscription_id, immediate: false, cancelAtPeriodEnd: false,
      idempotencyKey: `reactivate-${sub.subscription_id}-${new Date(sub.provider_state_at).getTime()}`,
    });
    await this.audit({ type: 'customer', id: tenantId }, 'subscription.reactivated', { type: 'subscription', id: sub.subscription_id }, { tenantId });
    await this.syncFromSnapshotNow(snap);
    return this.getAccountOverview(tenantId);
  }

  /** Applies a snapshot returned directly by a provider API call. */
  async syncFromSnapshotNow(snap) {
    const existing = await this.store.findOne('billing_subscriptions', { provider: this.provider.name, provider_subscription_id: snap.providerSubscriptionId });
    let at = this.now();
    if (existing && new Date(existing.provider_state_at).getTime() >= at.getTime()) at = new Date(new Date(existing.provider_state_at).getTime() + 1);
    return this.applySubscriptionSnapshot(snap, at, { source: 'provider_api_response' });
  }

  // ======================================================================
  // Entitlements and metering
  // ======================================================================

  async checkEntitlement(tenantId, featureKey) {
    if (!KEY_RE.test(String(featureKey))) throw new BillingError('invalid_request', 'invalid feature key', 400);
    const now = this.now();
    const ents = (await this.store.findMany('billing_entitlements', { tenant_id: tenantId, feature_key: featureKey, status: 'active' }))
      .filter((e) => e.access_until && new Date(e.access_until).getTime() > now.getTime())
      .sort((a, b) => (a.limit_units === null ? -1 : b.limit_units === null ? 1 : b.limit_units - a.limit_units));
    if (!ents.length) return { allowed: false, reason: 'not_entitled' };
    const usage = await this._usageFor(ents[0], now);
    const allowed = usage.remaining_units === null || usage.remaining_units > 0;
    return { allowed, reason: allowed ? null : 'quota_exceeded', ...usage };
  }

  async _monthCostMicros(tenantId) {
    const now = this.now();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const rows = await this.store.findMany('billing_provider_cost_records', { tenant_id: tenantId, created_at: { gte: monthStart } });
    return rows.reduce((s, r) => s + (r.cost_micros || 0), 0);
  }

  /**
   * Runs a billable operation under an atomic usage reservation.
   *
   *   reserve (atomic; idempotent per key) → operation() → finalize
   *   operation() throws → release (no charge), failed-attempt costs recorded
   *
   * `operation` receives { usageId, attempt } and returns
   *   { result, units?, costs?: [{ provider, model, inputUnits, outputUnits, costMicros? , costStatus? }] }.
   * Errors may carry `billingCosts` (same shape) for provider spend on failure.
   */
  async runMetered({ tenantId, featureKey, units = 1, idempotencyKey, jobRef, operation }) {
    await this._activeTenant(tenantId);
    if (!KEY_RE.test(String(featureKey))) throw new BillingError('invalid_request', 'invalid feature key', 400);
    if (!Number.isSafeInteger(units) || units <= 0 || units > 1000000) throw new BillingError('invalid_request', 'units must be a positive integer', 400);
    assertIdempotencyKey(idempotencyKey);

    const cap = Number(process.env.BILLING_TENANT_MONTHLY_COST_CAP_MICROS || 0);
    if (Number.isSafeInteger(cap) && cap > 0 && (await this._monthCostMicros(tenantId)) >= cap) {
      throw new BillingError('spending_cap_reached', 'this account reached its monthly processing budget', 429);
    }

    const r = await this.store.reserveUsage({
      tenantId, featureKey, units, idempotencyKey, now: this.now(), ttlSeconds: this.policy.reservationTtlSeconds,
    });
    if (r.outcome === 'not_entitled') throw new BillingError('not_entitled', `no active entitlement for ${featureKey}`, 402);
    if (r.outcome === 'quota_exceeded') {
      throw new BillingError('quota_exceeded', `${featureKey} quota exhausted for this billing period`, 429, { limit_units: r.limit_units, used_units: r.used_units });
    }
    if (r.outcome === 'duplicate') {
      if (r.usage_status === 'committed') return { duplicate: true, usage_id: r.usage_id, status: 'committed' };
      throw new BillingError('operation_in_progress', 'an operation with this idempotency key is in progress', 409);
    }

    const usage = await this.store.findOne('billing_usage_events', { usage_id: r.usage_id });
    const ref = jobRef || idempotencyKey;
    let out;
    try {
      out = await operation({ usageId: r.usage_id, attempt: usage.attempts });
    } catch (err) {
      await this.store.releaseUsage(r.usage_id, this.now());
      await this._recordCosts(tenantId, r.usage_id, ref, usage.attempts, false, err && err.billingCosts);
      throw err;
    }
    const committedUnits = out && Number.isSafeInteger(out.units) ? out.units : units;
    await this.store.finalizeUsage(r.usage_id, committedUnits, this.now());
    await this._recordCosts(tenantId, r.usage_id, ref, usage.attempts, true, out && out.costs);
    return { duplicate: false, usage_id: r.usage_id, units_committed: Math.min(committedUnits, units), result: out ? out.result : undefined };
  }

  async _recordCosts(tenantId, usageId, jobRef, attempt, succeeded, costs) {
    if (!Array.isArray(costs)) return;
    for (const c of costs) {
      if (!c || typeof c.provider !== 'string') continue;
      let costMicros = Number.isSafeInteger(c.costMicros) && c.costMicros >= 0 ? c.costMicros : null;
      let costStatus = costMicros === null ? 'unpriced' : (c.costStatus === 'confirmed' ? 'confirmed' : 'estimated');
      let rateVersion = c.rateVersion || null;
      let costCurrency = c.costCurrency || 'usd';
      if (costMicros === null) {
        const est = estimateCost(this.rateCard, c);
        costMicros = est.costMicros;
        costStatus = est.costStatus;
        rateVersion = est.rateVersion;
        costCurrency = est.costCurrency;
      }
      await this.store.insert('billing_provider_cost_records', {
        tenant_id: tenantId, usage_id: usageId, job_ref: String(jobRef).slice(0, 200), provider: c.provider.slice(0, 50),
        model: c.model ? String(c.model).slice(0, 100) : null,
        input_units: Number.isSafeInteger(c.inputUnits) ? c.inputUnits : null,
        output_units: Number.isSafeInteger(c.outputUnits) ? c.outputUnits : null,
        cost_currency: normalizeCurrency(costCurrency), cost_micros: costMicros, cost_status: costStatus,
        rate_version: rateVersion, attempt, succeeded, created_at: this.now(),
      });
    }
  }

  // ======================================================================
  // Operator actions
  // ======================================================================

  /**
   * Requests a refund at the provider. The effect on payments/access is
   * applied when the provider's charge.refunded webhook arrives.
   */
  async requestRefund({ paymentId, amountMinor, reason, confirm }, actor) {
    assertUuid(paymentId, 'payment_id');
    if (confirm !== true) throw new BillingError('confirmation_required', 'refunds require confirm: true', 400);
    const why = assertReason(reason);
    const payment = await this.store.findOne('billing_payments', { payment_id: paymentId });
    if (!payment) throw new BillingError('not_found', 'payment not found', 404);
    if (!['succeeded', 'partially_refunded'].includes(payment.status)) throw new BillingError('invalid_transition', `cannot refund a ${payment.status} payment`, 409);
    const refundable = payment.amount_minor - payment.amount_refunded_minor;
    const amount = amountMinor === undefined ? refundable : assertMinor(amountMinor, 'amount_minor');
    if (amount <= 0 || amount > refundable) throw new BillingError('invalid_amount', `amount must be 1..${refundable}`, 400);
    if (!payment.provider_payment_intent) throw new BillingError('not_refundable', 'payment has no provider payment reference', 409);
    const result = await this._requireProvider().createRefund({
      paymentIntent: payment.provider_payment_intent, amountMinor: amount, reason: why,
      idempotencyKey: `refund-${payment.payment_id}-${payment.amount_refunded_minor}-${amount}`,
    });
    await this.audit(actor, 'refund.requested', { type: 'payment', id: payment.payment_id }, {
      tenantId: payment.tenant_id, reason: why,
      before: { status: payment.status, amount_refunded_minor: payment.amount_refunded_minor },
      after: { requested_minor: amount, provider_refund_id: result.providerRefundId },
    });
    return { provider_refund_id: result.providerRefundId, amount_minor: amount, currency: payment.currency, status: 'requested' };
  }

  /**
   * Reconciliation: re-reads every non-terminal subscription and every
   * stale open checkout from the provider. Corrects missed or delayed
   * webhooks. Provider failures are reported per item, never thrown.
   */
  async reconcile({ limit = 200, staleCheckoutMinutes = 30 } = {}) {
    const report = { subscriptions_checked: 0, subscriptions_changed: 0, checkouts_checked: 0, errors: [] };
    const subs = await this.store.findMany('billing_subscriptions', { status: { in: NON_TERMINAL } }, { limit });
    for (const sub of subs) {
      report.subscriptions_checked += 1;
      try {
        const out = await this.syncSubscriptionFromProvider(sub.provider_subscription_id, { source: 'reconcile', expectedTenantId: sub.tenant_id });
        const after = await this.store.findOne('billing_subscriptions', { subscription_id: sub.subscription_id });
        if (out === 'processed' && (after.status !== sub.status || after.cancel_at_period_end !== sub.cancel_at_period_end)) report.subscriptions_changed += 1;
      } catch (err) {
        report.errors.push({ subscription_id: sub.subscription_id, error: redactError(err) });
      }
    }
    const cutoff = new Date(this.now().getTime() - staleCheckoutMinutes * 60000);
    const intents = await this.store.findMany('billing_checkout_intents', { status: 'open', created_at: { lt: cutoff } }, { limit });
    for (const intent of intents) {
      report.checkouts_checked += 1;
      try {
        const s = await this._requireProvider().retrieveCheckoutSession(intent.provider_session_id);
        if (s.status === 'complete') await this._onCheckoutCompleted({ sessionId: s.sessionId, providerSubscriptionId: s.providerSubscriptionId });
        else if (s.status === 'expired') await this._onCheckoutExpired({ sessionId: s.sessionId });
      } catch (err) {
        report.errors.push({ intent_id: intent.intent_id, error: redactError(err) });
      }
    }
    return report;
  }

  async listWebhookEvents({ status, limit = 50 } = {}) {
    const where = status ? { status } : {};
    const rows = await this.store.findMany('billing_webhook_events', where, { orderBy: ['received_at', 'desc'], limit: Math.min(limit, 200) });
    return rows.map(({ payload, ...rest }) => rest); // eslint-disable-line no-unused-vars
  }

  async listAudit({ tenantId, limit = 100 } = {}) {
    const where = tenantId ? { tenant_id: assertUuid(tenantId, 'tenant_id') } : {};
    return this.store.findMany('billing_audit_events', where, { orderBy: ['created_at', 'desc'], limit: Math.min(limit, 500) });
  }
}

module.exports = { BillingService, IDEMPOTENCY_RE };
