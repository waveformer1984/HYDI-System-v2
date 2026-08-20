/**
 * Regression tests for the three daemon/self-repair bugs:
 *
 * 1. Graceful shutdown must wait for in-flight self-sufficiency work
 * 2. repairHistory must be capped + dedup consecutive identical workarounds
 * 3. Lock acquisition must be atomic (no TOCTOU race)
 *
 * These tests specifically exercise the scenarios that the original
 * 2-minute endurance test was too short to catch.
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { SelfRepairEngine } from '../../lib/operational/SelfRepairEngine';
import { CapabilityHealthManager, createCredentialProbe } from '../../lib/operational/CapabilityHealthManager';

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeBlockedReport(capabilityId: string, classification: string = 'MISSING_EXTERNAL_CREDENTIAL'): any {
  return {
    capabilityId,
    description: `Test ${capabilityId}`,
    provider: 'external',
    dependencies: [],
    state: 'BLOCKED',
    evidence: `Blocked: ${capabilityId}`,
    lastSuccessfulVerification: null,
    lastFailure: new Date().toISOString(),
    failureClassification: classification,
    repairability: 'not_repairable',
    requiredAuthorization: 'R2',
    requiredCredentials: ['FAKE_KEY'],
    recoveryProcedure: 'Provide credentials',
    verificationProcedure: 'Check env',
    checkedAt: new Date().toISOString(),
  };
}

function makeSummary(reports: any[]): any {
  return {
    total: reports.length,
    ready: 0,
    degraded: 0,
    blocked: reports.filter((r) => r.state === 'BLOCKED').length,
    unavailable: reports.filter((r) => r.state === 'UNAVAILABLE').length,
    repairable: 0,
    humanRequired: 0,
    prohibited: 0,
    unknown: 0,
    reports,
  };
}

// ─── Bug 2: repairHistory cap + dedup ────────────────────────────────────

describe('Bug 2: repairHistory bounding and workaround dedup', () => {
  test('2a. repairHistory is capped to maxHistoryEntries', async () => {
    // Use a small cap to make the test fast
    const sre = new SelfRepairEngine({ maxHistoryEntries: 10 });
    const report = makeBlockedReport('commercial.stripe');
    const summary = makeSummary([report]);

    // Run many cycles — without the cap, this would produce 100+ entries
    for (let i = 0; i < 100; i++) {
      await sre.runSelfRepair(summary);
    }

    const history = sre.getHistory();
    expect(history.length).toBeLessThanOrEqual(10);
  });

  test('2b. consecutive identical workarounds are deduped (not re-recorded every cycle)', async () => {
    const sre = new SelfRepairEngine({ maxHistoryEntries: 1000 });
    const report = makeBlockedReport('commercial.stripe');
    const summary = makeSummary([report]);

    // Run 50 cycles with the same blocked capability
    for (let i = 0; i < 50; i++) {
      await sre.runSelfRepair(summary);
    }

    const history = sre.getHistory();

    // Without dedup, this would be 50+ entries for the same workaround.
    // With dedup, there should be exactly 1 entry for the Stripe workaround
    // (its timestamp gets updated, not duplicated).
    const stripeWorkarounds = history.filter(
      (h) => h.capabilityId === 'commercial.stripe' && h.plannedAction.startsWith('WORK_AROUND'),
    );
    expect(stripeWorkarounds.length).toBe(1);
  });

  test('2c. different blocked capabilities each get their own workaround entry', async () => {
    const sre = new SelfRepairEngine({ maxHistoryEntries: 1000 });
    const summary = makeSummary([
      makeBlockedReport('commercial.stripe'),
      makeBlockedReport('commercial.email'),
      makeBlockedReport('commercial.sms'),
    ]);

    await sre.runSelfRepair(summary);

    const history = sre.getHistory();
    const workaroundCapabilities = new Set(
      history
        .filter((h) => h.plannedAction.startsWith('WORK_AROUND'))
        .map((h) => h.capabilityId),
    );
    expect(workaroundCapabilities.size).toBe(3);
    expect(workaroundCapabilities.has('commercial.stripe')).toBe(true);
    expect(workaroundCapabilities.has('commercial.email')).toBe(true);
    expect(workaroundCapabilities.has('commercial.sms')).toBe(true);
  });

  test('2d. actual repairs are always recorded (not deduped)', async () => {
    const sre = new SelfRepairEngine({ maxHistoryEntries: 1000 });

    // Register a repair handler that always succeeds
    sre.registerRepairHandler('system.database', async () => ({
      success: true,
      evidence: 'Repaired',
    }));

    // Create an UNAVAILABLE report with INFRASTRUCTURE_RUNTIME_PROBLEM
    // so the blocker engine classifies it as auto-repairable
    const report = {
      capabilityId: 'system.database',
      description: 'Database',
      provider: 'postgres',
      dependencies: [],
      state: 'UNAVAILABLE',
      evidence: 'DB down',
      lastSuccessfulVerification: null,
      lastFailure: new Date().toISOString(),
      failureClassification: 'INFRASTRUCTURE_RUNTIME_PROBLEM',
      repairability: 'auto_repairable',
      requiredAuthorization: 'R1',
      requiredCredentials: [],
      recoveryProcedure: 'Restart database',
      verificationProcedure: 'Check connection',
      checkedAt: new Date().toISOString(),
    };

    const summary = makeSummary([report]);

    // Run 5 cycles — each should record the actual repair
    for (let i = 0; i < 5; i++) {
      await sre.runSelfRepair(summary);
    }

    const history = sre.getHistory();
    const dbRepairs = history.filter(
      (h) => h.capabilityId === 'system.database' && h.executed === true,
    );
    // Actual repairs should NOT be deduped — each one is recorded
    expect(dbRepairs.length).toBe(5);
  });

  test('2e. workaround timestamp is updated (not duplicated) on consecutive cycles', async () => {
    const sre = new SelfRepairEngine({ maxHistoryEntries: 1000 });
    const report = makeBlockedReport('commercial.stripe');
    const summary = makeSummary([report]);

    // First cycle
    await sre.runSelfRepair(summary);
    const historyAfter1 = sre.getHistory();
    const firstTimestamp = historyAfter1.find(
      (h) => h.capabilityId === 'commercial.stripe',
    )?.timestamp;

    // Wait a moment so the timestamp will differ
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Second cycle
    await sre.runSelfRepair(summary);
    const historyAfter2 = sre.getHistory();
    const secondTimestamp = historyAfter2.find(
      (h) => h.capabilityId === 'commercial.stripe',
    )?.timestamp;

    // Should still be only 1 entry, but with updated timestamp
    const stripeEntries = historyAfter2.filter((h) => h.capabilityId === 'commercial.stripe');
    expect(stripeEntries.length).toBe(1);
    expect(secondTimestamp).not.toBe(firstTimestamp);
  });

  test('2f. 1000 cycles against persistently-blocked Stripe does not exceed cap', async () => {
    // This is the test that would catch the original leak.
    // At 60s intervals, 1000 cycles = ~16.7 hours of daemon runtime.
    // Without the fix, this would produce 1000+ entries for Stripe alone.
    const sre = new SelfRepairEngine({ maxHistoryEntries: 500 });
    const report = makeBlockedReport('commercial.stripe');
    const summary = makeSummary([report]);

    for (let i = 0; i < 1000; i++) {
      await sre.runSelfRepair(summary);
    }

    const history = sre.getHistory();
    expect(history.length).toBeLessThanOrEqual(500);

    // And there should be exactly 1 Stripe workaround entry
    const stripeEntries = history.filter((h) => h.capabilityId === 'commercial.stripe');
    expect(stripeEntries.length).toBe(1);
  }, 30000);
});

// ─── Bug 3: Lock TOCTOU race ─────────────────────────────────────────────

describe('Bug 3: Lock acquisition atomicity', () => {
  const testLockPath = path.resolve(__dirname, '../../.heidi-daemon-test.lock');

  afterEach(() => {
    try {
      if (fs.existsSync(testLockPath)) {
        fs.unlinkSync(testLockPath);
      }
    } catch {
      // Best effort
    }
  });

  test('3a. atomic exclusive create with flag:wx succeeds when no lock exists', () => {
    const lockData = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
    // This is the exact pattern the daemon uses
    fs.writeFileSync(testLockPath, lockData, { flag: 'wx' });
    expect(fs.existsSync(testLockPath)).toBe(true);
    const content = fs.readFileSync(testLockPath, 'utf-8');
    expect(JSON.parse(content).pid).toBe(process.pid);
  });

  test('3b. atomic exclusive create fails with EEXIST when lock already exists', () => {
    // Pre-create the lock
    fs.writeFileSync(testLockPath, JSON.stringify({ pid: 99999, startedAt: new Date().toISOString() }));

    // Attempting another exclusive create should fail with EEXIST
    let caughtError: unknown = null;
    try {
      fs.writeFileSync(testLockPath, 'test', { flag: 'wx' });
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).not.toBeNull();
    // On all platforms, the error should have code EEXIST
    expect(caughtError).toHaveProperty('code', 'EEXIST');
  });

  test('3c. daemon script uses flag:wx (not check-then-write)', () => {
    const daemonPath = path.resolve(__dirname, '../../scripts/heidi-daemon.ts');
    const content = fs.readFileSync(daemonPath, 'utf-8');

    // The acquireLock function must use flag: 'wx'
    expect(content).toContain("flag: 'wx'");

    // It must NOT use the old check-then-write pattern
    // (existsSync followed by writeFileSync without flag)
    const acquireLockSection = content.substring(
      content.indexOf('function acquireLock'),
      content.indexOf('function isNodeError'),
    );
    // The old pattern was: if (fs.existsSync(LOCK_FILE)) { ... } fs.writeFileSync(LOCK_FILE, ...)
    // The new pattern uses try/catch with flag: 'wx'
    expect(acquireLockSection).toContain("flag: 'wx'");
    expect(acquireLockSection).toContain('EEXIST');
  });
});

// ─── Bug 1: Graceful shutdown waits for in-flight work ───────────────────

describe('Bug 1: Graceful shutdown waits for in-flight work', () => {
  test('1a. daemon script tracks ssfInFlight flag', () => {
    const daemonPath = path.resolve(__dirname, '../../scripts/heidi-daemon.ts');
    const content = fs.readFileSync(daemonPath, 'utf-8');

    // The daemon must track the self-sufficiency in-flight flag
    expect(content).toContain('ssfInFlight');

    // The flag must be set to true before the self-sufficiency cycle
    expect(content).toContain('ssfInFlight = true');

    // The flag must be cleared in a finally block
    expect(content).toContain('ssfInFlight = false');

    // The gracefulShutdown must check ssfInFlight
    const shutdownSection = content.substring(
      content.indexOf('async function gracefulShutdown'),
      content.indexOf('process.on(\'SIGINT\''),
    );
    expect(shutdownSection).toContain('ssfInFlight');
    expect(shutdownSection).toContain('cycleInFlight');
    expect(shutdownSection).toContain('SHUTDOWN_WAIT_TIMEOUT_MS');
  });

  test('1b. daemon script has bounded shutdown wait timeout', () => {
    const daemonPath = path.resolve(__dirname, '../../scripts/heidi-daemon.ts');
    const content = fs.readFileSync(daemonPath, 'utf-8');

    // Must have a bounded timeout (not wait forever)
    expect(content).toContain('SHUTDOWN_WAIT_TIMEOUT_MS');
    // Must be less than PM2's kill_timeout (50000ms) so PM2 doesn't
    // force-kill before the daemon finishes waiting + cleanup.
    // Must be >= 30000 (cognitive cycle timeout) so the daemon waits
    // for the cycle timeout to fire and set cycleInFlight=false.
    const match = content.match(/SHUTDOWN_WAIT_TIMEOUT_MS\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    const timeout = parseInt(match![1], 10);
    expect(timeout).toBeLessThan(50000);
    expect(timeout).toBeGreaterThanOrEqual(30000);
  });

  test('1c. daemon script clears ssfInFlight in finally block (not just on success)', () => {
    const daemonPath = path.resolve(__dirname, '../../scripts/heidi-daemon.ts');
    const content = fs.readFileSync(daemonPath, 'utf-8');

    // The finally block must clear the flag so a failed cycle doesn't
    // leave ssfInFlight=true forever, which would block shutdown indefinitely
    const ssfSection = content.substring(
      content.indexOf('async function runSelfSufficiencyInterval'),
      content.indexOf('const ssfInterval'),
    );
    expect(ssfSection).toContain('finally');
    expect(ssfSection).toContain('ssfInFlight = false');
  });

  test('1d. daemon script has sleep helper for shutdown polling', () => {
    const daemonPath = path.resolve(__dirname, '../../scripts/heidi-daemon.ts');
    const content = fs.readFileSync(daemonPath, 'utf-8');

    expect(content).toContain('function sleep');
    expect(content).toContain('await sleep');
  });

  test('1e. SelfRepairEngine respects maxHistoryEntries constructor option', () => {
    const sre1 = new SelfRepairEngine({ maxHistoryEntries: 50 });
    const sre2 = new SelfRepairEngine({ maxHistoryEntries: 5000 });
    // Both should accept the option without error
    expect(sre1).toBeDefined();
    expect(sre2).toBeDefined();
  });
});

// ─── Audit file rotation ─────────────────────────────────────────────────

describe('Audit file rotation', () => {
  test('daemon script has audit file rotation logic', () => {
    const daemonPath = path.resolve(__dirname, '../../scripts/heidi-daemon.ts');
    const content = fs.readFileSync(daemonPath, 'utf-8');

    expect(content).toContain('rotateAuditFile');
    expect(content).toContain('AUDIT_FILE_MAX_BYTES');
    // Must check file size before appending
    expect(content).toContain('statSync');
  });

  test('daemon script has AUDIT_FILE_MAX_BYTES constant', () => {
    const daemonPath = path.resolve(__dirname, '../../scripts/heidi-daemon.ts');
    const content = fs.readFileSync(daemonPath, 'utf-8');

    const match = content.match(/AUDIT_FILE_MAX_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/);
    expect(match).not.toBeNull();
    const mb = parseInt(match![1], 10);
    expect(mb).toBeGreaterThan(0);
    expect(mb).toBeLessThanOrEqual(100); // Reasonable upper bound
  });
});

// ─── createStaleStateRepairHandler stub warning ──────────────────────────

describe('createStaleStateRepairHandler stub', () => {
  test('has explicit fabricated-success warning in source', () => {
    const enginePath = path.resolve(__dirname, '../../lib/operational/SelfRepairEngine.ts');
    const content = fs.readFileSync(enginePath, 'utf-8');

    // Must contain a warning that it's a fabricated-success stub
    expect(content).toContain('FABRICATED-SUCCESS');
    expect(content).toContain('Do NOT register');
  });
});
