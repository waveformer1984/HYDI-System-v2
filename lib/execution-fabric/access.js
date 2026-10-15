'use strict';

/**
 * Tenant and principal access for execution-fabric tasks.
 * Client-supplied tenant ids are never accepted here — callers pass a
 * server-derived principal only.
 *
 * Service-role Postgres connections bypass RLS (policy is USING true for
 * service_role). Isolation is therefore enforced in this module and the
 * stores, not claimed from RLS alone.
 */

const APPROVAL_TTL_MS = 15 * 60 * 1000;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SENSITIVE_KEY_RE = /token|secret|password|authorization|cookie|api_key|card|cvv|pan|stripe_secret/i;

/**
 * @param {object|null|undefined} task
 * @param {{ tenant_id?: string|null, subject?: string|null, role?: string|null }|null|undefined} principal
 * @returns {{ ok: true }|{ ok: false, error: string }}
 */
function tenantAllows(task, principal) {
  if (!task) return { ok: false, error: 'not_found' };
  const callerTenant = principal && principal.tenant_id ? String(principal.tenant_id) : null;
  const taskTenant = task.tenant_id ? String(task.tenant_id) : null;
  if (taskTenant && callerTenant && taskTenant !== callerTenant) {
    return { ok: false, error: 'not_found' };
  }
  if (taskTenant && !callerTenant) {
    return { ok: false, error: 'tenant_binding_required' };
  }
  if (!taskTenant && callerTenant) {
    return { ok: false, error: 'not_found' };
  }
  return { ok: true };
}

function idempotencyScopeFor(principal) {
  const tenant = principal && principal.tenant_id ? String(principal.tenant_id) : null;
  return tenant ? `tenant:${tenant}` : 'mobile-ops';
}

/**
 * Strip credential-like fields from objects before they leave the process.
 * @param {unknown} value
 * @param {number} [depth]
 */
function redactSensitive(value, depth = 0) {
  if (depth > 6) return '[redacted_depth]';
  if (value == null) return value;
  if (typeof value === 'string') {
    if (/^(hbc1|sk_|whsec_|Bearer\s)/i.test(value)) return '[redacted]';
    if (value.length > 80 && /token|secret/i.test(value)) return '[redacted]';
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v, depth + 1));
  if (typeof value !== 'object') return value;
  // Built with Object.fromEntries (no dynamic property writes), and
  // prototype keys from untrusted request args are dropped outright.
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => !UNSAFE_KEYS.has(k))
      .map(([k, v]) => [k, SENSITIVE_KEY_RE.test(k) ? '[redacted]' : redactSensitive(v, depth + 1)]),
  );
}

function approvalExpired(task, nowMs) {
  const exp = task?.authorization?.expires_at;
  if (!exp) return false;
  const t = Date.parse(exp);
  if (Number.isNaN(t)) return true;
  return t <= nowMs;
}

module.exports = {
  APPROVAL_TTL_MS,
  tenantAllows,
  idempotencyScopeFor,
  redactSensitive,
  approvalExpired,
};
