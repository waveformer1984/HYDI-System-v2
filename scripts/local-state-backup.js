'use strict';
/**
 * local-state-backup — backup/restore the authoritative LOCAL stores.
 * ---------------------------------------------------------------------------
 * Usage:
 *   node scripts/local-state-backup.js backup [--dir <backupRoot>] [--no-pg]
 *   node scripts/local-state-backup.js restore <backupDir> --to <destDir>
 *   node scripts/local-state-backup.js list [--dir <backupRoot>]
 *
 * Covers the stores scripts/local-backup.sh does NOT (that one is git-only):
 *   .hydi-operational/   append-only journals, keys, authorization records
 *   .hydi/               baselines, verification evidence
 *   .protoforge/         phase state, mission artifacts
 *   .recovery-leases/    ownership leases
 *   heidi-core/data/heidi_memory.db
 *   Postgres             optional, via docker exec pg_dump (on by default;
 *                        --no-pg skips it for environments without docker)
 *
 * Restores go into an ISOLATED destination — never over the live store.
 * Overwriting live state is a separate, separately-authorized operation.
 */

const path = require('path');

async function main() {
  // tsx is present in devDependencies and already used across the repo to run
  // TypeScript scripts directly; registering its CJS hook lets us require the
  // .ts module so the TS file stays the single implementation instead of a
  // duplicated JS port that can drift.
  require('tsx/cjs');
  const { LocalStateBackup } = require('../lib/backup/local-state-backup.ts');

  const args = process.argv.slice(2);
  const command = args[0];
  const repoRoot = path.resolve(__dirname, '..');

  const dirIdx = args.indexOf('--dir');
  const backupRoot = dirIdx >= 0 ? path.resolve(args[dirIdx + 1])
    : path.join(repoRoot, 'backups', 'local-state');
  const noPg = args.includes('--no-pg');

  const backup = new LocalStateBackup({
    repoRoot,
    backupRoot,
    postgres: noPg ? undefined : { host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres' },
  });

  if (command === 'backup') {
    const result = await backup.backup();
    console.log(`[backup] ${result.backupDir}`);
    for (const e of result.manifest.entries) {
      console.log(`  ${e.storeId}: ${e.fileCount} file(s), ${e.totalBytes} bytes, sha256 ${e.sha256.slice(0, 12)}…`);
    }
    for (const err of result.errors) console.error(`  ERROR: ${err}`);
    process.exit(result.ok ? 0 : 1);
  }

  if (command === 'restore') {
    const backupDir = args[1];
    const toIdx = args.indexOf('--to');
    if (!backupDir || toIdx < 0) {
      console.error('usage: local-state-backup.js restore <backupDir> --to <destDir>');
      process.exit(1);
    }
    const result = await backup.restore(path.resolve(backupDir), path.resolve(args[toIdx + 1]));
    for (const id of result.restored) console.log(`  restored: ${id}`);
    for (const err of result.errors) console.error(`  ERROR: ${err}`);
    console.log(result.ok ? `[restore] OK -> ${result.restoredTo}` : '[restore] FAILED');
    process.exit(result.ok ? 0 : 1);
  }

  if (command === 'list') {
    for (const b of backup.list()) {
      console.log(`${b.createdAt}  ${b.backupId}  (${b.entries} stores)`);
    }
    process.exit(0);
  }

  console.error('usage: local-state-backup.js backup|restore|list');
  process.exit(1);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
