import fs from 'fs';
import { execFileSync } from 'child_process';

interface LockMetadata {
  cwd: string;
  commit: string | null;
}

interface ProcessInfo {
  commandLine: string;
  /** Process creation time in ms since epoch — guards PID reuse. */
  creationDateMs: number | null;
}

interface LockDeps {
  pid?: number;
  isAlive?: (pid: number) => boolean;
  commandLine?: (pid: number) => string | null;
  processInfo?: (pid: number) => ProcessInfo | null;
  log?: (message: string) => void;
  error?: (message: string) => void;
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null &&
    'code' in error && (error as { code: string }).code === code;
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return isNodeError(error, 'EPERM');
  }
}

export function readProcessCommandLine(pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === 'win32') {
      return execFileSync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`,
      ], { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim() || null;
    }
    const procPath = `/proc/${pid}/cmdline`;
    if (fs.existsSync(procPath)) {
      return fs.readFileSync(procPath).toString('utf8').replace(/\0/g, ' ').trim() || null;
    }
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      timeout: 2000,
    }).trim() || null;
  } catch {
    return null;
  }
}

export function readProcessInfo(pid: number): ProcessInfo | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}") | Select-Object CommandLine,CreationDate | ConvertTo-Json -Compress`,
      ], { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim();
      if (!out) return null;
      const info = JSON.parse(out) as { CommandLine?: string; CreationDate?: string };
      if (!info.CommandLine) return null;
      let creationDateMs: number | null = null;
      if (info.CreationDate) {
        // CIM serializes as "/Date(1762200551000)/" or ISO — handle both.
        const m = /Date\((\d+)\)/.exec(info.CreationDate);
        creationDateMs = m ? Number(m[1]) : (Date.parse(info.CreationDate) || null);
      }
      return { commandLine: info.CommandLine, creationDateMs };
    }
    const cmdline = readProcessCommandLine(pid);
    return cmdline ? { commandLine: cmdline, creationDateMs: null } : null;
  } catch {
    return null;
  }
}

export function isHeidiDaemonCommand(commandLine: string): boolean {
  return /(?:^|[\\/])heidi-daemon(?:-launcher\.js|\.ts)(?=["'\s]|$)/i.test(commandLine);
}

export type OwnerClass = 'daemon' | 'unrelated' | 'unknown';

const FORK_CMD_RE = /ProcessContainerFork\.js/i;
/** hydi-daemon's PM2 `script args` — unique in ecosystem.config.js, so its
 *  presence in a fork cmdline is real app identity (not just timing). */
const DAEMON_ARGS_RE = /--no-stabilization/i;
const FORK_TIME_TOLERANCE_MS = 60_000;

/**
 * Classify a live lock-owner candidate. A ProcessContainerFork cmdline is
 * only app-identifying through the app's script args — timestamp proximity
 * alone is not ownership.
 */
export function classifyDaemonOwner(commandLine: string, lockStartedAtMs: number | null, creationDateMs: number | null): OwnerClass {
  if (isHeidiDaemonCommand(commandLine)) return 'daemon';
  if (!FORK_CMD_RE.test(commandLine)) return 'unrelated';
  if (DAEMON_ARGS_RE.test(commandLine)) {
    // Right signature — corroborate with creation time when both stamps exist.
    if (creationDateMs === null || lockStartedAtMs === null) return 'daemon';
    return Math.abs(creationDateMs - lockStartedAtMs) <= FORK_TIME_TOLERANCE_MS ? 'daemon' : 'unknown';
  }
  // A fork WITHOUT the daemon's args: it's a different PM2 app — or we can't
  // tell. Nonempty non-daemon args identify a sibling app; empty is ambiguous.
  const args = commandLine.split(/ProcessContainerFork\.js/i)[1]?.trim() ?? '';
  return args.length > 0 ? 'unrelated' : 'unknown';
}

export function acquireHeidiDaemonLock(
  lockFile: string,
  metadata: LockMetadata,
  deps: LockDeps = {},
): boolean {
  const pid = deps.pid ?? process.pid;
  const alive = deps.isAlive ?? isProcessAlive;
  const processInfo = deps.processInfo ?? readProcessInfo;
  const commandLine = deps.commandLine ?? ((p: number) => processInfo(p)?.commandLine ?? null);
  const log = deps.log ?? ((message: string) => console.log(message));
  const error = deps.error ?? ((message: string) => console.error(message));
  const lockData = JSON.stringify({ pid, startedAt: new Date().toISOString(), ...metadata });

  const create = (): boolean => {
    try {
      fs.writeFileSync(lockFile, lockData, { flag: 'wx' });
      return true;
    } catch (createError: unknown) {
      if (isNodeError(createError, 'EEXIST')) {
        error('[daemon] Lock acquired by another process during stale cleanup');
      } else {
        error(`[daemon] Lock retry failed: ${createError instanceof Error ? createError.message : 'unknown'}`);
      }
      return false;
    }
  };

  try {
    fs.writeFileSync(lockFile, lockData, { flag: 'wx' });
    return true;
  } catch (createError: unknown) {
    if (!isNodeError(createError, 'EEXIST')) {
      error(`[daemon] Lock acquisition failed: ${createError instanceof Error ? createError.message : 'unknown'}`);
      return false;
    }
  }

  try {
    const content = fs.readFileSync(lockFile, 'utf8').trim();
    if (!content) {
      log('[daemon] Empty daemon lock is stale, removing');
    } else {
      const lockInfo = JSON.parse(content) as { pid?: number; startedAt?: string };
      const ownerPid = Number(lockInfo.pid);
      const lockStartedAtMs = lockInfo.startedAt ? Date.parse(lockInfo.startedAt) || null : null;
      if (alive(ownerPid)) {
        const info = processInfo(ownerPid);
        const ownerCommand = info?.commandLine ?? commandLine(ownerPid);
        if (ownerCommand === null) {
          error(`[daemon] Cannot verify live lock owner PID ${ownerPid}; refusing to start`);
          return false;
        }
        const cls = classifyDaemonOwner(ownerCommand, lockStartedAtMs, info?.creationDateMs ?? null);
        if (cls === 'daemon') {
          error(`[daemon] Another daemon is already running (PID: ${ownerPid})`);
          return false;
        }
        if (cls === 'unknown') {
          error(`[daemon] Lock owner PID ${ownerPid} is ambiguous — preserving lock and refusing to start (manual reconciliation)`);
          return false;
        }
        log(`[daemon] Stale lock from PID ${ownerPid} (process is not hydi-daemon), removing`);
      } else {
        log(`[daemon] Stale lock from PID ${ownerPid} (process is not alive), removing`);
      }
    }
    fs.unlinkSync(lockFile);
    return create();
  } catch {
    try {
      fs.unlinkSync(lockFile);
      log('[daemon] Corrupt daemon lock is stale, removing');
    } catch {
      error('[daemon] Cannot remove corrupt lock file');
      return false;
    }
    return create();
  }
}

export function releaseHeidiDaemonLock(lockFile: string, pid = process.pid): void {
  try {
    const content = fs.readFileSync(lockFile, 'utf8').trim();
    if (content && (JSON.parse(content) as { pid?: number }).pid !== pid) return;
    fs.unlinkSync(lockFile);
  } catch {
    // Already gone or unreadable; shutdown remains best effort.
  }
}
