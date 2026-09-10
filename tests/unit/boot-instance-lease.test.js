/**
 * Single-instance contract for the HYDI boot runtime.
 *
 * Regression target (observed twice on 2026-09-10, PM2 7.0.1 daemon log):
 *
 *   08:18:41  App [hydi-boot:4] starting in -fork mode-   ← fork A
 *   08:18:41  App [hydi-boot:4] online
 *   08:18:41  App [hydi-boot:4] exited with code [0]      ← the OLD fork's exit,
 *                                                           attributed to fork A
 *   08:18:46  App [hydi-boot:4] starting in -fork mode-   ← fork B, restart_delay later
 *   08:18:46  App [hydi-boot:4] online
 *
 * Fork A was never killed. Two boot runtimes ran concurrently, each with its own
 * hydi-orchestrator core loop and job-executor-poller. Killing the orphan made
 * PM2 spawn another — the duplication moved instead of converging.
 *
 * These tests pin the arbitration mechanism: newest claim wins, the incumbent
 * detects it and stands down, and identity survives Windows PID reuse.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  BootInstanceLease,
  SUPERSEDED_EXIT_CODE,
} = require('../../scripts/boot-instance-lease');

let tmpDir;
let lockPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-lease-'));
  lockPath = path.join(tmpDir, '.hydi-boot.lock');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const mk = (over = {}) => new BootInstanceLease({ lockPath, ...over });

describe('BootInstanceLease', () => {
  describe('Test A — normal startup: one instance owns the lease', () => {
    it('claims the lease and reports itself as owner', () => {
      const a = mk();
      const { bootId, supersededOwner } = a.claim();

      expect(typeof bootId).toBe('string');
      expect(bootId.length).toBeGreaterThan(0);
      expect(supersededOwner).toBeNull();
      expect(a.isStillOwner()).toBe(true);
    });

    it('writes an owner record naming the process', () => {
      const a = mk();
      a.claim();
      const rec = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      expect(rec.bootId).toBe(a.bootId);
      expect(rec.pid).toBe(process.pid);
      expect(typeof rec.startedAt).toBe('string');
    });

    it('a fresh start with no prior lease supersedes nobody', () => {
      expect(fs.existsSync(lockPath)).toBe(false);
      const { supersededOwner } = mk().claim();
      expect(supersededOwner).toBeNull();
    });
  });

  describe('Test B — restart: the newcomer wins, the incumbent stands down', () => {
    it('the second claim takes ownership from the first', () => {
      const incumbent = mk();
      incumbent.claim();
      expect(incumbent.isStillOwner()).toBe(true);

      const newcomer = mk();
      const { supersededOwner } = newcomer.claim();

      expect(newcomer.isStillOwner()).toBe(true);
      expect(incumbent.isStillOwner()).toBe(false); // ← incumbent must stand down
      expect(supersededOwner).not.toBeNull();
      expect(supersededOwner.bootId).toBe(incumbent.bootId);
    });

    it('exactly one instance considers itself owner after a restart', () => {
      const a = mk(); a.claim();
      const b = mk(); b.claim();
      const owners = [a, b].filter((l) => l.isStillOwner());
      expect(owners).toHaveLength(1);
      expect(owners[0]).toBe(b);
    });

    it('the superseded owner record carries enough detail to log who stood down', () => {
      const a = mk(); a.claim();
      const b = mk();
      const { supersededOwner } = b.claim();
      expect(supersededOwner).toMatchObject({ bootId: a.bootId, pid: process.pid });
      expect(typeof supersededOwner.startedAt).toBe('string');
    });
  });

  describe('Test C — rapid repeated restarts do not accumulate owners', () => {
    it('after 10 successive claims exactly one instance owns the lease', () => {
      const instances = [];
      for (let i = 0; i < 10; i += 1) {
        const l = mk();
        l.claim();
        instances.push(l);
      }
      const owners = instances.filter((l) => l.isStillOwner());
      expect(owners).toHaveLength(1);
      expect(owners[0]).toBe(instances[instances.length - 1]);
    });

    it('every superseded instance knows it must stand down', () => {
      const instances = [];
      for (let i = 0; i < 5; i += 1) { const l = mk(); l.claim(); instances.push(l); }
      const standingDown = instances.slice(0, -1);
      for (const l of standingDown) expect(l.isStillOwner()).toBe(false);
    });

    it('bootIds are unique across claims, so identity never collides', () => {
      const ids = new Set();
      for (let i = 0; i < 25; i += 1) ids.add(mk().claim().bootId);
      expect(ids.size).toBe(25);
    });
  });

  describe('Test D — graceful shutdown releases the lease', () => {
    it('the owner can release, leaving no lease behind', () => {
      const a = mk();
      a.claim();
      expect(a.release()).toBe(true);
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('a superseded instance must NOT delete its successor lease on the way out', () => {
      const a = mk(); a.claim();
      const b = mk(); b.claim();

      expect(a.release()).toBe(false);          // a no longer owns it
      expect(fs.existsSync(lockPath)).toBe(true);
      expect(b.isStillOwner()).toBe(true);      // b's lease survived a's exit
    });

    it('start → release → start again yields a single fresh owner', () => {
      const a = mk(); a.claim(); a.release();
      const b = mk(); const { supersededOwner } = b.claim();
      expect(supersededOwner).toBeNull();
      expect(b.isStillOwner()).toBe(true);
      expect(a.isStillOwner()).toBe(false);
    });
  });

  describe('identity is not a PID (Windows reuses them)', () => {
    it('a lease written by a different bootId at the SAME pid is not ours', () => {
      // During the incident an unrelated Intel service appeared as a child of a
      // poller purely through PID reuse. PIDs cannot be identity here.
      const a = mk();
      a.claim();
      const stolen = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      stolen.bootId = 'a-different-boot-id';
      fs.writeFileSync(lockPath, JSON.stringify(stolen), 'utf8');

      expect(stolen.pid).toBe(process.pid); // same pid ...
      expect(a.isStillOwner()).toBe(false); // ... but not the same instance
    });

    it('ownership is decided by bootId alone', () => {
      const a = mk({ newId: () => 'fixed-id' });
      a.claim();
      const b = mk({ newId: () => 'fixed-id' });
      b.claim();
      // Same generated id => both legitimately "own" it. Documents that the id
      // generator must be unique; the default uses 12 random bytes.
      expect(a.isStillOwner()).toBe(true);
      expect(b.isStillOwner()).toBe(true);
    });
  });

  describe('robustness — a bad lease must never prevent booting', () => {
    it('a corrupt lease file is treated as absent', () => {
      fs.writeFileSync(lockPath, '{not json', 'utf8');
      const a = mk();
      expect(() => a.claim()).not.toThrow();
      expect(a.isStillOwner()).toBe(true);
    });

    it('a lease missing bootId is treated as absent', () => {
      fs.writeFileSync(lockPath, JSON.stringify({ pid: 1 }), 'utf8');
      const a = mk();
      expect(a.claim().supersededOwner).toBeNull();
      expect(a.isStillOwner()).toBe(true);
    });

    it('read() returns null rather than throwing when the file is gone', () => {
      expect(mk().read()).toBeNull();
    });

    it('an instance that never claimed is never an owner', () => {
      expect(mk().isStillOwner()).toBe(false);
    });

    it('a deleted lease means we can no longer prove ownership', () => {
      const a = mk();
      a.claim();
      fs.unlinkSync(lockPath);
      expect(a.isStillOwner()).toBe(false);
    });
  });

  describe('wiring — boot-agent and PM2 must agree on the stand-down contract', () => {
    const read = (p) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

    it('SUPERSEDED_EXIT_CODE is listed in hydi-boot stop_exit_codes', () => {
      const apps = require('../../ecosystem.config.js').apps;
      const boot = apps.find((a) => a.name === 'hydi-boot');
      expect(boot).toBeDefined();
      expect(boot.stop_exit_codes).toContain(SUPERSEDED_EXIT_CODE);
    });

    it('boot-agent claims the lease and supervises it', () => {
      const code = read('scripts/boot-agent.js');
      expect(code).toContain("require('./boot-instance-lease')");
      expect(code).toContain('lease.claim()');
      expect(code).toContain('startLeaseSupervision');
      expect(code).toContain('lease.isStillOwner()');
    });

    it('boot-agent stands down with SUPERSEDED_EXIT_CODE rather than lingering', () => {
      expect(read('scripts/boot-agent.js')).toContain('shutdown(SUPERSEDED_EXIT_CODE)');
    });

    it('boot-agent releases the lease during shutdown', () => {
      expect(read('scripts/boot-agent.js')).toContain('lease.release()');
    });

    it('the stand-down code is 75 in both places', () => {
      expect(SUPERSEDED_EXIT_CODE).toBe(75);
      expect(read('ecosystem.config.js')).toContain('stop_exit_codes: [75]');
    });
  });
});
