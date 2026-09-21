/**
 * Recovery control contracts — two defects found during live verification
 * of the episode-expiry fix (2026-09-20):
 *
 * A) Audit ordering: OperationalIntelligence wired the state-model event
 *    forwarder (wireEventLog) AFTER constructing RecoveryBudgetManager.
 *    Restore-time expireEpisode() events therefore reached only the
 *    subprocess's in-memory event log — durable operational-events never
 *    saw them. The durable budget record survived; the audit event didn't.
 *
 * B) Delegate timeout: the watchdog delegated hydi-recover with a fixed
 *    120s exec timeout while protoforge-core's postcondition graceMs is
 *    300s. The delegate's subprocess was killed mid-postcondition even
 *    though the recovery had already succeeded. Contract: delegate timeout
 *    must exceed the component's max legitimate recovery duration
 *    (graceMs) plus a bounded margin — and stay bounded.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { RecoveryBudgetManager } from '../../lib/operational/RecoveryBudget';
import { DurableBudgetStore } from '../../lib/operational/DurableBudgetStore';
import { SystemStateModel } from '../../lib/operational/SystemStateModel';
import type { OperationalEvent } from '../../lib/operational/types';

const { delegateTimeoutMs } = require('../../scripts/delegate-timeout.js');

const ROOT = process.cwd();

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctl-contract-'));
}

describe('A — restore-time expiry audit ordering', () => {
  function buildWithExpiredEpisode(nowRef: { t: number }) {
    const dir = mkTmpDir();
    const store = new DurableBudgetStore(dir);
    // Seed an exhausted, already-expired episode (mirrors the live 4/3 state)
    const lastFailureAt = new Date(nowRef.t - 3700000).toISOString(); // >1h ago
    store.updateState('svc', { retryCount: 4, lastFailureAt });
    const model = new SystemStateModel();
    return { dir, store, model, filePath: path.join(dir, '.hydi-operational', 'recovery-budget.jsonl') };
  }

  it('restore-time expiry emits budget_episode_expired to a pre-wired forwarder — exactly once, with prior count', () => {
    const now = { t: Date.now() };
    const { store, model } = buildWithExpiredEpisode(now);
    const forwarded: OperationalEvent[] = [];
    model.setEventForwarder((e) => forwarded.push(e)); // wired BEFORE construction — the fixed order
    new RecoveryBudgetManager(model, { retryEpisodeMs: 3600000 }, store, () => now.t);
    const events = forwarded.filter((e) => e.type === 'budget_episode_expired');
    expect(events).toHaveLength(1);
    expect((events[0].detail as any).previousRetryCount).toBe(4);
    expect(store.getState('svc')!.retryCount).toBe(0);
  });

  it('budget reset stays append-only — the exhausted evidence record is preserved', () => {
    const now = { t: Date.now() };
    const { store, model, filePath } = buildWithExpiredEpisode(now);
    model.setEventForwarder(() => { });
    new RecoveryBudgetManager(model, { retryEpisodeMs: 3600000 }, store, () => now.t);
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const counts = lines.filter((r) => r.component === 'svc').map((r) => r.retryCount);
    expect(counts).toContain(4); // historical exhausted record still present
    expect(counts[counts.length - 1]).toBe(0); // reset appended, not rewritten
  });

  it('lazy expiry through canRecover still emits through the forwarder', () => {
    const now = { t: Date.now() };
    const model = new SystemStateModel();
    const forwarded: OperationalEvent[] = [];
    model.setEventForwarder((e) => forwarded.push(e));
    const mgr = new RecoveryBudgetManager(model, { retryEpisodeMs: 3600000, circuitBreakerThreshold: 100 }, undefined, () => now.t);
    for (let i = 0; i < 4; i++) mgr.recordAttempt('svc', 'inc', false);
    now.t += 3600001;
    expect(mgr.canRecover('svc', 'inc').allowed).toBe(true);
    expect(forwarded.filter((e) => e.type === 'budget_episode_expired')).toHaveLength(1);
  });

  it('manager constructed without a forwarder still expires safely (in-memory log only)', () => {
    const now = { t: Date.now() };
    const { store, model } = buildWithExpiredEpisode(now);
    const mgr = new RecoveryBudgetManager(model, { retryEpisodeMs: 3600000 }, store, () => now.t);
    expect(mgr.canRecover('svc', 'inc').allowed).toBe(true); // no throw, expiry still happened
    expect(model.getEventsByType('budget_episode_expired')).toHaveLength(1); // captured in-memory
  });

  it('structural guard — OI wires the event forwarder before constructing the budget manager', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/operational/OperationalIntelligence.ts'), 'utf8');
    const wireIdx = src.indexOf('this.wireEventLog()');
    const mgrIdx = src.indexOf('new RecoveryBudgetManager');
    expect(wireIdx).toBeGreaterThan(-1);
    expect(mgrIdx).toBeGreaterThan(-1);
    expect(wireIdx).toBeLessThan(mgrIdx);
    // and there must be exactly one memory construction + one wire (no duplicates)
    expect(src.split('new OperationalMemory').length - 1).toBe(1);
    expect(src.split('this.wireEventLog()').length - 1).toBe(1);
  });
});

describe('C — database recovery targets the probed layer', () => {
  // Live incident 2026-09-21: Kong (:54321) wedged while Postgres stayed
  // healthy. recoverDatabase() restarted supabase_db (the layer the probe
  // does NOT measure), so the :54321 probe kept failing → every protoforge
  // recovery was stuck in RECOVERY_DEPENDENCY_BLOCKED until Kong was
  // restarted manually. The remediation must target the gateway first.
  const src = fs.readFileSync(path.join(ROOT, 'lib/operational/RecoveryEngine.ts'), 'utf8');
  const fnStart = src.indexOf('private async recoverDatabase');
  const fnEnd = src.indexOf('private async', fnStart + 20);
  const fn = src.slice(fnStart, fnEnd > fnStart ? fnEnd : src.length);

  it('recoverDatabase exists and restarts the Kong gateway, not only Postgres', () => {
    expect(fnStart).toBeGreaterThan(-1);
    expect(fn).toContain('supabase_kong_HYDI-System-v2');
  });

  it('Kong restart is attempted before the Postgres container restart', () => {
    const kongIdx = fn.indexOf('supabase_kong_HYDI-System-v2');
    const dbIdx = fn.indexOf('supabase_db_HYDI-System-v2');
    expect(kongIdx).toBeGreaterThan(-1);
    expect(dbIdx).toBeGreaterThan(-1);
    expect(kongIdx).toBeLessThan(dbIdx);
  });

  it('Postgres restart is conditional on the gateway still failing (layered remediation)', () => {
    // db restart must be guarded by a probe re-check, not unconditional
    const dbIdx = fn.indexOf('supabase_db_HYDI-System-v2');
    const guardIdx = fn.lastIndexOf('kongProbeOk', dbIdx);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(dbIdx);
  });
});

describe('D — Kong gateway is a first-class observed component', () => {
  // Live incident 2026-09-21: Kong wedged (accepting TCP on :54321, never
  // completing HTTP) while docker inspect reported 'running'. The rest-probe
  // failure dissolved into supabase_db's multi-source 'any ok' rule — no
  // component owned the gateway, nothing delegated its restart, and
  // protoforge-core recovery deadlocked on the 'database' dependency.
  const wsrc = fs.readFileSync(path.join(ROOT, 'scripts/watchdog.js'), 'utf8');

  it('watchdog observes supabase_kong with a REST-probe health verdict', () => {
    expect(wsrc).toContain("name: 'supabase_kong'");
    expect(wsrc).toContain('supabase_kong_HYDI-System-v2');
    expect(wsrc).toContain('checkSupabaseServiceLevel');
  });

  it('the gateway verdict cannot be masked by container liveness', () => {
    // Within the kong block, docker-inspect must not be a voting source —
    // "running" is not "serving". Only the data-plane probe votes.
    const blockStart = wsrc.indexOf("name: 'supabase_kong'");
    expect(blockStart).toBeGreaterThan(-1);
    const block = wsrc.slice(Math.max(0, blockStart - 4000), blockStart);
    const kongSourcesIdx = block.indexOf('kongSources.push');
    const dockerPush = block.slice(kongSourcesIdx);
    expect(dockerPush).not.toContain("name: 'docker-inspect'");
    expect(dockerPush).toContain("name: 'rest-probe'");
  });

  it('probe-fail on the single voting source yields CONFIRMED_FAILURE + recovery authorized', () => {
    const { classifyObservation } = require('../../lib/operational/ObservationConfidence');
    const a = classifyObservation('supabase_kong', [{
      name: 'rest-probe', ok: false, value: 'Kong REST fail: timeout',
      isObserverFailure: false, checkedAt: new Date().toISOString(),
    }]);
    expect(a.classification).toBe('CONFIRMED_FAILURE');
    expect(a.recoveryAuthorized).toBe(true);
  });

  it('a wedged gateway (docker says running, probe fails) still authorizes recovery', () => {
    // This is the exact incident signature: probe fail is a target failure;
    // with docker excluded from voting, no ok-source exists to conflict.
    const { classifyObservation } = require('../../lib/operational/ObservationConfidence');
    const a = classifyObservation('supabase_kong', [{
      name: 'rest-probe', ok: false, value: 'ECONNRESET',
      isObserverFailure: false, checkedAt: new Date().toISOString(),
    }]);
    expect(a.recoveryAuthorized).toBe(true);
  });
});

describe('B — delegate timeout contract', () => {
  const bootConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'boot.config.json'), 'utf8'));

  it('timeout exceeds graceMs + margin for every endpoint in the real boot config', () => {
    for (const mod of bootConfig.modules) {
      if (!mod.enabled || !mod.health?.url) continue;
      const grace = mod.health.graceMs ?? bootConfig.defaultGraceMs;
      const t = delegateTimeoutMs({ graceMs: grace });
      expect(t).toBeGreaterThan(grace); // strictly exceeds max legitimate recovery duration
      expect(t).toBeLessThanOrEqual(600000); // bounded — a hung delegate still dies
    }
  });

  it('protoforge-core (the live failure case) now gets 300s grace + 60s margin', () => {
    expect(delegateTimeoutMs({ graceMs: 300000 })).toBe(360000);
  });

  it('unknown/zero-grace endpoint falls back to the historical 120s floor', () => {
    expect(delegateTimeoutMs({})).toBe(120000);
    expect(delegateTimeoutMs({ graceMs: 0 })).toBe(120000);
    expect(delegateTimeoutMs({ graceMs: 60000 })).toBe(120000); // 60k+60k=120k floor
  });

  it('a hung delegate is still bounded by the cap — timeout is never infinite', () => {
    expect(delegateTimeoutMs({ graceMs: 3600000 })).toBe(600000);
    expect(delegateTimeoutMs({ graceMs: 900000 }, { capMs: 300000 })).toBe(300000);
  });

  it('timeout is distinguishable from success: strictly greater than the postcondition window', () => {
    // A recovery that completes inside its graceMs always has margin left to
    // reach the delegate's final success/reporting path.
    const t = delegateTimeoutMs({ graceMs: 300000 });
    expect(t - 300000).toBe(60000); // exactly the margin remains after grace
  });

  it('health.graceMs nesting also resolves (endpoint shape used by watchdog)', () => {
    expect(delegateTimeoutMs({ health: { graceMs: 300000 } })).toBe(360000);
  });

  it('timeout derives from config — cannot silently diverge from the recovery contract', () => {
    // If graceMs changes in boot.config, the timeout follows (plus margin).
    const mod = bootConfig.modules.find((m: any) => m.id === 'protoforge-core');
    const t = delegateTimeoutMs({ graceMs: mod.health.graceMs });
    expect(t).toBe(mod.health.graceMs + 60000);
  });
});
