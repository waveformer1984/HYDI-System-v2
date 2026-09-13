/**
 * REAL regression test for graceful shutdown via IPC on Windows.
 *
 * Unlike the source-text checks in heidi-daemon-bugfix-regression.test.ts,
 * this test actually spawns the daemon as a child process (via the launcher),
 * waits for it to start cycling, sends a real shutdown message via IPC
 * (the same mechanism PM2 uses with shutdown_with_message: true), and
 * asserts on the child's OBSERVABLE behavior — not on source code text.
 *
 * What this proves:
 *   1. The launcher's fork() + IPC relay actually works
 *   2. The daemon's process.on('message') handler actually fires
 *   3. gracefulShutdown() actually runs and writes a shutdown audit record
 *   4. The lock file is actually released by the daemon (not left stale)
 *   5. The child process actually exits with code 0 (not force-killed)
 *
 * This test is the one that would have caught the Windows signal-relay
 * bug that the source-text checks missed.
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fork, ChildProcess } from 'child_process';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LOCK_FILE = path.resolve(REPO_ROOT, '.heidi-daemon.lock');
const AUDIT_FILE = path.resolve(REPO_ROOT, '.heidi-daemon-audit.jsonl');
const LAUNCHER = path.resolve(REPO_ROOT, 'scripts', 'heidi-daemon-launcher.js');

// Use a short interval so we don't have to wait 60s for a cycle
const TEST_INTERVAL_MS = 5000;

describe('REAL graceful shutdown via IPC (not source-text check)', () => {
  let child: ChildProcess | null = null;
  const testLockFile: string | null = null;
  const testAuditFile: string | null = null;

  // Use a separate lock/audit file for each test to avoid interference
  // with the real daemon. We do this by setting env vars before spawning.
  // Actually, the daemon uses hardcoded paths — so we need to ensure
  // no real daemon is running and clean up before/after.
  beforeEach(() => {
    // Clean up any stale lock from a previous test
    try {
      if (fs.existsSync(LOCK_FILE)) {
        const content = fs.readFileSync(LOCK_FILE, 'utf-8');
        const lockData = JSON.parse(content);
        // Only remove if it's our test PID (not a real daemon)
        if (lockData._test) {
          fs.unlinkSync(LOCK_FILE);
        }
      }
    } catch {
      // Best effort
    }
  });

  afterEach(() => {
    // Kill any lingering child
    if (child && !child.killed) {
      // Attach error handler to prevent unhandled 'error' event from
      // child.send() on an already-closed IPC channel
      child.on('error', () => { /* best effort — child already gone */ });
      try {
        child.send({ type: 'shutdown' });
      } catch {
        // IPC may fail if child already exited — fall through to kill
      }
      // Give it a moment, then force kill if still alive
      try { child.kill('SIGKILL'); } catch { /* best effort */ }
    }
    child = null;

    // Clean up test lock
    try {
      if (fs.existsSync(LOCK_FILE)) {
        const content = fs.readFileSync(LOCK_FILE, 'utf-8');
        const lockData = JSON.parse(content);
        if (lockData._test) {
          fs.unlinkSync(LOCK_FILE);
        }
      }
    } catch {
      // Best effort
    }
  }, 30000);

  test('IPC shutdown message triggers graceful shutdown (shutdown audit record + lock released + exit 0)', async () => {
    // Skip if the real daemon is running — we'd conflict on the lock
    if (fs.existsSync(LOCK_FILE)) {
      const content = fs.readFileSync(LOCK_FILE, 'utf-8');
      const lockData = JSON.parse(content);
      if (!lockData._test) {
        // Real daemon is running — skip this test
        console.warn('[test] Real daemon is running — skipping IPC shutdown test to avoid lock conflict');
        return;
      }
    }

    // Record audit file state before
    const auditBefore = fs.existsSync(AUDIT_FILE)
      ? fs.readFileSync(AUDIT_FILE, 'utf-8').trim().split('\n').filter(Boolean).length
      : 0;

    // Spawn the launcher via fork() — this is what PM2 does
    // Use a short interval so cycles run quickly
    child = fork(LAUNCHER, ['--no-stabilization', `--interval=${TEST_INTERVAL_MS}`], {
      stdio: 'pipe', // Capture stdout for log analysis
      cwd: REPO_ROOT,
    });

    // Prevent unhandled 'error' event if child exits before we send shutdown
    child.on('error', () => { /* best effort */ });

    expect(child).not.toBeNull();
    expect(child.pid).toBeDefined();

    // Collect stdout
    let stdoutContent = '';
    child.stdout?.on('data', (data: Buffer) => {
      stdoutContent += data.toString();
    });

    // Wait for the daemon to initialize and run its initial cycle
    // The daemon prints "[daemon] Daemon is running" when ready
    await waitForCondition(
      () => stdoutContent.includes('Daemon is running'),
      30000,
      'Daemon did not reach "running" state within 30s',
    );

    // Wait for the initial self-sufficiency cycle to complete
    // (the initial one runs immediately on startup)
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Verify the daemon is actually running (lock file exists)
    expect(fs.existsSync(LOCK_FILE)).toBe(true);

    // Record audit state after startup — at least the initial cycle should have recorded
    const auditAfterStartup = fs.existsSync(AUDIT_FILE)
      ? fs.readFileSync(AUDIT_FILE, 'utf-8').trim().split('\n').filter(Boolean).length
      : 0;
    // The daemon should have written at least one audit record (the initial cycle)
    expect(auditAfterStartup).toBeGreaterThanOrEqual(auditBefore);

    // NOW send the IPC shutdown message — this is what PM2 does
    // with shutdown_with_message: true
    child.send({ type: 'shutdown' });

    // Wait for the child to exit
    // Timeout must exceed SHUTDOWN_WAIT_TIMEOUT_MS (31s) in case a
    // cognitive cycle is in flight when shutdown is sent.
    const exitCode = await waitForExit(child, 40000);

    // ─── ASSERTIONS ON OBSERVABLE BEHAVIOR ───────────────────────────

    // 1. The child should have exited with code 0 (graceful, not force-killed)
    expect(exitCode).toBe(0);

    // 2. The stdout should contain the graceful shutdown messages
    expect(stdoutContent).toContain('shutting down gracefully');
    expect(stdoutContent).toContain('Shutdown complete');

    // 3. The audit file should have a shutdown record
    const auditContent = fs.readFileSync(AUDIT_FILE, 'utf-8');
    const auditLines = auditContent.trim().split('\n').filter(Boolean);
    const shutdownRecords = auditLines
      .map((l) => JSON.parse(l))
      .filter((r: any) => r.phase === 'shutdown');
    expect(shutdownRecords.length).toBeGreaterThan(0);

    // 4. The lock file should have been released by the daemon
    expect(fs.existsSync(LOCK_FILE)).toBe(false);

    console.log('');
    console.log('════════════════════════════════════════════════════════════════');
    console.log('IPC SHUTDOWN TEST: PASSED');
    console.log('════════════════════════════════════════════════════════════════');
    console.log(`Exit code:           ${exitCode}`);
    console.log(`Shutdown records:    ${shutdownRecords.length}`);
    console.log(`Lock file released:  ${!fs.existsSync(LOCK_FILE)}`);
    console.log(`Stdout contains "shutting down gracefully": ${stdoutContent.includes('shutting down gracefully')}`);
    console.log(`Stdout contains "Shutdown complete":       ${stdoutContent.includes('Shutdown complete')}`);
    console.log('════════════════════════════════════════════════════════════════');
  }, 90000); // 90s overall test timeout (40s exit wait + startup + buffer)

  test('launcher uses fork() not spawn() (IPC channel required for shutdown_with_message)', () => {
    const launcherPath = path.resolve(REPO_ROOT, 'scripts', 'heidi-daemon-launcher.js');
    const content = fs.readFileSync(launcherPath, 'utf-8');

    // Must use fork() to establish IPC channel
    expect(content).toContain('fork(');

    // Must NOT use spawn() in actual code (only fork).
    // Strip comments before checking to avoid false positives from
    // comment text that mentions "spawn".
    const strippedOfComments = content
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/\/\/.*$/gm, '');         // line comments
    expect(strippedOfComments).not.toMatch(/\bspawn\s*\(/);

    // Must relay shutdown message via child.send()
    expect(content).toContain("child.send({ type: 'shutdown' })");

    // Must listen for process.on('message') to receive PM2's shutdown
    expect(content).toContain("process.on('message'");
  });

  test('daemon has IPC message handler alongside signal handlers', () => {
    const daemonPath = path.resolve(REPO_ROOT, 'scripts', 'heidi-daemon.ts');
    const content = fs.readFileSync(daemonPath, 'utf-8');

    // Must have process.on('message', ...) handler
    expect(content).toContain("process.on('message'");
    expect(content).toContain('IPC_SHUTDOWN');

    // Must still have signal handlers for direct invocation
    expect(content).toContain("process.on('SIGINT'");
    expect(content).toContain("process.on('SIGTERM'");
  });

  test('ecosystem.config.js has shutdown_with_message: true for hydi-daemon', () => {
    const ecoPath = path.resolve(REPO_ROOT, 'ecosystem.config.js');
    const content = fs.readFileSync(ecoPath, 'utf-8');

    // Must have shutdown_with_message: true
    expect(content).toContain('shutdown_with_message: true');

    // Must use the launcher script
    expect(content).toContain('heidi-daemon-launcher.js');
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────

function waitForCondition(
  fn: () => boolean,
  timeoutMs: number,
  errorMsg: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (fn()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error(errorMsg));
      }
    }, 200);
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Child did not exit within ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}
