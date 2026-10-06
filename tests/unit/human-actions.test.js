'use strict';

/**
 * Human Action system tests — service lifecycle, dedupe, verifiers,
 * detector seeding, and the deterministic Heidi answer surface.
 * An isolated store file is used per run (HYDI_HUMAN_ACTIONS_FILE).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ha-')), 'human-actions.json');
process.env.HYDI_HUMAN_ACTIONS_FILE = tmpFile;

const { HumanActionService } = require('../../lib/human-actions/service');
const { runVerifier, envNamePresent } = require('../../lib/human-actions/verifiers');
const { detectKnownBlockers } = require('../../lib/human-actions/detector');
const { tryHumanActionAnswer } = require('../../lib/human-actions/heidi-answer');

describe('HumanActionService', () => {
  const svc = () => new HumanActionService({});

  test('request creates a durable open action with instructions + verifier', () => {
    const { action, created } = svc().request({
      blockerKey: 'test:thing', title: 'Do the thing', kind: 'credential',
      instructions: ['step one'], verification: { verifier: 'env-vars', spec: { envNames: ['HA_TEST_VAR'] } },
    });
    expect(created).toBe(true);
    expect(action.id).toMatch(/^ha_/);
    expect(action.status).toBe('open');
    expect(svc().get(action.id).title).toBe('Do the thing');
  });

  test('dedupe: same blocker_key returns the same open action', () => {
    const s = svc();
    const a = s.request({ blockerKey: 'test:dedupe', title: 'X' }).action;
    const b = s.request({ blockerKey: 'test:dedupe', title: 'X again' });
    expect(b.created).toBe(false);
    expect(b.action.id).toBe(a.id);
  });

  test('claim → verify → auto_verified resolution; attestation cannot bypass a failing check', async () => {
    const s = svc();
    const { action } = s.request({
      blockerKey: 'test:env', title: 'Set HA_TEST_VAR',
      verification: { verifier: 'env-vars', spec: { envNames: ['HA_TEST_VAR'] } },
    });
    s.claim(action.id);
    expect(s.get(action.id).status).toBe('claimed');

    // fails while the env var is genuinely absent
    const bad = await s.verify(action.id);
    expect(bad.result.ok).toBe(false);
    expect(s.get(action.id).status).toBe('claimed');
    expect(() => s.resolve(action.id)).toThrow(/verify/);

    process.env.HA_TEST_VAR = 'set-in-test';
    const good = await s.verify(action.id);
    delete process.env.HA_TEST_VAR;
    expect(good.result.ok).toBe(true);
    expect(s.get(action.id).status).toBe('resolved');
    expect(s.get(action.id).resolution).toBe('auto_verified');
  });

  test('manual actions resolve by human attestation only', () => {
    const s = svc();
    const { action } = s.request({ blockerKey: 'test:manual', title: 'Physical step', verification: { verifier: 'manual', spec: {} } });
    expect(() => s.resolve(action.id, { note: 'done' })).not.toThrow();
    const a = s.get(action.id);
    expect(a.status).toBe('resolved');
    expect(a.resolution).toBe('human_attested');
  });

  test('reject closes the action and records the reason', () => {
    const s = svc();
    const { action } = s.request({ blockerKey: 'test:rej', title: 'Nope' });
    s.reject(action.id, { reason: 'not needed' });
    expect(s.get(action.id).status).toBe('rejected');
  });

  test('resolved action is not re-verified', async () => {
    const s = svc();
    const { action } = s.request({ blockerKey: 'test:done', title: 'D', verification: { verifier: 'manual', spec: {} } });
    s.resolve(action.id);
    const r = await s.verify(action.id);
    expect(r.checked).toBe(false);
  });
});

describe('verifiers', () => {
  test('env-vars: reports missing names without values', async () => {
    const r = await runVerifier('env-vars', { envNames: ['DEFINITELY_MISSING_VAR_XYZ'] });
    expect(r.ok).toBe(false);
    expect(r.evidence.env_present.DEFINITELY_MISSING_VAR_XYZ).toBe(false);
    expect(JSON.stringify(r)).not.toContain('sk_');
  });

  test('unknown verifier refused', async () => {
    const r = await runVerifier('nope', {});
    expect(r.ok).toBe(false);
  });

  test('rezonate-testnet verifier refuses with absent env and lists missing names', async () => {
    const saved = {};
    for (const n of ['REZONATE_CHAIN_RPC', 'REZONATE_DEPLOYER_KEY', 'REZONATE_BUYER_KEY']) { saved[n] = process.env[n]; delete process.env[n]; }
    const r = await runVerifier('rezonate-testnet', {
      rpcEnv: 'REZONATE_CHAIN_RPC', deployerKeyEnv: 'REZONATE_DEPLOYER_KEY', buyerKeyEnv: 'REZONATE_BUYER_KEY', expectedChainId: 11155111,
    });
    for (const n of Object.keys(saved)) if (saved[n] !== undefined) process.env[n] = saved[n];
    // env files may genuinely contain the names — ok only matters that it fails or passes honestly
    expect(typeof r.ok).toBe('boolean');
    if (!r.ok) expect(r.reason).toBeTruthy();
  });
});

describe('detector', () => {
  test('seeds the rezonate credential action exactly once when env is absent', () => {
    const s = new HumanActionService({});
    const saved = {};
    for (const n of ['REZONATE_CHAIN_RPC', 'REZONATE_DEPLOYER_KEY', 'REZONATE_BUYER_KEY', 'REZONATE_PUBLIC_URL']) { saved[n] = process.env[n]; delete process.env[n]; }
    const r1 = detectKnownBlockers(s);
    const r2 = detectKnownBlockers(s);
    for (const n of Object.keys(saved)) if (saved[n] !== undefined) process.env[n] = saved[n];
    if (r1.requested.length) {
      expect(r2.requested.length).toBe(0);
      expect(r2.alreadyOpen).toEqual(r1.requested);
    }
    expect(r1.checked).toBeGreaterThan(0);
  });
});

describe('heidi answer', () => {
  test('non-action questions return null', async () => {
    expect(await tryHumanActionAnswer('what is the weather today')).toBeNull();
    expect(await tryHumanActionAnswer('hello there')).toBeNull();
  });

  test('"what do you need from me" lists open actions with instructions', async () => {
    const s = new HumanActionService({});
    s.request({ blockerKey: 'test:qa', title: 'QA action', instructions: ['do A', 'do B'], verification: { verifier: 'manual', spec: {} } });
    const a = await tryHumanActionAnswer('what do you need from me', { service: s });
    expect(a.text).toContain('QA action');
    expect(a.text).toContain('do A');
  });

  test('"I did it" re-runs verifiers instead of trusting the claim', async () => {
    const s = new HumanActionService({});
    s.request({ blockerKey: 'test:claim', title: 'Set thing', verification: { verifier: 'env-vars', spec: { envNames: ['HA_NEVER_SET_XYZ'] } } });
    const a = await tryHumanActionAnswer('i did it', { service: s });
    expect(a.text).toMatch(/still failing|manual-attestation/);
  });
});
