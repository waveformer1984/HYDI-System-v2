// Thin, dependency-free clients for the systems the tools read from.
// Every call returns a plain result object and never throws, so one dead
// service degrades one tool's answer instead of crashing the server.

import { createHmac, randomUUID } from 'node:crypto';

/**
 * Mint an x-hydi-service-token, the same format lib/auth/verifyServiceToken.js
 * accepts: `{timestamp}.{requestId}.{service}.{hmac-sha256(ts:requestId:service)}`.
 */
export function signServiceToken(secret, service = 'protoforge-mcp', now = Date.now()) {
  const ts = String(now);
  const requestId = randomUUID();
  const sig = createHmac('sha256', secret).update(`${ts}:${requestId}:${service}`).digest('hex');
  return `${ts}.${requestId}.${service}.${sig}`;
}

/**
 * GET/POST with a timeout. Returns { ok, status, body } or { ok:false, error }.
 * `fetchImpl` is injectable for tests.
 */
export async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 8000, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method, headers, body, signal: controller.signal });
    const text = await res.text();
    let parsed = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* keep text */ }
    return { ok: res.ok, status: res.status, body: parsed };
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return { ok: false, status: 0, error: aborted ? `timed out after ${timeoutMs}ms` : describeError(err) };
  } finally {
    clearTimeout(timer);
  }
}

function describeError(err) {
  if (!(err instanceof Error)) return 'unknown error';
  const code = err.cause && err.cause.code;
  return code ? `${code} (${err.message})` : err.message;
}

/** Call a heidi-web route as the owner, signed with HYDI_SERVICE_SECRET. */
export function hydiGet(cfg, routePath, deps = {}) {
  if (!cfg.serviceSecret) {
    return Promise.resolve({ ok: false, status: 0, error: 'HYDI_SERVICE_SECRET is not set for the MCP server' });
  }
  return request(`${cfg.heidiWebUrl}${routePath}`, {
    headers: { 'x-hydi-service-token': signServiceToken(cfg.serviceSecret) },
    timeoutMs: cfg.timeoutMs,
    fetchImpl: deps.fetchImpl,
  });
}

/** Read rows from Supabase (local or cloud) via PostgREST with the service role. */
export function supabaseSelect(cfg, table, query, deps = {}) {
  if (!cfg.supabaseUrl || !cfg.supabaseKey) {
    return Promise.resolve({ ok: false, status: 0, error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set' });
  }
  const qs = new URLSearchParams(query).toString();
  return request(`${cfg.supabaseUrl}/rest/v1/${encodeURIComponent(table)}?${qs}`, {
    headers: {
      apikey: cfg.supabaseKey,
      Authorization: `Bearer ${cfg.supabaseKey}`,
      Accept: 'application/json',
    },
    timeoutMs: cfg.timeoutMs,
    fetchImpl: deps.fetchImpl,
  });
}

/** Read-only Stripe GET. `account` scopes the call to a Connect sub-account. */
export function stripeGet(cfg, apiPath, { account } = {}, deps = {}) {
  if (!cfg.stripeKey) {
    return Promise.resolve({ ok: false, status: 0, error: 'STRIPE_SECRET_KEY is not set' });
  }
  const headers = { Authorization: `Bearer ${cfg.stripeKey}` };
  if (account) headers['Stripe-Account'] = account;
  return request(`https://api.stripe.com${apiPath}`, { headers, timeoutMs: cfg.timeoutMs, fetchImpl: deps.fetchImpl });
}
