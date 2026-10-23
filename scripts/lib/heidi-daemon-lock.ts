import fs from 'fs';
import { execFileSync } from 'child_process';

interface LockMetadata {
  cwd: string;
  commit: string | null;
}

interface LockDeps {
  pid?: number;
  isAlive?: (pid: number) => boolean;
  commandLine?: (pid: number) => string | null;
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
      ], { encoding: 'utf8', timeout: 2000, windowsHide: true }).trim() || null;
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

export function isHeidiDaemonCommand(commandLine: string): boolean {
  return /(?:^|[\\/])heidi-daemon(?:-launcher\.js|\.ts)(?=["'\s]|$)/i.test(commandLine);
}

export function acquireHeidiDaemonLock(
  lockFile: string,
  metadata: LockMetadata,
  deps: LockDeps = {},
): boolean {
  const pid = deps.pid ?? process.pid;
  const alive = deps.isAlive ?? isProcessAlive;
  const commandLine = deps.commandLine ?? readProcessCommandLine;
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
      const lockInfo = JSON.parse(content) as { pid?: number };
      const ownerPid = Number(lockInfo.pid);
      if (alive(ownerPid)) {
        const ownerCommand = commandLine(ownerPid);
        if (ownerCommand === null) {
          error(`[daemon] Cannot verify live lock owner PID ${ownerPid}; refusing to start`);
          return false;
        }
        if (isHeidiDaemonCommand(ownerCommand)) {
          error(`[daemon] Another daemon is already running (PID: ${ownerPid})`);
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
