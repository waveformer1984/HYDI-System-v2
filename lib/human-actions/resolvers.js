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

  /**
   * prospect-research — close the demand-prospects gap through permitted
   * public-data discovery + the governed prospects API.
   *
   * Source: ProspectDiscoveryAdapter 'openstreetmap' provider — real
   * businesses carrying public website tags (ODbL). Recording: POST
   * /api/revenue/prospects op:add, the canonical governed path — the API
   * enforces required evidence fields and name-dedupe; a 409 is counted as
   * already-recorded, never as failure.
   *
   * Gated by the revenue service switch: service OFF → 'deferred'
   * (new commercial work is operator-controlled). Records stop at the
   * verifier's threshold or the provider's documented result limit —
   * the count is never padded.
   */
  'prospect-research': async ({ action, policy, env, deps }) => {
    const scope = policy.scope || {};
    const serviceId = scope.serviceId || 'checkpoint_audit';
    const minCount = scope.minCount || 5;
    const { isServiceEnabled } = require('../revenue/revenue-service-switch');
    if (!isServiceEnabled(serviceId, deps?.switchPath)) {
      return { outcome: 'deferred', reason: `revenue service '${serviceId}' switch is OFF — no new commercial work`, evidence: { serviceId } };
    }

    const expPath = scope.experimentPath || path.join(process.cwd(), '.hydi-operational', 'checkpoint-demand-experiment.json');
    let recorded = 0;
    try {
      const exp = JSON.parse(fs.readFileSync(expPath, 'utf8'));
      recorded = (exp.prospects || []).filter((p) => p.legitimate === true && !p.removedAt
        && p.businessName && p.source && p.relevanceReason && p.contactChannel).length;
    } catch { /* unreadable experiment — treat as zero and still try the API */ }
    if (recorded >= minCount) {
      return { outcome: 'completed', reason: `already ${recorded}/${minCount} legitimate prospects`, evidence: { recorded } };
    }

    const { discoverFromOverpass } = deps?.discoveryModule || require('../revenue/overpass-source.js');
    let discoverError = null;
    const found = await discoverFromOverpass({
      location: scope.location,
      limit: scope.maxResults || 15,
      fetchFn: deps?.fetch,
    }).catch((e) => { discoverError = e instanceof Error ? e.message : 'discover failed'; return []; });
    if (!found.length) {
      return { outcome: 'failed', reason: `public discovery returned no usable businesses${discoverError ? ` (${discoverError})` : ''} — recorded ${recorded}/${minCount}; a different region or a credentialed provider may be required`, evidence: { recorded, discovered: 0 } };
    }

    const serviceToken = env.envValue('HYDI_SERVICE_SECRET');
    const apiBase = (env.envValue('HEIDI_INTERNAL_BASE_URL') || 'http://127.0.0.1:3000').replace(/\/+$/, '');
    const fetchFn = deps?.fetch || globalThis.fetch;
    const postProspect = deps?.postProspect || (async (prospect) => {
      const body = {
        op: 'add',
        businessName: prospect.companyName,
        source: `public business directory (OpenStreetMap/Overpass) — ${prospect.sourceUrl}`,
        relevanceReason: `${prospect.industry || 'field-service'} business with a public website — sequential operational workflow matching the checkpoint_audit target profile`,
        contactChannel: `public website contact path at ${prospect.website}${prospect.contactPhone ? `; listed phone ${prospect.contactPhone}` : ''}`,
        contactVerified: false,
      };
      // The endpoint verifies an HMAC service token
      // ({ts}.{requestId}.{service}.{sig}), not the raw secret.
      const { createHmac, randomUUID } = require('crypto');
      const ts = Date.now().toString();
      const requestId = randomUUID();
      const sig = createHmac('sha256', serviceToken).update(`${ts}:${requestId}:human-action-resolver`).digest('hex');
      const res = await fetchFn(`${apiBase}/api/revenue/prospects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-hydi-service-token': `${ts}.${requestId}.human-action-resolver.${sig}` },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    });

    // Record every discovered business concurrently — minCount is a
    // threshold, not a cap; each recording is an independent idempotent
    // row, and sequential posting under a large discovery set can exceed
    // the resolver timeout for no benefit.
    const results = await Promise.all(found.map((p) =>
      postProspect(p).catch((e) => ({ status: 0, body: null, error: e instanceof Error ? e.message : 'post failed', name: p.companyName }))));
    let added = 0; let deduped = 0; const rejected = [];
    results.forEach((r, i) => {
      if (r.status === 201) added++;
      else if (r.status === 409) deduped++;
      else rejected.push({ name: found[i].companyName, status: r.status, error: r.body?.error || r.error || null });
    });
    const now = recorded + added;
    return {
      outcome: now >= minCount ? 'completed' : (added + deduped) > 0 ? 'partial' : 'failed',
      reason: `recorded ${now}/${minCount} legitimate prospects via governed API (added ${added}, deduped ${deduped}, rejected ${rejected.length})`,
      evidence: { recordedBefore: recorded, added, deduped, rejected, now, minCount },
    };
  },

  /**
   * stripe-credential-scan — check every approved credential source for an
   * already-provisioned live Stripe credential before declaring the
   * dashboard step irreducible.
   *
   * Approved sources: the env layer (the verifier's own domain — nothing to
   * do if present) and the governed CredentialManager secure store. A live
   * credential found in the store is projected to STRIPE_SECRET_KEY through
   * persistCredential (value never surfaces). Nothing found → 'unauthorized'
   * with the exact human step — a restricted key can only be created in the
   * Stripe dashboard, never fabricated.
   */
  'stripe-credential-scan': async ({ action, policy, env, deps }) => {
    const key = env.envValue('STRIPE_SECRET_KEY');
    if (key && (key.startsWith('sk_live_') || key.startsWith('rk_live_'))) {
      return { outcome: 'completed', reason: 'live credential already present in env', evidence: { prefix: key.slice(0, 8) } };
    }
    let health = null;
    try {
      const cm = deps?.credentialManager
        || (() => { try { return require('../operational/CredentialManager'); } catch { return null; } })();
      const mgr = cm?.getCredentialManager ? cm.getCredentialManager() : cm?.CredentialManager ? new cm.CredentialManager() : cm;
      if (mgr && typeof mgr.getStripeCredentialHealth === 'function') {
        health = await mgr.getStripeCredentialHealth();
      } else if (deps?.credentialHealth) {
        health = await deps.credentialHealth();
      }
    } catch { health = null; }
    if (health && health.mode === 'live' && health.configured) {
      return {
        outcome: 'partial',
        reason: `live credential exists in the governed store (fingerprint ${health.fingerprint || 'recorded'}) but is not projected to STRIPE_SECRET_KEY — env projection still requires the operator's secure-input step`,
        evidence: { found: 'secure_store', mode: 'live', fingerprint: health.fingerprint || null },
      };
    }
    return {
      outcome: 'unauthorized',
      reason: 'no live Stripe credential exists in any approved source (env or secure store) — Stripe exposes no API to create secret keys; a human must create a restricted rk_live_ key in the dashboard and supply it through the secure input path',
      evidence: { sourcesChecked: ['env', 'secure_store'], found: health ? health.mode || 'test_only' : 'none' },
    };
  },

  /**
   * docker-restart — bounded restart of a crashed allowlisted container.
   * Fail-closed on the allowlist (HYDI_DOCKER_RESTART_ALLOW) and on the
   * container-name charset; the restart goes through execFile argv (no
   * shell), and the outcome is decided by an independent inspect read-back,
   * never by the restart call's own exit code.
   */
  'docker-restart': async ({ action, policy, env, deps }) => {
    const container = action?.context?.container;
    const { DOCKER_NAME } = require('../runtime/docker');
    if (!container || !DOCKER_NAME.test(container)) {
      return { outcome: 'failed', reason: 'missing or invalid container name', evidence: { container } };
    }
    const allowEnv = (policy.scope && policy.scope.allowlistEnv) || 'HYDI_DOCKER_RESTART_ALLOW';
    const allowlist = String(env.envValue(allowEnv) || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!allowlist.includes(container)) {
      return {
        outcome: 'unauthorized',
        reason: `container '${container}' is not in ${allowEnv} — operator must declare it restartable (or restart it manually)`,
        evidence: { container, allowlistSize: allowlist.length },
      };
    }
    const exec = deps?.dockerExec || (() => { try { return require('../runtime/docker'); } catch { return null; } })();
    if (!exec) return { outcome: 'failed', reason: 'docker runtime module unavailable', evidence: { container } };
    const before = await exec.inspectDockerContainer(container, {});
    if (before.exists && before.running && !before.restarting) {
      return { outcome: 'completed', reason: `${container} already running — no restart needed`, evidence: { container, state: 'running', restartCount: before.restartCount } };
    }
    if (deps?.dryRun) {
      return { outcome: 'deferred', reason: `dry-run: would docker restart ${container}`, evidence: { container, before } };
    }
    const res = await deps?.dockerRestart
      ? await deps.dockerRestart(container)
      : await new Promise((resolve) => {
          require('child_process').execFile('docker', ['restart', container], { timeout: 60000, windowsHide: true },
            (err) => resolve({ ok: !err, error: err ? err.message : null }));
        });
    if (!res.ok) {
      return { outcome: 'failed', reason: `docker restart failed: ${res.error || 'unknown'}`, evidence: { container, before } };
    }
    const after = await exec.inspectDockerContainer(container, {});
    if (after.exists && after.running && !after.restarting) {
      return { outcome: 'completed', reason: `${container} restarted and read back running`, evidence: { container, restartCount: after.restartCount } };
    }
    return {
      outcome: 'partial',
      reason: `restart issued but ${container} reads back '${after.exists ? (after.restarting ? 'restarting' : 'not-running') : 'missing'}' — the verifier will re-check on the next sweep`,
      evidence: { container, before, after },
    };
  },

  /**
   * outreach-prepare — do every machine-executable step of outreach
   * readiness WITHOUT sending anything. Produces personalized drafts for
   * recorded prospects using only verified fields, plus an idempotent
   * send-plan marked pending_authorization. The boundary itself stays open
   * — 'partial' is the honest outcome until a human grants the channel
   * authorization.
   */
  'outreach-prepare': async ({ action, policy, env, deps }) => {
    const scope = policy.scope || {};
    const serviceId = scope.serviceId || 'checkpoint_audit';
    const { isServiceEnabled } = require('../revenue/revenue-service-switch');
    if (!isServiceEnabled(serviceId, deps?.switchPath)) {
      return { outcome: 'deferred', reason: `revenue service '${serviceId}' switch is OFF`, evidence: { serviceId } };
    }
    const expPath = scope.experimentPath || path.join(process.cwd(), '.hydi-operational', 'checkpoint-demand-experiment.json');
    const draftsPath = scope.draftsPath || path.join(process.cwd(), '.hydi-operational', 'outreach-drafts.json');
    let exp = null;
    try { exp = JSON.parse(fs.readFileSync(expPath, 'utf8')); } catch { exp = null; }
    const prospects = (exp?.prospects || []).filter((p) => p.legitimate === true && !p.removedAt);
    if (!prospects.length) {
      return { outcome: 'unauthorized', reason: 'no legitimate prospects recorded — outreach prep has nothing verified to personalize', evidence: { prospects: 0 } };
    }
    const template = exp?.sampleOutreachMessage
      || 'Subject: Workflow risk audit for [business]?\n\nHi — we run a $49 workflow risk audit: which steps carry the most risk and where a checkpoint would catch failures. Would one be useful for [business]?';
    const drafts = (() => { try { return JSON.parse(fs.readFileSync(draftsPath, 'utf8')); } catch { return { drafts: [] }; } })();
    drafts.drafts = Array.isArray(drafts.drafts) ? drafts.drafts : [];
    const now = new Date().toISOString();
    let created = 0;
    for (const p of prospects) {
      if (drafts.drafts.some((d) => d.prospectId === p.prospectId)) continue; // idempotent
      drafts.drafts.push({
        draftId: `draft_${p.prospectId}`,
        prospectId: p.prospectId,
        businessName: p.businessName,
        channel: 'operator_email',
        status: 'prepared_pending_authorization',
        body: template.replace(/\[business\]|\[their workflow name\]|\[their workflow\]|\[their process[^\]]*\]|\[name\]|\[operator name\]/g, (m) => {
          if (m === '[business]' || m === '[name]') return p.businessName;
          if (m === '[operator name]') return 'the ProtoForge operator';
          return 'their documented workflow';
        }),
        personalizationEvidence: { businessName: p.businessName, source: p.source, contactChannel: p.contactChannel },
        preparedAt: now,
        preparedBy: 'resolver:outreach-prepare',
        sendBlockedOn: 'checkpoint:outreach-authorization',
      });
      created++;
    }
    drafts.offer = exp?.offer || null;
    drafts.updatedAt = now;
    drafts.note = 'Drafts are preparation only — no message is sent until checkpoint:outreach-authorization is resolved by a human. Sends are idempotent on prospectId.';
    try {
      fs.mkdirSync(path.dirname(draftsPath), { recursive: true });
      const tmp = draftsPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(drafts, null, 2));
      fs.renameSync(tmp, draftsPath);
    } catch (e) {
      return { outcome: 'failed', reason: 'draft persistence failed: ' + (e instanceof Error ? e.message : 'error'), evidence: null };
    }
    return {
      outcome: 'partial',
      reason: `outreach fully prepared: ${drafts.drafts.length} draft(s) for ${prospects.length} prospect(s) (${created} new), all pending authorization — the remaining boundary is the human's channel grant`,
      evidence: { drafts: drafts.drafts.length, newDrafts: created, draftsPath, awaitingAuthorization: true },
    };
  },
};

/** Look up a resolver by id. Unknown ids return null — never executed. */
function getResolver(id) {
  return id ? RESOLVERS[id] || null : null;
}

module.exports = { RESOLVERS, getResolver, writeEnvValue, persistCredential };
