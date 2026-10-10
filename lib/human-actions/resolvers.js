'use strict';

/**
 * Human Action resolvers — the executable half of the resolution policy.
 *
 * A resolver is a bounded, idempotent function invoked by the detector's
 * resolution sweep. Contract:
 *
 *   resolver({ action, policy, env, deps }) → { outcome, evidence, reason }
 *
 *   outcome  'completed'    — the resolver did its part; the VERIFIER
 *                           still decides RESOLVED. A resolver can never
 *                           mark an action resolved, and 'completed' is
 *                           only a claim the verifier checks.
 *            'partial'      — some of the boundary cleared; verifier will
 *                           report precisely what remains
 *            'unauthorized' — the required capability/authorization was
 *                           absent at execution time (fail closed)
 *            'failed'       — attempted and errored; retry-safe later
 *
 * Invariants (non-negotiable):
 *   - Idempotent external mutation: adopt-before-create everywhere; a
 *     restarted/crashed attempt must never produce duplicates.
 *   - Evidence is metadata only. Secret values (whsec_, sk_/rk_ bodies)
 *     are written to the credential/env layer, never into action records.
 *   - Fail closed: any doubt → failed/unauthorized, never fabricated
 *     success.
 *   - Scope is policy.scope verbatim — the resolver receives exactly what
 *     the policy declares, nothing broader.
 */

const fs = require('fs');
const path = require('path');

// ─── Secret runtime projection ───────────────────────────────────────────
// The governed credential path: secrets are refused by
// ConfigurationControlPlane (non-secret config only), so the credential
// layer owns this write — SECURE_LOCAL store first (durable, encrypted),
// then .env.local + process.env projection because the runtime consumers
// (StripeBridge, verifiers, the webhook handler) read env. The value is
// a secret: it never lands in evidence, audit detail, or return values —
// only the env NAME is reported.

function writeEnvValue(envVar, value, envPath) {
  const p = envPath || path.join(process.cwd(), '.env.local');
  let content = '';
  try { content = fs.readFileSync(p, 'utf8'); } catch { /* absent is fine */ }
  const lines = content.split('\n');
  let found = false;
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('#') || !t) { out.push(line); continue; }
    const eq = t.indexOf('=');
    if (eq === -1) { out.push(line); continue; }
    if (t.substring(0, eq).trim() === envVar) { out.push(`${envVar}=${value}`); found = true; }
    else out.push(line);
  }
  if (!found) {
    if (out.length && out[out.length - 1].trim() !== '') out.push('');
    out.push(`${envVar}=${value}`);
  }
  fs.writeFileSync(p, out.join('\n'), 'utf8');
}

/**
 * Store a credential through the governed credential layer and project it
 * into the runtime env the consumers actually read.
 *   deps.credentialStore — injectable CredentialSourceManager-like
 *   deps.envPath         — injectable .env.local path (tests)
 * Returns metadata only.
 */
async function persistCredential(provider, credentialType, environment, envVar, value, deps = {}) {
  let secure = false;
  const store = deps.credentialStore;
  if (store && typeof store.storeCredential === 'function') {
    try {
      await store.storeCredential(provider, credentialType, environment, value, {
        actor: 'resolver:credential-projection', role: 'operations',
      });
      secure = true;
    } catch { /* store unavailable — env projection still runs */ }
  }
  writeEnvValue(envVar, value, deps.envPath);
  process.env[envVar] = value;
  return { secureStore: secure, envVar };
}

// ─── Resolver registry ───────────────────────────────────────────────────
// Closed set, same fail-closed contract as the verifier registry: a
// persisted resolverId resolves only against code defined here.

const RESOLVERS = {
  /**
   * config-set — set one auto-modifiable config key through the
   * ConfigurationControlPlane (atomic write, audit, read-back verify,
   * rollback preserved). Structural enforcement is the plane's
   * autoModifiable check: this resolver cannot write secrets or
   * operator-owned flags even if a future policy mis-classifies them.
   */
  'config-set': async ({ action, policy, deps }) => {
    const { key, value } = policy.scope || {};
    if (!key) return { outcome: 'failed', reason: 'config-set scope missing key', evidence: null };
    const plane = deps?.configPlane
      || (() => { try { return require('../operational/ConfigurationControlPlane').getConfigurationControlPlane(); } catch { return null; } })();
    if (!plane) return { outcome: 'failed', reason: 'ConfigurationControlPlane unavailable', evidence: { key } };
    if (typeof plane.canAutoModify === 'function' && !plane.canAutoModify(key)) {
      return {
        outcome: 'unauthorized',
        reason: `config key '${key}' is not auto-modifiable — it requires an explicit operator decision`,
        evidence: { key },
      };
    }
    const res = plane.set(key, value, `resolver:${policy.resolverId || 'config-set'}`, `resolve ${action.blockerKey} (action ${action.id})`);
    if (!res.success) return { outcome: 'failed', reason: res.error || 'config write failed', evidence: { key } };
    return {
      outcome: 'completed',
      reason: `${key} set through the governed config plane`,
      // value is non-secret config (autoModifiable keys only) — safe evidence
      evidence: { key, value, verified: !!res.verified, rollbackAvailable: true },
    };
  },

  /**
   * stripe-webhook-endpoint — create (or adopt) the live webhook endpoint
   * via the Stripe API, then store its signing secret through the
   * credential layer. Idempotent: lists first and adopts an existing
   * matching endpoint — a restart never creates a duplicate. The whsec_
   * secret is returned by Stripe only at create time; when adopting an
   * existing endpoint we cannot retrieve it, so outcome is 'partial' and
   * the verifier reports the still-missing secret honestly.
   */
  'stripe-webhook-endpoint': async ({ action, policy, env, deps }) => {
    const scope = policy.scope || {};
    const wantPath = scope.path || '/api/webhooks/stripe';
    const wantEvents = scope.events || ['checkout.session.completed'];
    const secretEnv = scope.secretEnv || 'STRIPE_WEBHOOK_SECRET_01';
    const key = env.envValue('STRIPE_SECRET_KEY');
    if (!key) return { outcome: 'unauthorized', reason: 'no STRIPE_SECRET_KEY in scope', evidence: null };

    const baseUrl = deps?.baseUrl || (() => {
      for (const n of ['NEXT_PUBLIC_APP_URL', 'APP_BASE_URL']) {
        const v = env.envValue(n);
        if (v && /^https:\/\//i.test(v)) return v.replace(/\/+$/, '');
      }
      return null;
    })();
    if (!baseUrl) return { outcome: 'unauthorized', reason: 'no public base URL configured', evidence: null };

    const stripe = deps?.stripe || (() => { try { return require('stripe')(key); } catch (e) { return null; } })();
    if (!stripe?.webhookEndpoints) return { outcome: 'failed', reason: 'stripe client unavailable', evidence: null };

    const targetUrl = baseUrl + wantPath;
    const match = (e) => e.status === 'enabled'
      && String(e.url || '').replace(/\/+$/, '').endsWith(wantPath)
      && wantEvents.every((ev) => (e.enabled_events || []).includes(ev) || (e.enabled_events || []).includes('*'));

    let endpoint = null;
    let adopted = false;
    try {
      const list = await stripe.webhookEndpoints.list({ limit: 100 });
      endpoint = (list.data || []).find(match) || null;
      adopted = !!endpoint;
    } catch (e) {
      return { outcome: 'failed', reason: 'webhookEndpoints.list failed: ' + (e instanceof Error ? e.message : 'unknown'), evidence: null };
    }

    if (!endpoint) {
      try {
        endpoint = await stripe.webhookEndpoints.create({ url: targetUrl, enabled_events: wantEvents });
      } catch (e) {
        return { outcome: 'failed', reason: 'webhookEndpoints.create failed: ' + (e instanceof Error ? e.message : 'unknown'), evidence: { targetUrl } };
      }
      if (!endpoint || !endpoint.id) {
        return { outcome: 'failed', reason: 'webhookEndpoints.create returned no endpoint', evidence: { targetUrl } };
      }
    }

    // Signing secret: only present on create. Store via credential layer +
    // env projection; report NAME only. On adopt, if a whsec_ is already
    // configured locally the endpoint is fully wired; otherwise the
    // remaining human step is copying the dashboard secret.
    let secretStored = false;
    if (endpoint.secret) {
      const r = await persistCredential('stripe', 'stripe_webhook_secret_01', 'live', secretEnv, endpoint.secret, deps || {});
      secretStored = true;
      endpoint = { ...endpoint, secret: undefined }; // never carry the secret upward
      void r;
    }
    const secretConfigured = secretStored
      || !!(env.envNamePresent && env.envNamePresent(secretEnv)) || !!(env.envNamePresent && env.envNamePresent('STRIPE_WEBHOOK_SECRET'));

    return {
      outcome: secretConfigured ? 'completed' : 'partial',
      reason: adopted
        ? (secretConfigured ? 'existing endpoint adopted; signing secret already configured' : 'existing endpoint adopted — its signing secret must come from the Stripe dashboard (secrets are only returned at creation)')
        : 'endpoint created and signing secret stored through the credential layer',
      evidence: {
        endpointId: endpoint.id, endpointUrl: endpoint.url, livemode: endpoint.livemode ?? null,
        adopted, signingSecret: secretConfigured ? 'configured' : 'missing',
      },
    };
  },
};

/** Look up a resolver by id. Unknown ids return null — never executed. */
function getResolver(id) {
  return id ? RESOLVERS[id] || null : null;
}

module.exports = { RESOLVERS, getResolver, writeEnvValue, persistCredential };
