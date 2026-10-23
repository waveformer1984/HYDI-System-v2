import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  acquireHeidiDaemonLock,
  isHeidiDaemonCommand,
  releaseHeidiDaemonLock,
} from '../../scripts/lib/heidi-daemon-lock';
import { releaseDaemonOwnership } from '../../scripts/lib/daemon-ownership';

describe('hydi-daemon process ownership', () => {
  let dir: string;
  let lockFile: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-daemon-lock-'));
    lockFile = path.join(dir, '.heidi-daemon.lock');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('reclaims a lock whose PID is dead', () => {
    fs.writeFileSync(lockFile, JSON.stringify({ pid: 404404 }));
    const log = jest.fn();
    expect(acquireHeidiDaemonLock(lockFile, { cwd: dir, commit: 'test' }, {
      pid: 111,
      isAlive: () => false,
      commandLine: () => { throw new Error('dead PID command line must not be read'); },
      log,
    })).toBe(true);
    expect(JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid).toBe(111);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('process is not alive'));
  });

  test('reclaims a lock whose live PID belongs to an unrelated process', () => {
    fs.writeFileSync(lockFile, JSON.stringify({ pid: 222 }));
    const log = jest.fn();
    expect(acquireHeidiDaemonLock(lockFile, { cwd: dir, commit: 'test' }, {
      pid: 333,
      isAlive: () => true,
      commandLine: () => 'node unrelated-worker.js',
      log,
    })).toBe(true);
    expect(JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid).toBe(333);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('process is not hydi-daemon'));
  });

  test('refuses a lock held by a live hydi-daemon process', () => {
    fs.writeFileSync(lockFile, JSON.stringify({ pid: 444 }));
    const error = jest.fn();
    expect(acquireHeidiDaemonLock(lockFile, { cwd: dir, commit: 'test' }, {
      pid: 555,
      isAlive: () => true,
      commandLine: () => 'node C:\\HYDI-System-v2\\scripts\\heidi-daemon-launcher.js --no-stabilization',
      error,
    })).toBe(false);
    expect(JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid).toBe(444);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Another daemon is already running'));
  });

  test('recognizes direct launcher and TypeScript daemon command lines', () => {
    expect(isHeidiDaemonCommand('node C:\\repo\\scripts\\heidi-daemon-launcher.js')).toBe(true);
    expect(isHeidiDaemonCommand('/usr/bin/node /repo/scripts/heidi-daemon.ts --once')).toBe(true);
    expect(isHeidiDaemonCommand('node scripts/unrelated-daemon.ts')).toBe(false);
  });

  test('signal cleanup releases the DB lease before the lock', async () => {
    const daemonSource = fs.readFileSync(path.resolve(__dirname, '../../scripts/heidi-daemon.ts'), 'utf8');
    expect(daemonSource).toContain("process.on('SIGINT', () => gracefulShutdown('SIGINT'))");
    expect(daemonSource).toContain("process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))");
    expect(daemonSource.substring(
      daemonSource.indexOf('async function gracefulShutdown'),
      daemonSource.indexOf("process.on('SIGINT'"),
    )).toContain('await releaseOwnership()');

    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid }));
    const order: string[] = [];
    await releaseDaemonOwnership({
      releaseLease: async () => { order.push('lease'); },
      closeLeasePool: async () => { order.push('pool'); },
      releaseLock: () => {
        order.push('lock');
        releaseHeidiDaemonLock(lockFile);
      },
    });
    expect(order).toEqual(['lease', 'pool', 'lock']);
    expect(fs.existsSync(lockFile)).toBe(false);
  });

  test('a hung lease release is bounded and still releases the lock', async () => {
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid }));
    const warn = jest.fn();
    // No wall-clock assertion: if the bound is broken this await never
    // resolves and jest's own test timeout fails the run. The assertions
    // prove the *behavior* — the bounded-release path fired and cleanup
    // still proceeded.
    await releaseDaemonOwnership({
      releaseLease: () => new Promise(() => { /* deliberately never settles */ }),
      closeLeasePool: async () => undefined,
      releaseLock: () => releaseHeidiDaemonLock(lockFile),
      warn,
      leaseTimeoutMs: 20,
      poolTimeoutMs: 20,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('operator lease release timed out'));
    expect(fs.existsSync(lockFile)).toBe(false);
  });
});
