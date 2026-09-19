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

const { checkSupervisorConsistency } = require('../../scripts/pm2-restart');

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
