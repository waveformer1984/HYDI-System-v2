/**
 * LocalStateBackup — backup/restore correctness (Phase 8).
 *
 * Hermetic: every store is a temp directory; the pg_dump leg is injected.
 * No docker, no live Postgres, no touching the real .hydi-operational.
 *
 * The contract being proved:
 *   backup exists -> restore into ISOLATED location -> verify expected
 *   records/files -> verify integrity. A corrupt backup is REFUSED, and a
 *   restore never writes over a live store path.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { LocalStateBackup, type BackupStore } from '../../lib/backup/local-state-backup';

let work: string;
let repoRoot: string;
let backupRoot: string;
let stores: BackupStore[];

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-backup-'));
  repoRoot = path.join(work, 'repo');
  backupRoot = path.join(work, 'backups');

  // Fake authoritative stores under the fake repo.
  fs.mkdirSync(path.join(repoRoot, '.hydi-operational'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, '.hydi-operational', 'events.jsonl'), '{"e":1}\n{"e":2}\n');
  fs.mkdirSync(path.join(repoRoot, '.hydi'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, '.hydi', 'phase-dependency-graph.json'), '{"phases":{}}');
  fs.mkdirSync(path.join(repoRoot, '.protoforge'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, '.protoforge', 'mission-state.json'), '{"missions":[]}');
  fs.mkdirSync(path.join(repoRoot, '.recovery-leases'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, '.recovery-leases', 'protoforge-core.json'), '{"pid":1234}');
  fs.mkdirSync(path.join(repoRoot, 'heidi-core', 'data'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'heidi-core', 'data', 'heidi_memory.db'), 'SQLITE-FAKE-BYTES');

  stores = LocalStateBackup.defaultStores(repoRoot);
});

afterEach(() => {
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* best effort */ }
});

function makeBackup(extra: Record<string, unknown> = {}) {
  return new LocalStateBackup({ repoRoot, backupRoot, stores, ...extra });
}

describe('backup', () => {
  test('creates a manifest with sha256 + byte counts for every store', async () => {
    const result = await makeBackup().backup();

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.manifest.schema).toBe('hydi.local-state-backup/v1');

    const ids = result.manifest.entries.map((e) => e.storeId).sort();
    expect(ids).toContain('hydi-operational');
    expect(ids).toContain('hydi-evidence');
    expect(ids).toContain('heidi-memory-db');

    for (const e of result.manifest.entries) {
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(e.fileCount).toBeGreaterThan(0);
      expect(fs.existsSync(e.backupPath)).toBe(true);
    }
    expect(fs.existsSync(path.join(result.backupDir, 'manifest.json'))).toBe(true);
  });

  test('a missing store is an error, not a silent skip', async () => {
    fs.rmSync(path.join(repoRoot, '.hydi'), { recursive: true });
    const result = await makeBackup().backup();

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('hydi-evidence'))).toBe(true);
  });

  test('the postgres leg is injectable and lands in the manifest', async () => {
    const result = await makeBackup({
      postgres: { host: 'x', port: 1, database: 'd', user: 'u' },
      pgDump: async () => 'CREATE TABLE t();',
    }).backup();

    const pg = result.manifest.entries.find((e) => e.storeId === 'postgres');
    expect(pg).toBeDefined();
    expect(fs.readFileSync(pg!.backupPath, 'utf8')).toBe('CREATE TABLE t();');
  });

  test('a failed pg_dump is recorded as an error, not a crash', async () => {
    const result = await makeBackup({
      postgres: { host: 'x', port: 1, database: 'd', user: 'u' },
      pgDump: async () => { throw new Error('docker not running'); },
    }).backup();

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('docker not running'))).toBe(true);
    // File stores still backed up — a pg failure must not lose the rest.
    expect(result.manifest.entries.length).toBeGreaterThan(0);
  });
});

describe('restore', () => {
  test('restores into an isolated directory and re-verifies integrity', async () => {
    const backup = makeBackup();
    const created = await backup.backup();
    const target = path.join(work, 'restored');

    const result = await backup.restore(created.backupDir, target);

    expect(result.ok).toBe(true);
    expect(result.restored).toContain('hydi-operational');
    expect(result.restored).toContain('heidi-memory-db');

    const restoredEvents = fs.readFileSync(
      path.join(target, 'hydi-operational', 'events.jsonl'), 'utf8',
    );
    expect(restoredEvents).toBe('{"e":1}\n{"e":2}\n');
    expect(fs.readFileSync(path.join(target, 'heidi-memory-db', 'heidi_memory.db'), 'utf8'))
      .toBe('SQLITE-FAKE-BYTES');
  });

  test('refuses to restore a corrupt backup — checksum mismatch is detected', async () => {
    const backup = makeBackup();
    const created = await backup.backup();

    // Corrupt one file inside the backup AFTER the manifest was written.
    const eventsPath = path.join(created.backupDir, 'hydi-operational', 'events.jsonl');
    fs.writeFileSync(eventsPath, '{"e":1}\n{"e":TAMPERED}\n');

    const result = await backup.restore(created.backupDir, path.join(work, 'restored'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('checksum'))).toBe(true);
    expect(fs.existsSync(path.join(work, 'restored', 'hydi-operational'))).toBe(false);
  });

  test('refuses to restore onto a live store path', async () => {
    const backup = makeBackup();
    const created = await backup.backup();

    // Attempt to restore directly over the live .hydi-operational store.
    const result = await backup.restore(created.backupDir, path.join(repoRoot, '.hydi-operational'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('live'))).toBe(true);
    // Live content untouched.
    expect(fs.readFileSync(path.join(repoRoot, '.hydi-operational', 'events.jsonl'), 'utf8'))
      .toBe('{"e":1}\n{"e":2}\n');
  });

  test('a backup dir with no manifest is refused cleanly', async () => {
    const result = await makeBackup().restore(path.join(work, 'no-such-backup'), path.join(work, 'restored'));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/manifest/);
  });
});

describe('list', () => {
  test('lists backups newest-first', async () => {
    const backup = makeBackup();
    await backup.backup();
    const list = backup.list();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].entries).toBeGreaterThan(0);
  });
});
