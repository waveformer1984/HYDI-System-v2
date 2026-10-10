/*
 * PID-file singleton lock — same contract as scripts/heidi-daemon.ts's
 * inline implementation, extracted so other standalone workers (e.g.
 * revenue-autopilot-tick) can refuse to double-run when spawned by two
 * supervisors (PM2 + boot-agent).
 *
 * Semantics: atomic 'wx' create; a lock whose recorded PID is dead is
 * treated as stale and reclaimed. Call releaseLock() on shutdown paths.
 */

import fs from 'fs';
import path from 'path';

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === code;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    // EPERM means the process exists but we can't signal it — still alive.
    return isNodeError(error, 'EPERM');
  }
}

export function acquireLock(lockFile: string, tag: string): boolean {
  const lockData = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), tag });

  try {
    fs.writeFileSync(lockFile, lockData, { flag: 'wx' });
    return true;
  } catch (error: unknown) {
    if (!isNodeError(error, 'EEXIST')) {
      console.error(`[${tag}] Lock acquisition failed: ${error instanceof Error ? error.message : 'unknown'}`);
      return false;
    }
  }

  try {
    const content = fs.readFileSync(lockFile, 'utf-8').trim();
    if (content) {
      const lockInfo = JSON.parse(content);
      if (lockInfo.pid && isProcessAlive(lockInfo.pid)) {
        console.error(`[${tag}] Another instance is already running (PID: ${lockInfo.pid})`);
        return false;
      }
    }
    // Empty or stale lock — reclaim
    fs.unlinkSync(lockFile);
    try {
      fs.writeFileSync(lockFile, lockData, { flag: 'wx' });
      return true;
    } catch (retryError: unknown) {
      if (!isNodeError(retryError, 'EEXIST')) {
        console.error(`[${tag}] Lock retry failed: ${retryError instanceof Error ? retryError.message : 'unknown'}`);
      }
      return false;
    }
  } catch {
    // Corrupt lock — remove and retry
    try { fs.unlinkSync(lockFile); } catch { /* ignore */ }
    try {
      fs.writeFileSync(lockFile, lockData, { flag: 'wx' });
      return true;
    } catch {
      return false;
    }
  }
}

export function releaseLock(lockFile: string): void {
  try {
    const content = fs.readFileSync(lockFile, 'utf-8').trim();
    if (content) {
      const lockInfo = JSON.parse(content);
      if (lockInfo.pid !== process.pid) return; // don't release someone else's lock
    }
    fs.unlinkSync(lockFile);
  } catch { /* already gone */ }
}

export function lockPathFor(name: string): string {
  return path.resolve(__dirname, '..', '..', `.${name}.lock`);
}
