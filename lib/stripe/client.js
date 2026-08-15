const Stripe = require('stripe');
const { randomUUID } = require('crypto');

const STRIPE_MODE = (process.env.STRIPE_MODE || 'mock').toLowerCase();
const API_VERSION = process.env.STRIPE_API_VERSION || '2026-04-22.dahlia';

function isStripeLive() {
  return STRIPE_MODE === 'live' && !!process.env.STRIPE_SECRET_KEY;
}

function createRealClient() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error(
      'STRIPE_MODE=live requires STRIPE_SECRET_KEY. ' +
      'Unset STRIPE_MODE or set STRIPE_MODE=mock to use the local mock adapter.'
    );
  }

  const client = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: API_VERSION,
    appInfo: { name: 'HYDI Stripe Integration', version: '0.9.0' },
  });

  client.isMock = false;
  client.isStripeLive = true;
  return client;
}

function createMockClient() {
  const makeId = (prefix) => `${prefix}_mock_${Date.now()}_${randomUUID().slice(0, 8)}`;

  const stubs = {
    'accounts.list': () => ({ data: [], has_more: false, object: 'list' }),
    'accounts.create': (params = {}) => ({
      id: makeId('acct'),
      object: 'account',
      type: params.type || 'express',
      country: params.country || 'US',
      email: params.email || 'mock@example.com',
      charges_enabled: true,
      details_submitted: true,
      metadata: params.metadata || {},
    }),
    'accounts.retrieve': (id) => ({
      id,
      object: 'account',
      charges_enabled: true,
      details_submitted: true,
    }),
    'accounts.update': (id, params = {}) => ({
      id,
      object: 'account',
      metadata: params.metadata || {},
    }),
    'accounts.del': (id) => ({ id, deleted: true }),
    'accounts.createLoginLink': (id, params = {}) => ({
      url: `http://127.0.0.1:3000/stripe/connect/login?account_id=${id}`,
      object: 'login_link',
      created: Math.floor(Date.now() / 1000),
    }),
    'accountLinks.create': (params = {}) => {
      const account = params.account || makeId('acct');
      return {
        url: `http://127.0.0.1:3000/stripe/connect/return?account_id=${account}`,
        object: 'account_link',
        created: Math.floor(Date.now() / 1000),
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      };
    },
    'checkout.sessions.create': (params = {}) => {
      const id = makeId('cs');
      const url = `http://127.0.0.1:3000/success?session_id=${id}`;
      return {
        id,
        object: 'checkout.session',
        url,
        success_url: params.success_url || url,
        cancel_url: params.cancel_url || 'http://127.0.0.1:3000/?cancelled=true',
        mode: params.mode || 'payment',
        line_items: params.line_items || [],
        metadata: params.metadata || {},
        customer_email: params.customer_email || null,
        customer: params.customer || null,
        status: 'open',
        payment_intent: makeId('pi'),
      };
    },
    'paymentIntents.create': (params = {}) => ({
      id: makeId('pi'),
      object: 'payment_intent',
      client_secret: `${makeId('pi')}_secret_${randomUUID()}`,
      amount: params.amount || 0,
      currency: (params.currency || 'usd').toLowerCase(),
      status: 'requires_confirmation',
      metadata: params.metadata || {},
      transfer_data: params.transfer_data || null,
      application_fee_amount: params.application_fee_amount || null,
    }),
    'paymentIntents.retrieve': (id, options = {}) => ({
      id,
      object: 'payment_intent',
      amount: 0,
      currency: 'usd',
      status: 'succeeded',
      latest_charge: makeId('ch'),
      metadata: { revenue_stream: options.stripeAccount ? undefined : 'galactic_bytes' },
    }),
    'paymentIntents.confirm': (id) => ({
      id,
      object: 'payment_intent',
      status: 'succeeded',
      charges: { data: [{ id: makeId('ch'), status: 'succeeded' }] },
    }),
    'charges.retrieve': (id, options = {}) => ({
      id,
      object: 'charge',
      amount: 0,
      currency: 'usd',
      status: 'succeeded',
      billing_details: { email: 'mock@example.com', name: 'Mock Customer' },
    }),
    'charges.list': (params = {}) => ({
      data: [{
        id: makeId('ch'),
        object: 'charge',
        customer: params.customer,
        amount: 0,
        currency: 'usd',
        status: 'succeeded',
      }],
      has_more: false,
      object: 'list',
    }),
    'transfers.create': (params = {}) => ({
      id: makeId('tr'),
      object: 'transfer',
      amount: params.amount || 0,
      currency: (params.currency || 'usd').toLowerCase(),
      destination: params.destination || makeId('acct'),
      metadata: params.metadata || {},
    }),
    'transfers.retrieve': (id) => ({
      id,
      object: 'transfer',
      amount: 0,
      currency: 'usd',
      status: 'paid',
    }),
    'payouts.create': (params = {}) => ({
      id: makeId('po'),
      object: 'payout',
      amount: params.amount || 0,
      currency: (params.currency || 'usd').toLowerCase(),
      destination: params.destination || makeId('acct'),
      status: 'pending',
    }),
    'payouts.list': (params = {}) => ({
      data: [],
      has_more: false,
      object: 'list',
    }),
    'refunds.create': (params = {}) => ({
      id: makeId('re'),
      object: 'refund',
      amount: params.amount || 0,
      currency: (params.currency || 'usd').toLowerCase(),
      status: 'succeeded',
      charge: params.charge,
    }),
    'customers.create': (params = {}) => ({
      id: makeId('cus'),
      object: 'customer',
      email: params.email || 'mock@example.com',
      metadata: params.metadata || {},
    }),
    'customers.retrieve': (id) => ({
      id,
      object: 'customer',
      email: 'mock@example.com',
    }),
    'subscriptions.create': (params = {}) => ({
      id: makeId('sub'),
      object: 'subscription',
      status: 'active',
      customer: params.customer || makeId('cus'),
      items: { data: [{ id: makeId('si'), price: params.items?.[0]?.price || 'price_mock' }] },
      metadata: params.metadata || {},
    }),
    'subscriptions.retrieve': (id) => ({
      id,
      object: 'subscription',
      status: 'active',
      items: { data: [{ id: makeId('si'), price: 'price_mock' }] },
    }),
    'subscriptions.update': (id, params = {}) => ({
      id,
      object: 'subscription',
      status: params.status || 'active',
      ...params,
    }),
    'billingPortal.sessions.create': (params = {}) => ({
      id: makeId('bps'),
      object: 'billing_portal.session',
      url: `https://billing.stripe.com/mock?customer=${params.customer || 'cus_mock'}`,
    }),
    'billingPortal.sessions.retrieve': (id) => ({
      id,
      object: 'billing_portal.session',
      url: 'https://billing.stripe.com/mock',
    }),
    'invoices.create': (params = {}) => ({
      id: makeId('in'),
      object: 'invoice',
      status: 'draft',
      customer: params.customer || makeId('cus'),
      amount_due: params.amount_due || 0,
      currency: (params.currency || 'usd').toLowerCase(),
    }),
    'invoices.pay': (id) => ({
      id,
      object: 'invoice',
      status: 'paid',
      paid: true,
    }),
    'balance.retrieve': () => ({
      object: 'balance',
      available: [{ currency: 'usd', amount: 0, source_types: { card: 0 } }],
      pending: [{ currency: 'usd', amount: 0, source_types: { card: 0 } }],
      instant_available: [],
    }),
    'prices.list': () => ({ data: [], has_more: false, object: 'list' }),
    'products.list': () => ({ data: [], has_more: false, object: 'list' }),
  };

  function makeHandler(path) {
    return function handler(...args) {
      const key = path.join('.');

      if (key === 'webhooks.constructEvent') {
        const [rawBody, _sig, _secret] = args;
        try {
          return JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString());
        } catch (err) {
          throw new Error('Invalid JSON payload');
        }
      }

      const stub = stubs[key] || (() => ({
        id: makeId('mock'),
        object: key.split('.').pop() || 'mock',
        mock: true,
        requested_path: key,
      }));

      return Promise.resolve(stub(...args));
    };
  }

  function createProxy(path = []) {
    const fn = makeHandler(path);
    return new Proxy(fn, {
      get(_target, prop) {
        if (path.length === 0 && prop in fn) {
          return fn[prop];
        }
        return createProxy([...path, prop]);
      },
      apply(_target, thisArg, args) {
        return fn.apply(thisArg, args);
      },
    });
  }

  const client = createProxy();
  client.webhooks = {
    constructEvent(rawBody, _sig, _secret) {
      try {
        return JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString());
      } catch (err) {
        throw new Error('Invalid JSON payload');
      }
    },
  };
  client.isMock = true;
  client.isStripeLive = false;
  return client;
}

const client = isStripeLive() ? createRealClient() : createMockClient();

module.exports = client;
