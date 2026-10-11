'use strict';

/**
 * Next.js API glue for the billing routes (pages/api/billing/**): service
 * construction from env, customer/operator auth, method guards and error
 * mapping. Route files stay thin and contain no billing logic.
 */

const { BillingService } = require('./service');
const { BillingError, isBillingError } = require('./errors');
const { verifyCustomerToken, bearerFrom } = require('./customer-auth');
const { requireAuth } = require('../auth/requireAuth');
const { rateLimit } = require('../rate-limit');

let cached = null;

function buildProvider() {
  const kind = process.env.BILLING_PROVIDER || 'stripe';
  if (kind === 'fake') {
    if (process.env.NODE_ENV === 'production') {
      throw new BillingError('provider_not_configured', 'BILLING_PROVIDER=fake is refused in production', 503);
    }
    const { FakeBillingProvider } = require('./providers/fake-provider');
    return new FakeBillingProvider({ secret: process.env.BILLING_FAKE_WEBHOOK_SECRET || undefined });
  }
  if (!process.env.STRIPE_SECRET_KEY) return null; // catalog reads still work; provider calls return 503
  const { StripeBillingProvider } = require('./providers/stripe-provider');
  return new StripeBillingProvider();
}

function buildStore() {
  if (process.env.BILLING_STORE === 'memory') {
    if (process.env.NODE_ENV === 'production') throw new Error('BILLING_STORE=memory is refused in production');
    const { MemoryBillingStore } = require('./stores/memory-store');
    return new MemoryBillingStore();
  }
  const { PgBillingStore } = require('./stores/pg-store');
  return new PgBillingStore();
}

function getBillingService() {
  if (!cached) cached = new BillingService({ store: buildStore(), provider: buildProvider() });
  return cached;
}

/** Test seam: inject a service built on the memory store + fake provider. */
function setBillingService(service) {
  cached = service;
}

function sendError(res, err) {
  if (isBillingError(err)) {
    const body = { error: err.code, message: err.message };
    if (err.details) body.details = err.details;
    return res.status(err.status).json(body);
  }
  const msg = err && err.message ? String(err.message).replace(/(sk|rk|whsec)_(live|test)_[A-Za-z0-9]+/g, '[redacted]') : 'unknown';
  console.error('[billing] unhandled error:', msg.slice(0, 500));
  return res.status(500).json({ error: 'internal_error', message: 'internal error' });
}

function allowMethods(req, res, methods) {
  if (methods.includes(req.method)) return true;
  res.setHeader('Allow', methods.join(', '));
  res.status(405).json({ error: 'method_not_allowed' });
  return false;
}

/**
 * Customer auth. Returns the tenant id from a verified token, or null after
 * writing a 401/429. The tenant id never comes from the request itself.
 */
function requireCustomer(req, res, { routeName, rateMax = 60 }) {
  if (!rateLimit(req, res, { name: `billing:${routeName}`, windowMs: 60000, max: rateMax })) return null;
  const result = verifyCustomerToken(bearerFrom(req));
  if (!result.valid) {
    res.status(401).json({ error: 'unauthorized', message: result.reason });
    return null;
  }
  return result.tenantId;
}

const noopSupabase = {
  from() {
    return { insert: async () => ({ data: null, error: null }) };
  },
};

let supabaseClient = null;
function auditClient() {
  if (supabaseClient) return supabaseClient;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const { createClient } = require('@supabase/supabase-js');
    supabaseClient = createClient(url, key, { auth: { persistSession: false } });
    return supabaseClient;
  }
  return noopSupabase;
}

/**
 * Operator auth via the existing RBAC gate (lib/auth/requireAuth.js).
 * Returns an audit actor { type: 'operator', id } or null.
 */
async function requireBillingAdmin(req, res, { permission, routeName, rateMax = 30 }) {
  const auth = await requireAuth(req, res, auditClient(), { permission, routeName: `billing:${routeName}`, rateMax });
  if (!auth.ok) return null;
  return { type: 'operator', id: auth.deviceId ? `device:${auth.deviceId}` : `role:${auth.role}` };
}

function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch (_) { throw new BillingError('invalid_json', 'request body is not valid JSON', 400); }
  }
  return {};
}

module.exports = {
  getBillingService, setBillingService, sendError, allowMethods, requireCustomer, requireBillingAdmin, body,
};
