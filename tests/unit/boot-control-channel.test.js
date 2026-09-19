'use strict';

/**
 * scripts/boot-control.js — the restart control channel between RecoveryEngine
 * and the running boot-agent.
 *
 * Why this exists
 * ---------------
 * RecoveryEngine.restartProcess() spawns replacements with
 * `{ shell: true, detached: true }` + `child.unref()`. That is necessary for
 * the standalone `hydi:recover` CLI (an attached child would die when the CLI
 * exits), but it means the recovered process is not a child of boot-agent. It
 * therefore cannot be watched for `exit` by boot-agent, cannot be stopped by
 * the supervisor, and shows up with dead ancestry.
 *
 * Measured consequence (HYDI_BASELINE.json, 2026-09-18): protoforge-core and
 * heidi-web were both ORPHAN with DEAD ancestry; only heidi-mobile-chat, which
 * had never been recovered, remained owned.
 *
 * scripts/recovery-lease.js:22-34 already identified the real fix and deferred
 * it: "Full continuous re-supervision would require routing the actual spawn
 * through boot-agent itself." This channel is that routing. RecoveryEngine
 * keeps the policy decision; boot-agent performs the spawn, so ownership is
 * never severed.
 *
 * Pure filesystem, no network port (this system already has four port
 * collisions), no live processes touched by these tests.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

let TMP;
let control;

beforeEach(() => {
  jest.resetModules();
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-bootctl-'));
  process.env.BOOT_CONTROL_DIR = path.join(TMP, 'control');
  process.env.HYDI_BOOT_LEASE_PATH = path.join(TMP, '.hydi-boot.lock');
  process.env.HYDI_APPROVAL_SECRET = 'boot-control-test-secret';
  control = require('../../scripts/boot-control');
});

afterEach(() => {
  delete process.env.BOOT_CONTROL_DIR;
  delete process.env.HYDI_BOOT_LEASE_PATH;
  delete process.env.HYDI_APPROVAL_SECRET;
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* best effort */ }
});

describe('boot-control: request lifecycle', () => {
  test('T1: a restart request is durable and readable by another process', () => {
    const req = control.requestRestart('protoforge-core', {
      requestedBy: 'RecoveryEngine',
      reason: 'health check failed',
    });

    expect(req.id).toBeTruthy();
    expect(req.component).toBe('protoforge-core');

    // Simulate boot-agent: a *different* module instance reading from disk.
    jest.resetModules();
    const bootAgentView = require('../../scripts/boot-control');
    const pending = bootAgentView.pendingRequests();

    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(req.id);
    expect(pending[0].component).toBe('protoforge-core');
    expect(pending[0].requestedBy).toBe('RecoveryEngine');
  });

  test('T2: an acknowledged request reports the owning pid back to the requester', () => {
    const req = control.requestRestart('heidi-web', { requestedBy: 'RecoveryEngine' });
    control.ackRequest(req.id, { status: 'completed', pid: 4242, ownedBy: 'boot-agent' });

    const ack = control.readAck(req.id);
    expect(ack.status).toBe('completed');
    expect(ack.pid).toBe(4242);
    expect(ack.ownedBy).toBe('boot-agent');
  });

  test('T3: a failed restart is acknowledged as failed, not silently dropped', () => {
    const req = control.requestRestart('heidi-web', { requestedBy: 'RecoveryEngine' });
    control.ackRequest(req.id, { status: 'failed', error: 'port still held' });

    const ack = control.readAck(req.id);
    expect(ack.status).toBe('failed');
    expect(ack.error).toBe('port still held');
    // A failure must never read as success.
    expect(ack.status).not.toBe('completed');
  });

  test('T4: an unacknowledged request reads as null, never as success', () => {
    const req = control.requestRestart('protoforge-core', { requestedBy: 'RecoveryEngine' });
    expect(control.readAck(req.id)).toBeNull();
  });

  test('T5: acknowledged requests stop being pending', () => {
    const a = control.requestRestart('protoforge-core', { requestedBy: 'RecoveryEngine' });
    const b = control.requestRestart('heidi-web', { requestedBy: 'RecoveryEngine' });
    control.ackRequest(a.id, { status: 'completed', pid: 1 });

    const pending = control.pendingRequests();
    expect(pending.map((r) => r.id)).toEqual([b.id]);
  });

  test('T6: a stale request is not executed — boot-agent must not replay old orders', () => {
    const req = control.requestRestart('protoforge-core', { requestedBy: 'RecoveryEngine' });

    // Rewrite the request as if it had been sitting on disk for an hour.
    const file = path.join(process.env.BOOT_CONTROL_DIR, `${req.id}.request.json`);
    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    body.requestedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    fs.writeFileSync(file, JSON.stringify(body));

    expect(control.pendingRequests()).toHaveLength(0);
  });

  test('T7: a malformed request file is ignored rather than crashing the boot agent', () => {
    fs.mkdirSync(process.env.BOOT_CONTROL_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.BOOT_CONTROL_DIR, 'garbage.request.json'), '{not json');
    expect(() => control.pendingRequests()).not.toThrow();
    expect(control.pendingRequests()).toHaveLength(0);
  });
});

describe('boot-control: forgery resistance (red-team 2026-09-18)', () => {
  test('T14: an unsigned planted request is never acted on', () => {
    fs.mkdirSync(process.env.BOOT_CONTROL_DIR, { recursive: true });
    // A same-user attacker writes a restart order directly — no signature.
    fs.writeFileSync(
      path.join(process.env.BOOT_CONTROL_DIR, 'forged.request.json'),
      JSON.stringify({ id: 'forged', component: 'heidi-web', requestedAt: new Date().toISOString(), requestedBy: 'mallory' })
    );
    expect(control.pendingRequests()).toHaveLength(0);
  });

  test('T15: a request signed with the WRONG key is dropped', () => {
    const crypto = require('crypto');
    const forged = { id: 'f1', component: 'heidi-web', requestedAt: new Date().toISOString(), requestedBy: 'mallory' };
    const body = Object.keys({ id: forged.id, component: forged.component, requestedAt: forged.requestedAt, requestedBy: forged.requestedBy })
      .sort().map((k) => `${k}=${forged[k]}`).join('|');
    forged.signature = crypto.createHmac('sha256', 'attacker-key').update(body).digest('hex');
    fs.mkdirSync(process.env.BOOT_CONTROL_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.BOOT_CONTROL_DIR, 'f1.request.json'), JSON.stringify(forged));
    expect(control.pendingRequests()).toHaveLength(0);
  });

  test('T16: tampering with a signed request invalidates it', () => {
    const req = control.requestRestart('protoforge-core', { requestedBy: 'RecoveryEngine' });
    const file = path.join(process.env.BOOT_CONTROL_DIR, `${req.id}.request.json`);
    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    body.component = 'heidi-web'; // attacker re-targets a legit request
    fs.writeFileSync(file, JSON.stringify(body));
    expect(control.pendingRequests()).toHaveLength(0);
  });

  test('T17: a planted unsigned ack reads as no ack, never as success', async () => {
    const req = control.requestRestart('heidi-web', { requestedBy: 'RecoveryEngine' });
    fs.writeFileSync(
      path.join(process.env.BOOT_CONTROL_DIR, `${req.id}.ack.json`),
      JSON.stringify({ id: req.id, status: 'completed', pid: process.pid, ownedBy: 'boot-agent', acknowledgedAt: new Date().toISOString() })
    );
    expect(control.readAck(req.id)).toBeNull();
  });

  test('T18: requestRestart refuses to write an unverifiable order when no key is configured', () => {
    delete process.env.HYDI_APPROVAL_SECRET;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => control.requestRestart('heidi-web', { requestedBy: 'x' })).toThrow(/no signing key/i);
  });
});

describe('boot-control: boot authority liveness', () => {
  test('T8: no lease file -> boot authority is not available', () => {
    expect(control.isBootAuthorityAlive()).toBe(false);
  });

  test('T9: lease naming a dead pid -> boot authority is not available', () => {
    fs.writeFileSync(
      process.env.HYDI_BOOT_LEASE_PATH,
      // A pid that cannot be running. 0x7FFFFFFF is above any real Windows/Linux pid.
      JSON.stringify({ bootId: 'x', pid: 2147483647, startedAt: new Date().toISOString() })
    );
    expect(control.isBootAuthorityAlive()).toBe(false);
  });

  test('T10: lease naming this live process -> boot authority is available', () => {
    fs.writeFileSync(
      process.env.HYDI_BOOT_LEASE_PATH,
      JSON.stringify({ bootId: 'x', pid: process.pid, startedAt: new Date().toISOString() })
    );
    expect(control.isBootAuthorityAlive()).toBe(true);
  });

  test('T11: a corrupt lease file reads as not-available, not as available', () => {
    fs.writeFileSync(process.env.HYDI_BOOT_LEASE_PATH, 'not json at all');
    // UNKNOWN must never resolve to "yes, go ahead".
    expect(control.isBootAuthorityAlive()).toBe(false);
  });
});

describe('boot-control: waiting for completion', () => {
  test('T12: waitForAck resolves once the ack appears', async () => {
    const req = control.requestRestart('heidi-web', { requestedBy: 'RecoveryEngine' });
    setTimeout(() => control.ackRequest(req.id, { status: 'completed', pid: 99 }), 30);

    const ack = await control.waitForAck(req.id, { timeoutMs: 2000, pollMs: 10 });
    expect(ack.status).toBe('completed');
    expect(ack.pid).toBe(99);
  });

  test('T13: waitForAck times out rather than reporting a phantom success', async () => {
    const req = control.requestRestart('heidi-web', { requestedBy: 'RecoveryEngine' });
    const ack = await control.waitForAck(req.id, { timeoutMs: 80, pollMs: 10 });

    expect(ack.status).toBe('timeout');
    expect(ack.status).not.toBe('completed');
  });
});
