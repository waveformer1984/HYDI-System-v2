'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { signWorkerToken, verifyWorkerToken, consumeWorkerToken, verifySignature } = require('../../lib/distributed-cloud/auth');
const { DistributedCloudControlPlane } = require('../../lib/distributed-cloud/control-plane');

const ENV = { HYDI_DISTRIBUTED_WORKER_SECRET: 'c'.repeat(32) };

describe('distributed cloud HMAC hardening', () => {
  test('valid token accepted once', () => {
    const token = signWorkerToken('w1', ENV);
    const state = { auth_replay_used: {} };
    const v = consumeWorkerToken(state, token, ENV);
    expect(v.ok).toBe(true);
    expect(v.classification).toBe('auth_ok');
  });

  test('replayed token rejected', () => {
    const token = signWorkerToken('w1', ENV);
    const state = { auth_replay_used: {} };
    expect(consumeWorkerToken(state, token, ENV).ok).toBe(true);
    const again = verifyWorkerToken(token, ENV, state);
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('replay');
    expect(again.classification).toBe('auth_replay');
  });

  test('expired token rejected', () => {
    const oldTs = Math.floor(Date.now() / 1000) - 500;
    const jti = crypto.randomBytes(8).toString('hex');
    const payload = `w1:${oldTs}:${jti}`;
    const sig = crypto.createHmac('sha256', ENV.HYDI_DISTRIBUTED_WORKER_SECRET).update(payload).digest('hex');
    const v = verifyWorkerToken(`v2:${payload}:${sig}`, ENV);
    expect(v.ok).toBe(false);
    expect(v.classification).toBe('auth_expired');
  });

  test('modified payload rejected', () => {
    const token = signWorkerToken('w1', ENV);
    const tampered = token.slice(0, -4) + 'ffff';
    const v = verifyWorkerToken(tampered, ENV);
    expect(v.ok).toBe(false);
    expect(v.classification).toBe('auth_bad_signature');
  });

  test('secret rotation accepts previous key', () => {
    const oldSecret = 'd'.repeat(32);
    const payload = 'w1:123:abc';
    const sig = crypto.createHmac('sha256', oldSecret).update(payload).digest('hex');
    const v = verifySignature(payload, sig, {
      HYDI_DISTRIBUTED_WORKER_SECRET: 'e'.repeat(32),
      HYDI_DISTRIBUTED_WORKER_SECRET_PREVIOUS: oldSecret,
    });
    expect(v.ok).toBe(true);
    expect(v.key).toBe('previous');
  });

  test('concurrent register with same token — only one succeeds', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-replay-'));
    const cp = new DistributedCloudControlPlane({ dir });
    const token = signWorkerToken('w-double', ENV);
    const a = cp.registerWorkerAuth(token, { worker_id: 'w-double', resources: {} }, ENV);
    const b = cp.registerWorkerAuth(token, { worker_id: 'w-double', resources: {} }, ENV);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    expect(b.classification).toBe('auth_replay');
  });
});