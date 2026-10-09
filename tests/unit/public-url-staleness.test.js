// Stale public-base-URL detection + webhook listener helpers.
// Isolated store per run; fetch is injected — no network in tests.
const os = require('os');
const path = require('path');
const fs = require('fs');
const tmpFile = path.join(os.tmpdir(), `human-actions-stale-${process.pid}-${Date.now()}.json`);
process.env.HYDI_HUMAN_ACTIONS_FILE = tmpFile;

const { HumanActionService } = require('../../lib/human-actions/service');
const { detectStaleBaseUrl, syncHumanActions } = require('../../lib/human-actions/detector');
const { parseWhsecSecret, upsertEnvVar } = require('../../scripts/stripe-webhook-listener');

const envWith = (kv) => ({
  envNamePresent: (n) => kv[n] != null,
  envValue: (n) => kv[n] ?? null,
});

beforeEach(() => { try { fs.unlinkSync(tmpFile); } catch { /* first run */ } });

describe('detectStaleBaseUrl', () => {
  test('no base URL configured → not checked, no action', async () => {
    const s = new HumanActionService({});
    const r = await detectStaleBaseUrl(s, envWith({}));
    expect(r.checked).toBe(false);
    expect(s.listOpen().length).toBe(0);
  });

  test('reachable URL → no action', async () => {
    const s = new HumanActionService({});
    const fetch = async (u) => ({ ok: true, status: 200, json: async () => ({ tunnels: [] }) });
    const r = await detectStaleBaseUrl(s, envWith({ NEXT_PUBLIC_APP_URL: 'https://shop.example.com' }), { fetch });
    expect(r.stale).toBe(false);
    expect(s.listOpen().length).toBe(0);
  });

  test('unreachable URL → action created with env-bound verifier', async () => {
    const s = new HumanActionService({});
    const fetch = async () => { throw new Error('tunnel closed'); };
    const r = await detectStaleBaseUrl(s, envWith({ NEXT_PUBLIC_APP_URL: 'https://dead.ngrok-free.dev' }), { fetch });
    expect(r.stale).toBe(true);
    expect(r.created).toBe(true);
    const a = s.get(r.actionId);
    expect(a.blockerKey).toBe('protoforge:public-base-url-stale');
    expect(a.verifier).toEqual({ name: 'http-reachable', spec: { urlEnv: 'NEXT_PUBLIC_APP_URL' } });
    expect(a.instructions.join(' ')).toMatch(/4040\/api\/tunnels/);
  });

  test('dedupe: second detection does not create a second action', async () => {
    const s = new HumanActionService({});
    const fetch = async () => { throw new Error('down'); };
    const r1 = await detectStaleBaseUrl(s, envWith({ APP_BASE_URL: 'https://x.example.dev' }), { fetch });
    const r2 = await detectStaleBaseUrl(s, envWith({ APP_BASE_URL: 'https://x.example.dev' }), { fetch });
    expect(r1.created).toBe(true);
    expect(r2.created).toBe(false);
    expect(s.listOpen().filter((a) => a.blockerKey === 'protoforge:public-base-url-stale').length).toBe(1);
  });

  test('transient failure then success → not stale (hysteresis)', async () => {
    const s = new HumanActionService({});
    let calls = 0;
    const fetch = async () => (++calls === 1 ? (() => { throw new Error('blip'); })() : { ok: true, status: 200 });
    const r = await detectStaleBaseUrl(s, envWith({ NEXT_PUBLIC_APP_URL: 'https://flaky.example.dev' }), { fetch, retryDelayMs: 1 });
    expect(r.stale).toBe(false);
    expect(calls).toBe(3); // probe×2 (1 blip + 1 ok) + ngrok identity check
    expect(s.listOpen().filter((a) => a.blockerKey === 'protoforge:public-base-url-stale').length).toBe(0);
  });

  test('persistent failure across all attempts → stale', async () => {
    const s = new HumanActionService({});
    let calls = 0;
    const fetch = async () => { calls++; throw new Error('still down'); };
    const r = await detectStaleBaseUrl(s, envWith({ NEXT_PUBLIC_APP_URL: 'https://dead.example.dev' }), { fetch, retryDelayMs: 1 });
    expect(r.stale).toBe(true);
    expect(calls).toBe(2);
  });

  test('live tunnel API exposes a different host → stale (replaced URL)', async () => {
    const s = new HumanActionService({});
    const fetch = async (u) => {
      if (String(u).includes('4040')) {
        return { ok: true, json: async () => ({ tunnels: [{ public_url: 'https://new-name.ngrok-free.dev' }] }) };
      }
      return { ok: true, status: 200 };
    };
    const r = await detectStaleBaseUrl(s, envWith({ NEXT_PUBLIC_APP_URL: 'https://old-name.ngrok-free.dev' }), { fetch });
    expect(r.stale).toBe(true);
    expect(r.staleReason).toMatch(/not among live tunnels/);
  });

  test('stale action resolves when URL becomes reachable again', async () => {
    const env = envWith({ NEXT_PUBLIC_APP_URL: 'https://flaky.ngrok-free.dev' });
    let up = false;
    const fetch = async () => (up ? { ok: true, status: 200 } : (() => { throw new Error('down'); })());
    const s = new HumanActionService({ verifierDeps: { fetch, envValue: env.envValue } });
    const r = await detectStaleBaseUrl(s, env, { fetch });
    expect(r.stale).toBe(true);
    up = true;
    const out = await syncHumanActions(s, null, { env, staleCheck: { fetch }, verify: { throttleMs: 0 } });
    const a = s.get(r.actionId);
    expect(a.status).toBe('RESOLVED');
    expect(a.resolution).toBe('auto_verified');
  });
});

describe('stripe webhook listener helpers', () => {
  test('parses whsec_ from listen output, ignores other lines', () => {
    expect(parseWhsecSecret('Ready! Your webhook signing secret is whsec_abcdef1234567890abcdef')).toBe('whsec_abcdef1234567890abcdef');
    expect(parseWhsecSecret('2026-01-01 --> charge.succeeded [evt_123]')).toBeNull();
    expect(parseWhsecSecret('')).toBeNull();
  });

  test('upsertEnvVar replaces existing line or appends', () => {
    const t = 'FOO=1\nSTRIPE_WEBHOOK_SECRET_01=whsec_old\nBAR=2\n';
    const out = upsertEnvVar(t, 'STRIPE_WEBHOOK_SECRET_01', 'whsec_new1234567890abcdef');
    expect(out).toContain('STRIPE_WEBHOOK_SECRET_01=whsec_new1234567890abcdef');
    expect(out).toContain('FOO=1');
    expect(out.match(/STRIPE_WEBHOOK_SECRET_01=/g).length).toBe(1);
    const appended = upsertEnvVar('FOO=1\n', 'STRIPE_WEBHOOK_SECRET_01', 'whsec_x1234567890abcde');
    expect(appended).toMatch(/STRIPE_WEBHOOK_SECRET_01=whsec_x1234567890abcde/);
  });
});
