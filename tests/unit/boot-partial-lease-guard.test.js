/**
 * Partial-boot lease guard.
 *
 * Incident this pins down (2026-09-10, reconstructed from PM2 + boot-agent logs):
 *
 *   a manual `node scripts/boot-agent.js --only=heidi-web`
 *     → claimed the canonical lease
 *     → the PM2-supervised runtime saw a newer bootId and stood down (exit 75)
 *     → ecosystem.config.js stop_exit_codes:[75] told PM2 not to respawn it
 *     → job-executor-poller and heidi-mobile-chat went down and stayed down
 *
 * Invariant: an invocation carrying --only or --skip is a PARTIAL boot. It must
 * never claim, replace or release the canonical lease, and it must refuse to
 * start at all while a canonical runtime holds one.
 *
 * These tests never touch the machine's real lease and never require PM2: the
 * CLI cases run boot-agent with HYDI_BOOT_LEASE_PATH pointed at a temp file and
 * --dry-run so nothing is spawned.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  BootInstanceLease,
  PARTIAL_BOOT_REFUSED_EXIT_CODE,
  SUPERSEDED_EXIT_CODE,
} = require('../../scripts/boot-instance-lease');

const ROOT = path.resolve(__dirname, '..', '..');
const BOOT_AGENT = path.join(ROOT, 'scripts', 'boot-agent.js');

let tmpDir;
let leasePath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-partial-'));
  leasePath = path.join(tmpDir, '.hydi-boot.lock');
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Write a lease naming a holder that is alive (this test process). */
function writeLiveLease(bootId = 'canonical-boot-id') {
  fs.writeFileSync(
    leasePath,
    JSON.stringify({ bootId, pid: process.pid, startedAt: new Date().toISOString(), ppid: 1 }),
    'utf8'
  );
  return fs.readFileSync(leasePath, 'utf8');
}

/** Write a lease naming a pid that is certainly not running. */
function writeStaleLease(bootId = 'stale-boot-id') {
  fs.writeFileSync(
    leasePath,
    JSON.stringify({ bootId, pid: 0x7ffffffe, startedAt: new Date().toISOString(), ppid: 1 }),
    'utf8'
  );
}

/** Run the real boot-agent CLI against the temp lease. --dry-run spawns nothing. */
function runBootAgent(args) {
  return spawnSync(process.execPath, [BOOT_AGENT, ...args, '--dry-run'], {
    cwd: ROOT,
    env: { ...process.env, HYDI_BOOT_LEASE_PATH: leasePath, NODE_ENV: 'test' },
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
  });
}

describe('BootInstanceLease.inspect() — is a canonical runtime holding the lease?', () => {
  it('reports inactive when no lease file exists', () => {
    const r = new BootInstanceLease({ lockPath: leasePath }).inspect();
    expect(r.active).toBe(false);
    expect(r.record).toBeNull();
    expect(r.reason).toMatch(/no lease file/i);
  });

  it('reports ACTIVE when the lease names a live pid', () => {
    writeLiveLease();
    const r = new BootInstanceLease({ lockPath: leasePath }).inspect();
    expect(r.active).toBe(true);
    expect(r.record.bootId).toBe('canonical-boot-id');
    expect(r.reason).toMatch(/held by live pid/);
  });

  it('reports inactive (stale) when the lease names a dead pid', () => {
    writeStaleLease();
    const r = new BootInstanceLease({ lockPath: leasePath }).inspect();
    expect(r.active).toBe(false);
    expect(r.reason).toMatch(/stale lease/i);
  });

  it('inspect() never mutates the lease', () => {
    const before = writeLiveLease();
    const lease = new BootInstanceLease({ lockPath: leasePath });
    lease.inspect();
    lease.inspect();
    expect(fs.readFileSync(leasePath, 'utf8')).toBe(before);
  });

  it('liveness is injectable, so the rule can be tested without real processes', () => {
    writeLiveLease();
    const dead = new BootInstanceLease({ lockPath: leasePath, isAlive: () => false });
    const alive = new BootInstanceLease({ lockPath: leasePath, isAlive: () => true });
    expect(dead.inspect().active).toBe(false);
    expect(alive.inspect().active).toBe(true);
  });
});

describe('canonical boot claims the lease', () => {
  it('a boot with no --only/--skip claims it', () => {
    const res = runBootAgent([]);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/boot lease claimed/);
    expect(fs.existsSync(leasePath)).toBe(true);
    const rec = JSON.parse(fs.readFileSync(leasePath, 'utf8'));
    expect(typeof rec.bootId).toBe('string');
    expect(rec.bootId.length).toBeGreaterThan(0);
  });
});

describe('--only cannot claim the canonical lease', () => {
  it('refuses when a canonical lease is active', () => {
    const before = writeLiveLease();
    const res = runBootAgent(['--only=heidi-web']);

    expect(res.status).toBe(PARTIAL_BOOT_REFUSED_EXIT_CODE);
    expect(res.stderr).toMatch(/Refusing partial boot \(--only=heidi-web\)/);
    expect(res.stderr).toMatch(/already holds the boot lease/);
    // The canonical lease must be untouched, byte for byte.
    expect(fs.readFileSync(leasePath, 'utf8')).toBe(before);
  });

  it('does not claim the lease even when none is held', () => {
    expect(fs.existsSync(leasePath)).toBe(false);
    const res = runBootAgent(['--only=heidi-web']);

    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/NOT claiming the canonical lease/);
    // The decisive assertion: a partial boot leaves no lease behind, so it can
    // never be mistaken for the canonical runtime.
    expect(fs.existsSync(leasePath)).toBe(false);
    expect(res.stdout).not.toMatch(/boot lease claimed/);
  });

  it('never emits the supersession path that stands the canonical runtime down', () => {
    writeLiveLease();
    const res = runBootAgent(['--only=heidi-web']);
    expect(res.stdout).not.toMatch(/superseding previous boot runtime/);
    expect(res.stdout).not.toMatch(/standing down/);
    expect(res.status).not.toBe(SUPERSEDED_EXIT_CODE);
  });
});

describe('--skip cannot claim the canonical lease', () => {
  it('refuses when a canonical lease is active', () => {
    const before = writeLiveLease();
    const res = runBootAgent(['--skip=job-executor-poller']);

    expect(res.status).toBe(PARTIAL_BOOT_REFUSED_EXIT_CODE);
    expect(res.stderr).toMatch(/Refusing partial boot \(--skip=job-executor-poller\)/);
    expect(fs.readFileSync(leasePath, 'utf8')).toBe(before);
  });

  it('does not claim the lease even when none is held', () => {
    const res = runBootAgent(['--skip=job-executor-poller']);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/NOT claiming the canonical lease/);
    expect(fs.existsSync(leasePath)).toBe(false);
  });
});

describe('a partial boot cannot release someone else\'s lease', () => {
  it('a stale lease is left in place rather than deleted by a partial boot', () => {
    writeStaleLease();
    const before = fs.readFileSync(leasePath, 'utf8');
    const res = runBootAgent(['--only=heidi-web']);

    expect(res.status).toBe(0); // stale lease does not block
    expect(fs.existsSync(leasePath)).toBe(true);
    expect(fs.readFileSync(leasePath, 'utf8')).toBe(before);
  });

  it('release() is a no-op for an instance that never claimed', () => {
    const before = writeLiveLease();
    const partial = new BootInstanceLease({ lockPath: leasePath });
    expect(partial.bootId).toBeNull();
    expect(partial.release()).toBe(false);
    expect(fs.readFileSync(leasePath, 'utf8')).toBe(before);
  });
});

describe('exit-code contract', () => {
  it('a refused partial boot is NOT the stand-down code', () => {
    // 75 means "orderly stand-down, do not respawn" and is in PM2's
    // stop_exit_codes. A refusal must not be readable as a stand-down.
    expect(PARTIAL_BOOT_REFUSED_EXIT_CODE).not.toBe(SUPERSEDED_EXIT_CODE);
    expect(PARTIAL_BOOT_REFUSED_EXIT_CODE).toBe(78);
  });

  it('only 75 is in hydi-boot stop_exit_codes — a refusal must not suppress restart', () => {
    const boot = require('../../ecosystem.config.js').apps.find((a) => a.name === 'hydi-boot');
    expect(boot.stop_exit_codes).toEqual([SUPERSEDED_EXIT_CODE]);
    expect(boot.stop_exit_codes).not.toContain(PARTIAL_BOOT_REFUSED_EXIT_CODE);
  });
});
