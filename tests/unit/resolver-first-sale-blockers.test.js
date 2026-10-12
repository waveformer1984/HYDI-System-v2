'use strict';

/**
 * First-sale blocker resolvers — autonomous resolution behaviors.
 *
 * Covers the mission-required semantics:
 *  - funnel resolver: tailnet-ACL refusal → 'unauthorized'; success →
 *    public URL persisted + gated endpoints still refused
 *  - prospect-research: service OFF → 'deferred'; real discovery →
 *    recorded through the governed API; dedupe 409 is not failure
 *  - stripe-credential-scan: no live credential anywhere → 'unauthorized'
 *    with the dashboard step, never fabricated
 *  - outreach-prepare: drafts generated but outcome stays 'partial' —
 *    the authorization boundary is never self-granted
 *  - verifier upgrade: re-requesting a deduped action upgrades
 *    manual → machine verifier durably
 *  - $49 offer rejected when the authorization cap is $29
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { getResolver } = require('../../lib/human-actions/resolvers.js');
const { classifyAction, isAgentResolvable } = require('../../lib/human-actions/resolver-policy.js');
const { HumanActionService } = require('../../lib/human-actions/service.js');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'res-')); }

const envOf = (vars = {}) => ({
  envValue: (n) => vars[n] ?? process.env[n] ?? null,
  envNamePresent: (n) => !!(vars[n] ?? process.env[n]),
});

// ─── public exposure is never autonomous ─────────────────────────────────

describe('public exposure', () => {
  it('no resolver can enable Tailscale Funnel or any tunnel', () => {
    expect(getResolver('tailscale-funnel-url')).toBeNull();
  });

  it('stable-public-url is an owner decision (R2), never executed', () => {
    const c = classifyAction({ blockerKey: 'protoforge:stable-public-url', boundary: { category: 'OTHER' } });
    expect(c.resolutionClass).toBe('R2');
    expect(isAgentResolvable(c.resolutionClass)).toBe(false);
  });
});

// ─── prospect-research resolver ──────────────────────────────────────────

describe('prospect-research resolver', () => {
  const action = { id: 'a2', blockerKey: 'checkpoint:demand-prospects' };
  const policy = { resolverId: 'prospect-research', scope: { serviceId: 'checkpoint_audit', minCount: 5, maxResults: 5 } };

  it('defers when the revenue service switch is OFF', async () => {
    const dir = tmpDir();
    const r = await getResolver('prospect-research')({ action, policy, env: envOf(), deps: { switchPath: path.join(dir, 'sw.json') } });
    expect(r.outcome).toBe('deferred');
    expect(r.reason).toMatch(/OFF/);
  });

  it('records discovered businesses through the governed API when ON', async () => {
    const dir = tmpDir();
    const switchPath = path.join(dir, 'sw.json');
    const { setServiceSwitch } = require('../../lib/revenue/revenue-service-switch.js');
    setServiceSwitch('checkpoint_audit', { serviceEnabled: true }, { configPath: switchPath });

    const discovered = Array.from({ length: 6 }, (_, i) => ({
      companyName: `Real Biz ${i}`, website: `https://biz${i}.example.com`,
      contactPhone: null, industry: 'hvac', sourceUrl: `https://osm.org/node/${i}`,
    }));
    const discoveryModule = { discoverFromOverpass: async () => discovered };
    const posted = [];
    const postProspect = async (p) => {
      posted.push(p.companyName);
      return posted.length === 2 ? { status: 409 } : { status: 201 };
    };
    const expPath = path.join(dir, 'exp.json');
    fs.writeFileSync(expPath, JSON.stringify({ prospects: [] }));
    const r = await getResolver('prospect-research')({
      action, policy: { ...policy, scope: { ...policy.scope, experimentPath: expPath } },
      env: envOf({ HYDI_SERVICE_SECRET: 'x' }),
      deps: { switchPath, discoveryModule, postProspect },
    });
    expect(r.outcome).toBe('completed');
    expect(r.evidence.added).toBe(5); // a 409 dedupe doesn't count toward the threshold
    expect(r.evidence.deduped).toBe(1);
    expect(r.evidence.now).toBe(5);
  });
});

// ─── stripe-credential-scan resolver ─────────────────────────────────────

describe('stripe-credential-scan resolver', () => {
  const action = { id: 'a3', blockerKey: 'stripe:live-credential' };
  const policy = { resolverId: 'stripe-credential-scan', scope: {} };

  it('is unauthorized when no live credential exists in any approved source', async () => {
    const r = await getResolver('stripe-credential-scan')({
      action, policy, env: envOf({ STRIPE_SECRET_KEY: 'sk_test_xyz' }),
      deps: { credentialHealth: async () => ({ configured: true, mode: 'test' }) },
    });
    expect(r.outcome).toBe('unauthorized');
    expect(r.reason).toMatch(/dashboard|restricted/i);
  });

  it('completes immediately when a live credential is already in env', async () => {
    const r = await getResolver('stripe-credential-scan')({
      action, policy, env: envOf({ STRIPE_SECRET_KEY: 'rk_live_abc' }),
      deps: {},
    });
    expect(r.outcome).toBe('completed');
  });
});

// ─── outreach-prepare resolver ───────────────────────────────────────────

describe('outreach-prepare resolver', () => {
  const action = { id: 'a4', blockerKey: 'checkpoint:outreach-authorization' };

  it('prepares drafts but stays partial — authorization is never self-granted', async () => {
    const dir = tmpDir();
    const switchPath = path.join(dir, 'sw.json');
    require('../../lib/revenue/revenue-service-switch.js').setServiceSwitch('checkpoint_audit', { serviceEnabled: true }, { configPath: switchPath });
    const expPath = path.join(dir, 'exp.json');
    fs.writeFileSync(expPath, JSON.stringify({
      sampleOutreachMessage: 'Audit for [business]?',
      prospects: [{ prospectId: 'p1', businessName: 'Real Co', legitimate: true, source: 'osm', contactChannel: 'site', relevanceReason: 'fit' }],
    }));
    const draftsPath = path.join(dir, 'drafts.json');
    const policy = { resolverId: 'outreach-prepare', scope: { serviceId: 'checkpoint_audit', experimentPath: expPath, draftsPath } };
    const r = await getResolver('outreach-prepare')({ action, policy, env: envOf(), deps: { switchPath } });
    expect(r.outcome).toBe('partial');
    expect(r.evidence.awaitingAuthorization).toBe(true);
    const drafts = JSON.parse(fs.readFileSync(draftsPath, 'utf8'));
    expect(drafts.drafts[0].status).toBe('prepared_pending_authorization');
    // idempotent: second run creates no duplicate draft
    const r2 = await getResolver('outreach-prepare')({ action, policy, env: envOf(), deps: { switchPath } });
    expect(r2.evidence.newDrafts).toBe(0);
  });

  it('is unauthorized with zero legitimate prospects — never personalizes fiction', async () => {
    const dir = tmpDir();
    const switchPath = path.join(dir, 'sw.json');
    require('../../lib/revenue/revenue-service-switch.js').setServiceSwitch('checkpoint_audit', { serviceEnabled: true }, { configPath: switchPath });
    const expPath = path.join(dir, 'exp.json');
    fs.writeFileSync(expPath, JSON.stringify({ prospects: [] }));
    const policy = { resolverId: 'outreach-prepare', scope: { serviceId: 'checkpoint_audit', experimentPath: expPath, draftsPath: path.join(dir, 'd.json') } };
    const r = await getResolver('outreach-prepare')({ action, policy, env: envOf(), deps: { switchPath } });
    expect(r.outcome).toBe('unauthorized');
  });
});

// ─── policy classification ───────────────────────────────────────────────

describe('resolution policy', () => {
  it('classifies the five blockers honestly', () => {
    const c = (k) => classifyAction({ blockerKey: k, boundary: { category: 'OTHER' } });
    expect(c('checkpoint:demand-prospects').resolutionClass).toBe('R0');
    expect(isAgentResolvable(c('protoforge:stable-public-url').resolutionClass)).toBe(false);
    expect(isAgentResolvable(c('stripe:live-credential').resolutionClass)).toBe(true);
    expect(isAgentResolvable(c('checkpoint:outreach-authorization').resolutionClass)).toBe(true);
    // live-transaction authorization stays a deliberate human gate
    expect(c('stripe:live-transaction-authorization').resolutionClass).toBe('R2');
    expect(isAgentResolvable(c('stripe:live-transaction-authorization').resolutionClass)).toBe(false);
  });

  it('keeps unknown boundaries fail-closed on the human path', () => {
    const c = classifyAction({ blockerKey: 'totally:unknown', boundary: { category: 'CREDENTIAL' } });
    expect(c.resolutionClass).toBe('R2');
  });
});

// ─── verifier upgrade on dedupe ──────────────────────────────────────────

describe('verifier upgrade', () => {
  it('upgrades a manual verifier to a machine verifier on re-request', () => {
    const dir = tmpDir();
    process.env.HYDI_HUMAN_ACTIONS_FILE = path.join(dir, 'actions.json');
    const svc = new HumanActionService();
    const spec = { blockerKey: 'k1', title: 't', verifier: { name: 'manual', spec: {} } };
    const { action } = svc.request(spec);
    const r2 = svc.request({ ...spec, verifier: { name: 'http-reachable', spec: { urlEnv: 'X' } } });
    expect(r2.created).toBe(false);
    expect(r2.action.id).toBe(action.id);
    expect(svc.get(action.id).verifier.name).toBe('http-reachable');
    expect(svc.get(action.id).transitions.some((t) => t.type === 'VERIFIER_UPGRADED')).toBe(true);
    delete process.env.HYDI_HUMAN_ACTIONS_FILE;
  });
});

// ─── amount cap vs offer price ───────────────────────────────────────────

describe('live-transaction authorization cap', () => {
  it('rejects a $49 transaction under the $29 cap — cap is never silently raised', () => {
    const { LiveTransactionAuthorizationManager } = require('../../lib/revenue/LiveTransactionAuthorization');
    const mgr = new LiveTransactionAuthorizationManager(path.join(tmpDir(), 'auth.json'));
    const r = mgr.issue({ authorizedBy: 'operator', customer: 'c@x.com', amountCents: 4900 });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/exceeds/);
  });
});

// ─── amount-aware live-auth verifier ─────────────────────────────────────

describe('live-auth-issued verifier minAmountCents', () => {
  const { runVerifier } = require('../../lib/human-actions/verifiers.js');
  const storeWith = (entries) => {
    const p = path.join(tmpDir(), 'auth.json');
    fs.writeFileSync(p, JSON.stringify(Object.fromEntries(entries.map((e, i) => [`a${i}`, e]))));
    return p;
  };
  const fresh = (amountCents) => ({ authorizationId: 'auth_x', state: 'PENDING', amountCents, expiresAt: new Date(Date.now() + 3600e3).toISOString(), authorizedBy: 'operator', scope: 'single-transaction' });

  it('a fresh authorization below the required amount does NOT close the blocker', async () => {
    const storePath = storeWith([fresh(2900)]);
    const r = await runVerifier('live-auth-issued', { storePath, minAmountCents: 4900 });
    expect(r.status).toBe('FAILED');
    expect(r.failureReason).toMatch(/amount boundary/);
  });

  it('a fresh authorization covering the required amount closes the blocker', async () => {
    const storePath = storeWith([fresh(4900)]);
    const r = await runVerifier('live-auth-issued', { storePath, minAmountCents: 4900 });
    expect(r.status).toBe('VERIFIED');
    expect(r.passed).toBe(true);
  });
});
