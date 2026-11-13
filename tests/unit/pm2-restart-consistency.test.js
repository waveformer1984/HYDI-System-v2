/**
 * Regression tests for scripts/pm2-restart.js supervisor consistency check.
 *
 * The PM2-on-Windows double-fork race (observed 2026-09-18): `pm2 restart
 * hydi-boot` can leave PM2 tracking a dead fork (pid 0 / "waiting restart")
 * while a live untracked fork supervises services. The boot lease
 * guarantees exactly-one-supervisor, so consistency = lease pid === PM2
 * tracked pid. This check makes the mismatch detectable instead of silent.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  checkSupervisorConsistency,
  readPm2Pid,
  waitForSupervisorConsistency,
  restartHydiBoot,
  BOOT_AGENT_APP,
} = require('../../scripts/pm2-restart');

describe('pm2-restart: checkSupervisorConsistency', () => {
  it('consistent when PM2 record and boot lease agree', () => {
    const r = checkSupervisorConsistency(29484, 29484);
    expect(r.verdict).toBe('consistent');
  });

  it('mismatch when PM2 tracks a different (dead) fork', () => {
    const r = checkSupervisorConsistency(24348, 36012);
    expect(r.verdict).toBe('mismatch');
    expect(r.detail).toMatch(/24348/);
    expect(r.detail).toMatch(/36012/);
  });

  it('incomplete when PM2 has no tracked pid yet (boot still starting)', () => {
    const r = checkSupervisorConsistency(null, 29484);
    expect(r.verdict).toBe('incomplete');
  });

  it('incomplete when the boot lease is not yet written', () => {
    const r = checkSupervisorConsistency(29484, null);
    expect(r.verdict).toBe('incomplete');
  });
});

describe('pm2-restart: readPm2Pid', () => {
  it('returns the tracked pid when pm2 reports a live process', () => {
    expect(readPm2Pid('hydi-boot', [{ name: 'hydi-boot', pid: 4242 }])).toBe(4242);
    expect(readPm2Pid('hydi-boot', [{ name: 'hydi-boot', pid: 0 }])).toBeNull();
    expect(readPm2Pid('missing', [{ name: 'hydi-boot', pid: 1 }])).toBeNull();
  });
});

describe('pm2-restart: waitForSupervisorConsistency', () => {
  it('resolves when pm2 and lease agree within the poll window', async () => {
    let pm2Pid = null;
    const r = await waitForSupervisorConsistency({
      readPm2Pid: () => pm2Pid,
      readLeasePid: () => 9001,
      sleep: async () => { pm2Pid = 9001; },
    }, 500);
    expect(r.ok).toBe(true);
    expect(r.last.verdict).toBe('consistent');
  });

  it('fails fast on mismatch', async () => {
    const r = await waitForSupervisorConsistency({
      readPm2Pid: () => 1,
      readLeasePid: () => 2,
      sleep: async () => {},
    }, 500);
    expect(r.ok).toBe(false);
    expect(r.last.verdict).toBe('mismatch');
  });
});

describe('pm2-restart: restartHydiBoot (stubbed pm2)', () => {
  it('delete + start then polls until consistent', async () => {
    const calls = [];
    let jlistCount = 0;
    const pm2Run = (args) => {
      calls.push(args);
      if (args[0] === 'delete') return { status: 0 };
      if (args[0] === 'start') return { status: 0 };
      if (args[0] === 'jlist') {
        jlistCount += 1;
        const pid = jlistCount >= 2 ? 7000 : 0;
        return { status: 0, stdout: JSON.stringify([{ name: BOOT_AGENT_APP, pid }]) };
      }
      return { status: 1 };
    };
    const r = await restartHydiBoot({
      pm2Run,
      readLeasePid: () => 7000,
      sleep: async () => {},
    });
    expect(r.ok).toBe(true);
    expect(calls[0]).toEqual(['delete', BOOT_AGENT_APP]);
    expect(calls[1][0]).toBe('start');
    expect(calls[1]).toContain('--only');
    expect(calls[1]).toContain(BOOT_AGENT_APP);
  });

  it('returns mismatch when lease and PM2 never agree', async () => {
    const pm2Run = (args) => {
      if (args[0] === 'delete' || args[0] === 'start') return { status: 0 };
      if (args[0] === 'jlist') {
        return { status: 0, stdout: JSON.stringify([{ name: BOOT_AGENT_APP, pid: 111 }]) };
      }
      return { status: 1 };
    };
    const r = await restartHydiBoot({
      pm2Run,
      readLeasePid: () => 222,
      sleep: async () => {},
    });
    expect(r.ok).toBe(false);
    expect(r.last.verdict).toBe('mismatch');
  });
});

describe('pm2-restart: readBootLeasePid', () => {
  it('reads the pid from HYDI_BOOT_LEASE_PATH and tolerates missing files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lease-'));
    const leaseFile = path.join(dir, '.hydi-boot.lock');
    process.env.HYDI_BOOT_LEASE_PATH = leaseFile;
    try {
      // Fresh module instance so BOOT_LEASE_PATH picks up the env seam.
      jest.resetModules();
      const { readBootLeasePid } = require('../../scripts/pm2-restart');

      expect(readBootLeasePid()).toBeNull(); // missing file → null, not throw

      fs.writeFileSync(leaseFile, JSON.stringify({ pid: 12345, claimedAt: 'x' }), 'utf8');
      expect(readBootLeasePid()).toBe(12345);

      fs.writeFileSync(leaseFile, '{broken', 'utf8');
      expect(readBootLeasePid()).toBeNull(); // malformed lease → null, not throw
    } finally {
      delete process.env.HYDI_BOOT_LEASE_PATH;
      fs.rmSync(dir, { recursive: true, force: true });
      jest.resetModules();
    }
  });
});
