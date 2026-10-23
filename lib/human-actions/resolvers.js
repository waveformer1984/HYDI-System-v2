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

  /**
   * runtime.reconcile — apply the runtime drift audit's *restart-class*
   * suggestions and nothing else.
   *
   *   STALE_CODE   → pm2 restart <name>            (reload current code)
   *   CONFIG_DRIFT → pm2 delete <name> && pm2 start ecosystem.config.js
   *                  --only <name>                 (re-materialize declared config)
   *
   * It NEVER deletes or starts an UNDECLARED process and never starts a
   * MISSING one — declared-but-stopped can be deliberate (hydi-local-ci's
   * header says exactly that). Those rows become dedupe-keyed human
   * actions instead: `runtime:undeclared:<name>` / `runtime:missing:<name>`.
   *
   * Fail-closed: when the audit itself is UNKNOWN (PM2 unreadable) no
   * process is touched. Bounded: at most scope.maxPerAttempt (default 3)
   * processes are acted on per attempt — a full fleet reconcile spans
   * throttled sweeps instead of one unbounded run. scope.dryRun or
   * deps.dryRun reports the plan without mutating PM2.
   */
  'runtime.reconcile': async ({ action, policy, env, deps }) => {
    const scope = (policy && policy.scope) || {};
    const allowed = Array.isArray(scope.allowedVerdicts) && scope.allowedVerdicts.length
      ? scope.allowedVerdicts : ['STALE_CODE', 'CONFIG_DRIFT'];
    const maxPerAttempt = Math.max(1, Number(scope.maxPerAttempt) || 3);
    const dryRun = scope.dryRun === true || (deps && deps.dryRun) === true;
    const root = (deps && deps.root) || process.cwd();

    const collect = (deps && deps.collectAudit)
      || ((o) => require('../runtime/collect').collectRuntimeAudit(o));
    const audit = await collect({ root }).catch(() => null);
    if (!audit || audit.overall === 'UNKNOWN') {
      return {
        outcome: 'failed',
        reason: 'runtime audit is UNKNOWN — PM2 could not be read; no process was touched (fail closed)',
        evidence: { overall: audit ? audit.overall : 'collect failed' },
      };
    }

    const rows = Array.isArray(audit.rows) ? audit.rows : [];
    const svc = (deps && deps.service) || new (require('./service').HumanActionService)();
    const raised = [];

    // Human-boundary rows first — never touched by this resolver.
    for (const r of rows) {
      const verdicts = Array.isArray(r.verdicts) ? r.verdicts : [r.verdict];
      if (verdicts.includes('UNDECLARED')) {
        const { action: a, created } = svc.request({
          blockerKey: `runtime:undeclared:${r.name}`,
          type: 'ops',
          boundary: { category: 'OTHER', capability: 'runtime.pm2.declaration' },
          title: `Declare or retire undeclared PM2 process '${r.name}'`,
          description: `PM2 runs '${r.name}' (${r.detail || 'no provenance'}) but ecosystem.config.js does not declare it. A reboot restore and the drift audit both depend on declarations matching reality.`,
          instructions: [
            `If '${r.name}' should run: declare it in ecosystem.config.js (script/args/cwd as PM2 shows them), then 'pm2 delete ${r.name} && pm2 start ecosystem.config.js --only ${r.name} && pm2 save'`,
            `If it should not run: 'pm2 delete ${r.name} && pm2 save'`,
            'Tell Heidi "check again" — the next audit resolves this automatically',
          ],
          verifier: { name: 'runtime-row-absent', spec: { name: r.name } },
          expectedOutcome: `'${r.name}' is either declared in ecosystem.config.js or no longer running under PM2`,
          priority: 'normal',
          source: 'resolver:runtime.reconcile',
        });
        raised.push({ blockerKey: a.blockerKey, id: a.id, created });
      } else if (verdicts.includes('MISSING')) {
        const { action: a, created } = svc.request({
          blockerKey: `runtime:missing:${r.name}`,
          type: 'ops',
          boundary: { category: 'OTHER', capability: 'runtime.pm2.start' },
          title: `Declared PM2 app '${r.name}' is not running`,
          description: `'${r.name}' is declared in ecosystem.config.js but offline. Deliberate stops are legitimate (e.g. hydi-local-ci documents exactly that) — so a resolver never starts it unilaterally.`,
          instructions: [
            `To run it: pm2 start ecosystem.config.js --only ${r.name} && pm2 save`,
            `If the stop was deliberate: remove or comment the '${r.name}' entry in ecosystem.config.js so the audit reflects intent`,
            'Tell Heidi "check again" — the next audit resolves this automatically',
          ],
          verifier: { name: 'runtime-row-absent', spec: { name: r.name } },
          expectedOutcome: `'${r.name}' is online under its declared config or no longer declared`,
          priority: 'normal',
          source: 'resolver:runtime.reconcile',
        });
        raised.push({ blockerKey: a.blockerKey, id: a.id, created });
      }
    }

    const actionable = rows.filter((r) => {
      const verdicts = Array.isArray(r.verdicts) ? r.verdicts : [r.verdict];
      return verdicts.some((v) => allowed.includes(v)) && !verdicts.includes('UNDECLARED');
    });
    const targets = actionable.slice(0, maxPerAttempt);
    const runPm2 = (deps && deps.runPm2) || defaultPm2();
    const applied = [];
    let failures = 0;

    if (!dryRun) {
      for (const r of targets) {
        const verdicts = Array.isArray(r.verdicts) ? r.verdicts : [r.verdict];
        // CONFIG_DRIFT needs re-materialization; STALE_CODE only needs the
        // running process to reload its code.
        const ops = verdicts.includes('CONFIG_DRIFT')
          ? [['delete', r.name], ['start', 'ecosystem.config.js', '--only', r.name]]
          : [['restart', r.name]];
        let ok = true;
        for (const args of ops) {
          const res = await runPm2(args, root);
          ok = ok && res.ok;
          if (!res.ok) { applied.push({ name: r.name, op: args[0], ok: false, detail: res.detail || null }); break; }
        }
        if (ok) applied.push({ name: r.name, op: ops.length > 1 ? 'delete+start' : 'restart', ok: true });
        else failures++;
      }
    }

    const after = dryRun ? null : await collect({ root }).catch(() => null);
    // Durable "when did the audit last run" marker — detector's
    // runtime:drift rule keys off this, so the guard re-arms hourly even
    // when everything is OK.
    const latest = after || audit;
    try {
      const statePath = scope.statePath || path.join(root, '.hydi-operational', 'runtime-audit-state.json');
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      const tmp = statePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ checkedAt: new Date().toISOString(), overall: latest.overall }, null, 2));
      fs.renameSync(tmp, statePath);
    } catch { /* state write is best-effort */ }

    const remaining = actionable.length - targets.length;
    const evidence = {
      dryRun,
      before: audit.counts || null,
      wouldApply: dryRun ? targets.map((r) => r.name) : null,
      applied,
      deferredToNextAttempt: remaining,
      after: after ? after.counts : null,
      raisedHumanActions: raised,
    };

    if (dryRun) {
      return { outcome: 'partial', reason: `dry-run: would apply restart-class fixes to ${targets.length} row(s) (${actionable.length} actionable); ${raised.length} human action(s) for rows a resolver must not touch`, evidence };
    }
    if (failures > 0 && applied.every((a) => !a.ok)) {
      return { outcome: 'failed', reason: `all ${failures} pm2 operation(s) failed — audit ${audit.overall}, ${raised.length} human action(s) raised`, evidence };
    }
    if (after && after.overall === 'OK') {
      return { outcome: 'completed', reason: `re-audit OK — applied ${applied.filter((a) => a.ok).length} restart-class fix(es)`, evidence };
    }
    return {
      outcome: 'partial',
      reason: `applied ${applied.filter((a) => a.ok).length}/${targets.length} fix(es), ${failures} failed; re-audit ${after ? after.overall : 'unreadable'}${remaining ? `; ${remaining} row(s) deferred to next attempt` : ''}${raised.length ? `; ${raised.length} human action(s) raised` : ''}`,
      evidence,
    };
  },

  /**
   * cost.audit — the daily $0 guard. Runs `node scripts/cost-audit.js
   * --strict` at most once per scope.intervalMs (default 24h) and writes
   * a durable state file the detector rule reads. On a strict failure it
   * seeds one human action per offending key — NAMES and WHERE SET only,
   * never values — plus one for the paid-LLM switch itself.
   */
  'cost.audit': async ({ action, policy, env, deps }) => {
    const scope = (policy && policy.scope) || {};
    const root = (deps && deps.root) || process.cwd();
    const statePath = scope.statePath
      || path.join(root, '.hydi-operational', 'cost-audit-state.json');
    const intervalMs = Number(scope.intervalMs) || 24 * 60 * 60 * 1000;

    let state = null;
    try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { /* absent */ }
    const now = Date.now();
    if (state && state.ranAt && now - Date.parse(state.ranAt) < intervalMs) {
      return { outcome: 'deferred', reason: `cost audit ran ${Math.round((now - Date.parse(state.ranAt)) / 60000)}min ago — next run at ${new Date(Date.parse(state.ranAt) + intervalMs).toISOString()}`, evidence: { ranAt: state.ranAt, ok: state.ok } };
    }

    const cmd = (deps && deps.runCommand) || defaultNodeScript();
    const result = await cmd('scripts/cost-audit.js', ['--strict'], root, scope.timeoutMs || 30000);
    const stdout = result && typeof result.stdout === 'string' ? result.stdout : '';
    const code = result && typeof result.code === 'number' ? result.code : 1;
    const ok = code === 0;
    const snapshot = { ranAt: new Date(now).toISOString(), ok, exitCode: code };
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      const tmp = statePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
      fs.renameSync(tmp, statePath);
    } catch { /* state write failure must not hide the audit result */ }

    if (ok) {
      return { outcome: 'completed', reason: 'strict cost audit clean — $0 constraint holding', evidence: { ranAt: snapshot.ranAt, exitCode: 0 } };
    }

    // Parse the report for WHAT is set and WHERE — names and source labels
    // only; the script never prints values, and neither do we.
    const svc = (deps && deps.service) || new (require('./service').HumanActionService)();
    const raised = [];
    const switchOn = /STRICT FAIL:\s*([A-Z0-9_]+)/.exec(stdout);
    const keyRows = [...stdout.matchAll(/^\s{2}([A-Z][A-Z0-9_]+)\s+\S.*?\bin\s+(\S+)$/gm)];
    const targets = [];
    if (switchOn) targets.push({ key: switchOn[1], source: 'the paid-LLM switch (see audit output for resolved source)', fix: `set ${switchOn[1]} to false or remove it` });
    for (const [, key, source] of keyRows) {
      targets.push({ key, source, fix: `remove ${key} from ${source} (and the same key in any hosting dashboard)` });
    }
    if (!targets.length) targets.push({ key: 'unknown', source: 'see npm run cost:audit -- --strict output', fix: 'inspect the strict failure and remove the flagged paid key or switch' });
    for (const t of targets) {
      const { action: a, created } = svc.request({
        blockerKey: `cost:paid-key:${t.key}`,
        type: 'ops',
        boundary: { category: 'OTHER', capability: 'cost.control' },
        title: `Remove paid key/switch '${t.key}' — $0 cost constraint breached`,
        description: `The daily strict cost audit failed: '${t.key}' is set in ${t.source}. Any real paid-provider key or the paid-LLM switch turns on billable fallbacks.`,
        instructions: [
          t.fix,
          'Re-run `npm run cost:audit -- --strict` locally — exit 0 clears this automatically on the next verification sweep',
        ],
        verifier: { name: 'cost-audit-clean', spec: {} },
        expectedOutcome: 'npm run cost:audit -- --strict exits 0',
        priority: 'high',
        source: 'resolver:cost.audit',
      });
      raised.push({ blockerKey: a.blockerKey, id: a.id, created });
    }
    return {
      outcome: 'failed',
      reason: `strict cost audit FAILED (exit ${code}) — ${targets.length} key/switch name(s) raised as human actions`,
      evidence: { ranAt: snapshot.ranAt, exitCode: code, flagged: targets.map((t) => ({ key: t.key, source: t.source })), raised },
    };
  },

  /**
   * phone.phantom_killer_off — turn off Android's phantom process killer
   * over adb so Termux/Ollama on the phone stop dying under load.
   *
   *   adb shell settings put global settings_enable_monitor_phantom_procs false
   *   adb shell settings get global settings_enable_monitor_phantom_procs → 'false'
   *
   * No attached device → the physical boundary is raised as
   * `phone:usb-debugging` (R3) and the attempt defers — nothing is faked.
   * Dry-run (scope.deps.dryRun) reports the commands without sending them.
   */
  'phone.phantom_killer_off': async ({ action, policy, env, deps }) => {
    const scope = (policy && policy.scope) || {};
    const setting = scope.setting || 'settings_enable_monitor_phantom_procs';
    const want = scope.value || 'false';
    const dryRun = scope.dryRun === true || (deps && deps.dryRun) === true;
    const adb = (deps && deps.adbExec) || defaultAdb();

    if (dryRun) {
      return { outcome: 'partial', reason: `dry-run: would run 'adb shell settings put global ${setting} ${want}' then verify via 'settings get'`, evidence: { dryRun: true, setting, want } };
    }

    const devices = await adb(['devices'], 15000);
    const attached = parseAdbDevices(devices.stdout);
    if (!attached.length) {
      raiseUsbAction(deps);
      return {
        outcome: 'deferred',
        reason: 'no adb device attached — human action phone:usb-debugging raised (plug the phone into Frank with USB debugging on; Android 14+ can instead toggle Developer Options → "Disable child process restrictions" without a cable)',
        evidence: { deviceCount: 0, humanAction: 'phone:usb-debugging' },
      };
    }

    const put = await adb(['shell', 'settings', 'put', 'global', setting, want], 15000);
    if (!put.ok) {
      return { outcome: 'failed', reason: `settings put failed: ${put.detail || 'nonzero exit'}`, evidence: { deviceCount: attached.length } };
    }
    const get = await adb(['shell', 'settings', 'get', 'global', setting], 15000);
    const actual = (get.stdout || '').trim();
    if (!get.ok || actual !== want) {
      return { outcome: 'failed', reason: `read-back returned '${actual || 'no output'}', expected '${want}'`, evidence: { deviceCount: attached.length, readBack: actual || null } };
    }
    return {
      outcome: 'completed',
      reason: `${setting}=${want} verified by read-back on ${attached.length} device(s)`,
      evidence: { deviceCount: attached.length, setting, value: actual },
    };
  },

  /**
   * phone.thin_client — push termux/setup-thin-client.sh to the phone's
   * Download folder, then hand the one remaining command to the human:
   * Termux itself cannot be driven over adb without root, so running the
   * script is an R3 action (phone:run-thin-client-setup). The verifier
   * on `phone:thin-client` independently checks the end state (no local
   * llama-server on the phone, Ollama requests arriving from the tailnet).
   */
  'phone.thin_client': async ({ action, policy, env, deps }) => {
    const scope = (policy && policy.scope) || {};
    const root = (deps && deps.root) || process.cwd();
    const src = path.resolve(root, scope.src || 'termux/setup-thin-client.sh');
    const dst = scope.dst || '/sdcard/Download/';
    const dryRun = scope.dryRun === true || (deps && deps.dryRun) === true;
    const adb = (deps && deps.adbExec) || defaultAdb();

    if (!fs.existsSync(src)) {
      return { outcome: 'failed', reason: `script missing: ${path.relative(root, src)}`, evidence: null };
    }
    if (dryRun) {
      return { outcome: 'partial', reason: `dry-run: would 'adb push ${path.relative(root, src)} ${dst}' then raise the Termux-run human action`, evidence: { dryRun: true, src: path.relative(root, src), dst } };
    }

    const devices = await adb(['devices'], 15000);
    const attached = parseAdbDevices(devices.stdout);
    if (!attached.length) {
      raiseUsbAction(deps);
      return {
        outcome: 'deferred',
        reason: 'no adb device attached — human action phone:usb-debugging raised',
        evidence: { deviceCount: 0, humanAction: 'phone:usb-debugging' },
      };
    }

    const pushed = await adb(['push', src, dst], 30000);
    if (!pushed.ok) {
      return { outcome: 'failed', reason: `adb push failed: ${pushed.detail || 'nonzero exit'}`, evidence: { deviceCount: attached.length } };
    }

    const svc = (deps && deps.service) || new (require('./service').HumanActionService)();
    const { action: termuxAction, created } = svc.request({
      blockerKey: 'phone:run-thin-client-setup',
      type: 'ops',
      boundary: { category: 'PHYSICAL_ACTION', externalSystem: 'termux', capability: 'phone.termux.execute' },
      title: 'Run setup-thin-client.sh on the phone (Termux cannot be driven over adb)',
      description: 'The setup script is now at /sdcard/Download/setup-thin-client.sh on the phone. Termux is an app sandbox — adb can push the file but cannot execute it without root. This is the irreducibly-human step.',
      instructions: [
        'On the phone, open Termux and run: bash /sdcard/Download/setup-thin-client.sh --dry-run',
        'Review the printed plan, then run it for real: bash /sdcard/Download/setup-thin-client.sh --disable-local-llm',
        'The script kills llama-server, disables its autostart, and points the phone at Frank\'s Ollama over the tailnet',
        'Verification is automatic: Heidi checks the phone no longer listens on :8080 and Frank\'s Ollama log shows requests from the phone\'s tailnet IP',
      ],
      verifier: { name: 'phone-thin-client', spec: {} },
      expectedOutcome: 'Phone serves nothing on :8080 and reaches Frank\'s Ollama over the tailnet',
      priority: 'normal',
      source: 'resolver:phone.thin_client',
    });

    return {
      outcome: 'partial',
      reason: `script pushed to ${dst} — remaining step is on-device (action phone:run-thin-client-setup ${created ? 'raised' : 'already open'})`,
      evidence: { pushed: `${path.relative(root, src)} → ${dst}`, deviceCount: attached.length, humanActionId: termuxAction.id },
    };
  },
};

// ─── Bounded command helpers ─────────────────────────────────────────────
// All resolvers run external commands through these: execFile (never a
// shell string), literal argument arrays, a hard timeout, and a normalized
// { ok, code, stdout, detail } result. deps.* injection replaces them in
// tests — nothing here is reachable by name from a persisted record.

function execBounded(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const { execFile } = require('child_process');
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    try {
      const child = execFile(cmd, args, {
        cwd: opts.cwd || process.cwd(),
        timeout: opts.timeoutMs || 15000,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
        // Windows .cmd shims (pm2) cannot spawn directly under Node >=22
        // (CVE-2024-27980); args here are literal constants, never input.
        shell: opts.shell === true && process.platform === 'win32',
      }, (err, stdout, stderr) => {
        if (err) {
          done({ ok: false, code: typeof err.code === 'number' ? err.code : 1, stdout: stdout || '', detail: (stderr || err.message || 'exec failed').trim().slice(0, 300) });
          return;
        }
        done({ ok: true, code: 0, stdout: stdout || '', detail: null });
      });
      if (child && typeof child.on === 'function') child.on('error', (e) => done({ ok: false, code: 1, stdout: '', detail: e.message }));
    } catch (e) {
      done({ ok: false, code: 1, stdout: '', detail: e instanceof Error ? e.message : 'spawn failed' });
    }
  });
}

/** pm2 shim — .cmd on Windows → shell:true required; args are constants. */
function defaultPm2() {
  return (args, cwd) => execBounded('pm2', args, { cwd, shell: true, timeoutMs: 30000 });
}

/** `node scripts/<file>` — bounded; returns {ok, code, stdout}. */
function defaultNodeScript() {
  return async (script, args, cwd, timeoutMs) => {
    const r = await execBounded(process.execPath, [path.join(cwd || process.cwd(), script), ...(args || [])], { cwd, timeoutMs: timeoutMs || 30000 });
    return { code: r.code, stdout: r.stdout || '' };
  };
}

/** adb — a real .exe on every platform, no shell needed. */
function defaultAdb() {
  return (args, timeoutMs) => execBounded('adb', args, { timeoutMs: timeoutMs || 15000 });
}

/** `adb devices` stdout → attached, authorized device ids only. */
function parseAdbDevices(stdout) {
  return String(stdout || '').split(/\r?\n/).slice(1)
    .map((l) => l.trim()).filter(Boolean)
    .filter((l) => /\tdevice$/.test(l))
    .map((l) => l.split('\t')[0]);
}

/**
 * The irreducibly-physical prerequisite every phone resolver shares.
 * Dedupe-keyed: resolver attempts and any manual seed converge on one
 * action. R3 — a cable + a human's debugging toggle; no agent can cross it.
 */
function raiseUsbAction(deps) {
  const svc = (deps && deps.service) || new (require('./service').HumanActionService)();
  return svc.request({
    blockerKey: 'phone:usb-debugging',
    type: 'ops',
    boundary: { category: 'PHYSICAL_ACTION', externalSystem: 'adb', capability: 'phone.physical.attach' },
    title: 'Plug the phone into Frank with USB debugging on',
    description: 'Phone-side work (phantom-killer fix, thin-client push) requires an adb session. No device is attached. Alternatively, on Android 14+ enable Developer Options → "Disable child process restrictions" to fix phantom killing without a cable.',
    instructions: [
      'Connect the phone to Frank by USB',
      'On the phone: Settings → Developer options → USB debugging → ON, and accept the computer\'s fingerprint',
      'Optional no-cable path (Android 14+): Developer options → "Disable child process restrictions"',
      'Tell Heidi "check again" — `adb devices` is re-checked automatically',
    ],
    verifier: { name: 'phone-adb-attached', spec: {} },
    expectedOutcome: '`adb devices` lists the phone as authorized (status device, not unauthorized)',
    priority: 'normal',
    source: 'resolver:phone',
  });
}

/** Look up a resolver by id. Unknown ids return null — never executed. */
function getResolver(id) {
  return id ? RESOLVERS[id] || null : null;
}

module.exports = { RESOLVERS, getResolver, writeEnvValue, persistCredential };
