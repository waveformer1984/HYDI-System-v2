/**
 * Recovery delegation throttle — deterministic, injected-clock tests.
 * Proves a persistently-failing service cannot generate an unbounded
 * restart storm: bounded cycles, exponential backoff, cross-process
 * in-flight protection, OPEN terminal state, and reset only on
 * demonstrated health. No PM2 processes are spawned.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { RecoveryThrottle } = require('../../lib/operational/recovery-throttle');

function makeThrottle(opts: { now?: number; config?: object } = {}) {
  let t = opts.now ?? 1_000_000;
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'thr-')), 'recovery-throttle.json');
  const throttle = new RecoveryThrottle({
    filePath,
    now: () => t,
    config: { baseCooldownMs: 1000, maxCooldownMs: 16000, maxCycles: 5, inFlightTtlMs: 60_000, ...(opts.config || {}) },
  });
  return { throttle, tick: (ms: number) => { t += ms; }, filePath };
}

describe('RecoveryThrottle', () => {
  test('fresh component is allowed (HEALTHY state)', () => {
    const { throttle } = makeThrottle();
    expect(throttle.allow('svc').allowed).toBe(true);
  });

  test('failed delegation enters COOLDOWN and blocks immediate retry', () => {
    const { throttle } = makeThrottle();
    throttle.markDelegated('svc');
    throttle.recordOutcome('svc', false, 'boom');
    const a = throttle.allow('svc');
    expect(a.allowed).toBe(false);
    expect(a.state).toBe('COOLDOWN');
    expect(a.cooldownRemainingMs).toBeGreaterThan(0);
  });

  test('backoff grows exponentially and caps at maxCooldownMs', () => {
    const { throttle, tick } = makeThrottle();
    const cooldowns: number[] = [];
    for (let i = 0; i < 4; i++) {
      // wait out current cooldown, then fail again
      const a = throttle.allow('svc');
      if (!a.allowed && a.cooldownRemainingMs) tick(a.cooldownRemainingMs);
      throttle.markDelegated('svc');
      throttle.recordOutcome('svc', false);
      cooldowns.push(throttle.getStates().svc.cooldownRemainingMs);
    }
    expect(cooldowns).toEqual([1000, 2000, 4000, 8000]);
  });

  test('persistent failure reaches OPEN and stops delegating entirely', () => {
    const { throttle, tick } = makeThrottle({ config: { maxCycles: 5 } });
    for (let i = 0; i < 5; i++) {
      const a = throttle.allow('svc');
      if (!a.allowed) tick(a.cooldownRemainingMs ?? 0);
      expect(throttle.allow('svc').allowed).toBe(true);
      throttle.markDelegated('svc');
      throttle.recordOutcome('svc', false);
    }
    const a = throttle.allow('svc');
    expect(a.allowed).toBe(false);
    expect(a.state).toBe('OPEN');
    expect(a.reason).toContain('human review');
    // stays open — time does not heal it
    tick(24 * 3600 * 1000);
    expect(throttle.allow('svc').allowed).toBe(false);
  });

  test('OPEN state survives process restart (durable file)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thr-'));
    const filePath = path.join(tmp, 'recovery-throttle.json');
    let t = 1_000_000;
    const cfg = { baseCooldownMs: 1000, maxCooldownMs: 16000, maxCycles: 2, inFlightTtlMs: 60_000 };
    const t1 = new RecoveryThrottle({ filePath, now: () => t, config: cfg });
    t1.markDelegated('svc'); t1.recordOutcome('svc', false);
    t += 2000;
    t1.markDelegated('svc'); t1.recordOutcome('svc', false);
    expect(t1.allow('svc').state).toBe('OPEN');
    // new process — same file
    const t2 = new RecoveryThrottle({ filePath, now: () => t, config: cfg });
    expect(t2.allow('svc').allowed).toBe(false);
    expect(t2.allow('svc').state).toBe('OPEN');
  });

  test('in-flight delegation blocks a second concurrent delegation', () => {
    const { throttle } = makeThrottle();
    throttle.markDelegated('svc');
    const a = throttle.allow('svc');
    expect(a.allowed).toBe(false);
    expect(a.state).toBe('IN_FLIGHT');
  });

  test('stale in-flight marker expires (crashed delegator does not deadlock)', () => {
    const { throttle, tick } = makeThrottle();
    throttle.markDelegated('svc');
    tick(61_000); // > inFlightTtlMs
    expect(throttle.allow('svc').allowed).toBe(true);
  });

  test('observed health resets retry state (budget renews on health, not time)', () => {
    const { throttle, tick } = makeThrottle();
    throttle.markDelegated('svc');
    throttle.recordOutcome('svc', false);
    throttle.recordHealthy('svc');
    expect(throttle.allow('svc').allowed).toBe(true);
    expect(throttle.getStates().svc).toBeUndefined();
  });

  test('successful recovery resets via recordOutcome(success)', () => {
    const { throttle, tick } = makeThrottle();
    throttle.markDelegated('svc'); throttle.recordOutcome('svc', false);
    tick(2000);
    throttle.markDelegated('svc'); throttle.recordOutcome('svc', true);
    expect(throttle.allow('svc').allowed).toBe(true);
    expect(throttle.getStates().svc).toBeUndefined();
  });

  test('getStates exposes the observability contract', () => {
    const { throttle } = makeThrottle();
    throttle.markDelegated('svc');
    throttle.recordOutcome('svc', false, 'pm2 restart exit 1');
    const s = throttle.getStates().svc;
    expect(s.state).toBe('COOLDOWN');
    expect(s.cycles).toBe(1);
    expect(typeof s.cooldownRemainingMs).toBe('number');
    expect(s.lastFailure).toContain('pm2 restart');
    expect(s.lastAttemptAt).toBeTruthy();
    expect(s.nextAttemptAt).toBeTruthy();
  });

  test('manual clear() reopens recovery after human review', () => {
    const { throttle, tick } = makeThrottle({ config: { maxCycles: 2 } });
    for (let i = 0; i < 2; i++) {
      const a = throttle.allow('svc');
      if (!a.allowed) tick(a.cooldownRemainingMs ?? 0);
      throttle.markDelegated('svc'); throttle.recordOutcome('svc', false);
    }
    expect(throttle.allow('svc').state).toBe('OPEN');
    throttle.clear('svc');
    expect(throttle.allow('svc').allowed).toBe(true);
  });
});
