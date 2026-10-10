import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readConfig } from '../src/config.js';
import { signServiceToken } from '../src/clients.js';
import { TOOLS, registerAll } from '../src/tools.js';

const require = createRequire(import.meta.url);
const { verifyServiceToken } = require('../../../lib/auth/verifyServiceToken.js');

const tool = (name) => TOOLS.find((t) => t.name === name);

/** Fake fetch: routes by URL substring, records calls. */
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, opts = {}) => {
    calls.push({ url, headers: opts.headers || {} });
    for (const [match, reply] of Object.entries(routes)) {
      if (url.includes(match)) {
        if (reply instanceof Error) throw reply;
        const { status = 200, body = {} } = reply;
        return { ok: status < 400, status, text: async () => JSON.stringify(body) };
      }
    }
    const err = new TypeError('fetch failed');
    err.cause = { code: 'ECONNREFUSED' };
    throw err;
  };
  return { impl, calls };
}

const baseEnv = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'srk',
  HYDI_SERVICE_SECRET: 'test-secret',
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_ACCOUNT_GALACTIC_BYTES: 'acct_gb',
};
const ctxWith = (routes, env = baseEnv) => {
  const f = fakeFetch(routes);
  return { ctx: { cfg: readConfig(env), deps: { fetchImpl: f.impl } }, calls: f.calls };
};

test('service tokens verify with the repo’s own verifier', () => {
  const token = signServiceToken('test-secret');
  const result = verifyServiceToken(token, 'test-secret');
  assert.equal(result.valid, true);
  assert.equal(result.service, 'protoforge-mcp');
  assert.equal(verifyServiceToken(token, 'wrong').valid, false);
});

test('every tool is read-only in v0.1', () => {
  assert.ok(TOOLS.length >= 8);
  for (const t of TOOLS) assert.equal(t.risk, 'read', t.name);
});

test('registerAll skips non-read tiers and rejects unknown tiers', () => {
  const registered = [];
  const server = { registerTool: (name) => registered.push(name) };
  const fake = [
    { name: 'a', risk: 'read', inputSchema: {}, handler: async () => ({}) },
    { name: 'b', risk: 'gated', inputSchema: {}, handler: async () => ({}) },
  ];
  assert.deepEqual(registerAll(server, {}, fake), ['a']);
  assert.throws(() => registerAll(server, {}, [{ name: 'c', risk: 'yolo' }]), /unknown risk tier/);
});

test('system_health reports each service independently', async () => {
  const { ctx } = ctxWith({ ':3005/health': { body: { ok: true } }, ':3000/api/health': { status: 503, body: { error: 'db down' } } });
  const r = await tool('system_health').handler({}, ctx);
  assert.equal(r.all_up, false);
  const by = Object.fromEntries(r.checks.map((c) => [c.service, c]));
  assert.equal(by['protoforge-core'].up, true);
  assert.equal(by['heidi-web'].up, false);
  assert.equal(by['heidi-web'].error, 'db down');
  assert.match(by['heidi-mobile-chat'].error, /ECONNREFUSED/);
});

test('mobile_status signs the request as the owner', async () => {
  const { ctx, calls } = ctxWith({ '/api/mobile-status': { body: { status: 'ok' } } });
  const r = await tool('mobile_status').handler({}, ctx);
  assert.deepEqual(r, { ok: true, data: { status: 'ok' } });
  const token = calls[0].headers['x-hydi-service-token'];
  assert.equal(verifyServiceToken(token, 'test-secret').valid, true);
});

test('mobile_status explains a missing secret instead of calling out', async () => {
  const { ctx, calls } = ctxWith({}, { ...baseEnv, HYDI_SERVICE_SECRET: '' });
  const r = await tool('mobile_status').handler({}, ctx);
  assert.equal(r.ok, false);
  assert.match(r.error, /HYDI_SERVICE_SECRET/);
  assert.equal(calls.length, 0);
});

test('pending_approvals counts actions', async () => {
  const { ctx } = ctxWith({ '/api/actions': { body: { actions: [{ id: '1' }, { id: '2' }] } } });
  const r = await tool('pending_approvals').handler({}, ctx);
  assert.equal(r.data.count, 2);
});

test('recent_actions builds a filtered PostgREST query with service-role auth', async () => {
  const { ctx, calls } = ctxWith({ '/rest/v1/actions': { body: [{ id: 'x', status: 'failed' }] } });
  const r = await tool('recent_actions').handler({ status: 'failed', limit: 5 }, ctx);
  assert.equal(r.data.count, 1);
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get('status'), 'eq.failed');
  assert.equal(u.searchParams.get('limit'), '5');
  assert.ok(!u.searchParams.get('select').includes('payload'), 'payloads stay out of results');
  assert.equal(calls[0].headers.Authorization, 'Bearer srk');
});

test('heidi_events filters by division and verdict', async () => {
  const { ctx, calls } = ctxWith({ '/rest/v1/heidi_events': { body: [] } });
  const r = await tool('heidi_events').handler({ division: 'rezonate', verdict: 'BLOCK', limit: 10 }, ctx);
  assert.equal(r.data.count, 0);
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get('division'), 'eq.rezonate');
  assert.equal(u.searchParams.get('verdict'), 'eq.BLOCK');
});

test('decision_bounds reports lease state and exec flag', async () => {
  const future = new Date(Date.now() + 60000).toISOString();
  const { ctx } = ctxWith({
    '/rest/v1/heidi_decision_bounds': { body: [{ auto_approve_threshold: 0.85, lease_holder: 'frank', lease_expires: future }] },
  });
  const r = await tool('decision_bounds').handler({}, ctx);
  assert.equal(r.data.configured, true);
  assert.equal(r.data.lease_active, true);
  assert.equal(r.data.exec_enabled_here, false);
});

test('stripe_balance scopes to a Connect account and strips extra fields', async () => {
  const { ctx, calls } = ctxWith({
    '/v1/balance': { body: { livemode: false, available: [{ amount: 1200, currency: 'usd', source_types: {} }], pending: [] } },
  });
  const r = await tool('stripe_balance').handler({ stream: 'galactic_bytes' }, ctx);
  assert.deepEqual(r.data.available, [{ amount: 1200, currency: 'usd' }]);
  assert.equal(calls[0].headers['Stripe-Account'], 'acct_gb');
});

test('stripe_balance refuses an unmapped stream', async () => {
  const { ctx, calls } = ctxWith({});
  const r = await tool('stripe_balance').handler({ stream: 'rezonate' }, ctx);
  assert.equal(r.ok, false);
  assert.match(r.error, /STRIPE_ACCOUNT_REZONATE/);
  assert.equal(calls.length, 0);
});

test('boot_plan orders the real boot.config.json without spawning anything', async () => {
  const r = await tool('boot_plan').handler({}, { cfg: readConfig(baseEnv), deps: {} });
  assert.equal(r.ok, true);
  const ids = r.order.map((m) => m.id);
  assert.equal(ids[0], 'protoforge-core');
  assert.ok(ids.indexOf('heidi-web') > ids.indexOf('protoforge-core'), 'heidi-web boots after its dependency');
  assert.ok(!ids.includes('hydi-orchestrator'), 'disabled modules are not in the order');
  assert.ok(r.disabled.includes('hydi-orchestrator'));
});

test('boot_plan never shells out (boot-agent --dry-run claims the live boot lease)', async () => {
  const src = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/tools.js', import.meta.url), 'utf8'));
  assert.ok(!/child_process/.test(src), 'tools.js must not import child_process');
});

test('boot_plan detects dependency cycles', async () => {
  const readFileImpl = async () => JSON.stringify({ modules: [{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }] });
  const r = await tool('boot_plan').handler({}, { cfg: readConfig(baseEnv), deps: { readFileImpl } });
  assert.equal(r.ok, false);
  assert.match(r.error, /cycle/);
});
