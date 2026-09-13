'use strict';

/**
 * scripts/recovery-lease.js -- real file I/O, isolated to a temp directory
 * via RECOVERY_LEASE_DIR (set before requiring the module, since LEASE_DIR
 * is computed once at module-load time). Never touches the real
 * .recovery-leases/ directory.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-lease-test-'));
process.env.RECOVERY_LEASE_DIR = TEST_DIR;

const recoveryLease = require('../../scripts/recovery-lease');

afterAll(() => {
  delete process.env.RECOVERY_LEASE_DIR;
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('recovery-lease: record / read', () => {
  it('writes a real, valid JSON file with the expected fields', () => {
    const entry = recoveryLease.record('test-component-a', { pid: 12345, command: 'node', args: ['src/server.js'] });
    expect(entry.component).toBe('test-component-a');
    expect(entry.pid).toBe(12345);
    expect(entry.recoveredBy).toBe('RecoveryEngine'); // default

    const back = recoveryLease.read('test-component-a');
    expect(back).toEqual(entry);
  });

  it('read() returns null for a component with no lease, never throws', () => {
    expect(recoveryLease.read('never-recorded')).toBeNull();
  });

  it('a second record() for the same component overwrites the first (only the latest recovery matters)', () => {
    recoveryLease.record('test-component-b', { pid: 1 });
    recoveryLease.record('test-component-b', { pid: 2 });
    expect(recoveryLease.read('test-component-b').pid).toBe(2);
  });
});

describe('recovery-lease: getValidLease staleness', () => {
  it('a fresh lease is valid', () => {
    recoveryLease.record('test-fresh', { pid: 1 });
    expect(recoveryLease.getValidLease('test-fresh')).not.toBeNull();
  });

  it('a lease older than staleMs is not returned, even though the file still exists', () => {
    const target = path.join(recoveryLease.LEASE_DIR, 'test-old.json');
    fs.writeFileSync(target, JSON.stringify({
      component: 'test-old', pid: 1, recoveredAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    }));
    expect(recoveryLease.getValidLease('test-old', 24 * 60 * 60 * 1000)).toBeNull();
    // The file itself is untouched -- staleness is a read-time judgment, not a deletion.
    expect(fs.existsSync(target)).toBe(true);
  });

  it('getValidLease returns null (not throws) for malformed JSON on disk', () => {
    fs.writeFileSync(path.join(recoveryLease.LEASE_DIR, 'test-malformed.json'), '{not valid json');
    expect(recoveryLease.getValidLease('test-malformed')).toBeNull();
  });
});

describe('recovery-lease: clear', () => {
  it('removes the lease file', () => {
    recoveryLease.record('test-clear', { pid: 1 });
    expect(recoveryLease.read('test-clear')).not.toBeNull();
    recoveryLease.clear('test-clear');
    expect(recoveryLease.read('test-clear')).toBeNull();
  });

  it('is a safe no-op when there is nothing to clear', () => {
    expect(() => recoveryLease.clear('never-existed')).not.toThrow();
  });
});
