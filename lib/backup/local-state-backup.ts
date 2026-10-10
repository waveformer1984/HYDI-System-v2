/**
 * Local state backup & restore (Phase 8).
 * ---------------------------------------------------------------------------
 * The gap this closes, measured 2026-09-18 (baseline):
 *
 *   Zero backup coverage existed for every authoritative store: the local
 *   Postgres database, .hydi-operational/ (~170 MB of append-only journals),
 *   heidi-core/data/heidi_memory.db, and the .hydi/ evidence tree.
 *   scripts/local-backup.sh covers git code only. scripts/backup-critical.ps1
 *   is hardcoded to C:\Users\Owner\HYDI_System -- the wrong repository.
 *
 * What this module does:
 *   backup  -> copies each declared store into a timestamped directory,
 *              writes a manifest with per-file sha256 + byte count, and
 *              appends to a manifest log so runs are auditable.
 *   restore -> verifies every manifest checksum BEFORE writing, restores
 *              into an ISOLATED destination (never over the live store),
 *              then re-verifies on disk. Restore to the live location is a
 *              separate, explicitly-requested operation — see restoreState's
 *              `target` contract.
 *
 * Integrity model: the manifest IS the integrity contract. A backup whose
 * files do not match their recorded sha256 is corrupt and refused — a
 * "successful" restore of corrupt data is worse than a failed one.
 *
 * Postgres: handled by LocalStateBackup.pgDump() which shells out through an
 * INJECTABLE executor, so the file-store logic is fully testable hermetically
 * and the pg_dump call itself is the only integration point.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface BackupStore {
  /** Stable identifier used in the manifest and the backup directory name. */
  id: string;
  /** Absolute path to the live store (file or directory). */
  sourcePath: string;
}

export interface BackupManifestEntry {
  storeId: string;
  sourcePath: string;
  backupPath: string;
  kind: 'file' | 'directory';
  fileCount: number;
  totalBytes: number;
  /** sha256 over file contents, sorted by relative path. Directories hash the concatenation of per-file digests. */
  sha256: string;
}

export interface BackupManifest {
  schema: 'hydi.local-state-backup/v1';
  createdAt: string;
  backupId: string;
  entries: BackupManifestEntry[];
}

export interface BackupResult {
  ok: boolean;
  backupDir: string;
  manifest: BackupManifest;
  errors: string[];
}

export interface RestoreResult {
  ok: boolean;
  restoredTo: string;
  restored: string[];
  errors: string[];
}

export interface PgDumpExecutor {
  /** Runs pg_dump and returns the SQL text. Injectable for tests. */
  (args: { host: string; port: number; database: string; user: string }): Promise<string>;
}

export interface LocalStateBackupOptions {
  repoRoot: string;
  backupRoot: string;
  /** Stores to include. Defaults to the four authoritative local stores. */
  stores?: BackupStore[];
  pgDump?: PgDumpExecutor;
  /** Postgres connection for the optional DB leg. Omit to skip it. */
  postgres?: { host: string; port: number; database: string; user: string };
}

function sha256File(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256Hex(parts: string[]): string {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest('hex');
}

function* walkFiles(root: string): Generator<string> {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) yield* walkFiles(full);
    else if (e.isFile()) yield full;
  }
}

/** Copy `src` (file or directory) into `destDir`, returning file count + bytes. */
function copyStore(src: string, destDir: string): { fileCount: number; totalBytes: number; sha256: string; kind: 'file' | 'directory' } {
  const stat = fs.statSync(src);
  if (stat.isFile()) {
    fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, path.join(destDir, path.basename(src)));
    return { fileCount: 1, totalBytes: stat.size, sha256: sha256File(src), kind: 'file' };
  }

  const digests: string[] = [];
  let fileCount = 0;
  let totalBytes = 0;
  for (const file of walkFiles(src)) {
    const rel = path.relative(src, file);
    const out = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(file, out);
    digests.push(rel.replace(/\\/g, '/') + ':' + sha256File(file));
    fileCount += 1;
    totalBytes += fs.statSync(file).size;
  }
  digests.sort();
  return { fileCount, totalBytes, sha256: sha256Hex(digests), kind: 'directory' };
}

/** Recompute a copied store's digest the same way copyStore recorded it. */
function verifyStore(dirPath: string, entry: BackupManifestEntry): boolean {
  if (entry.kind === 'file') {
    const file = path.join(dirPath, path.basename(entry.sourcePath));
    return fs.existsSync(file) && sha256File(file) === entry.sha256;
  }
  const digests: string[] = [];
  for (const file of walkFiles(dirPath)) {
    const rel = path.relative(dirPath, file).replace(/\\/g, '/');
    digests.push(rel + ':' + sha256File(file));
  }
  digests.sort();
  return sha256Hex(digests) === entry.sha256;
}

export class LocalStateBackup {
  private opts: LocalStateBackupOptions;

  constructor(opts: LocalStateBackupOptions) {
    this.opts = opts;
  }

  /** Default authoritative stores, resolved under repoRoot. */
  static defaultStores(repoRoot: string): BackupStore[] {
    return [
      { id: 'hydi-operational', sourcePath: path.join(repoRoot, '.hydi-operational') },
      { id: 'hydi-evidence', sourcePath: path.join(repoRoot, '.hydi') },
      { id: 'protoforge-state', sourcePath: path.join(repoRoot, '.protoforge') },
      { id: 'recovery-leases', sourcePath: path.join(repoRoot, '.recovery-leases') },
      { id: 'heidi-memory-db', sourcePath: path.join(repoRoot, 'heidi-core', 'data', 'heidi_memory.db') },
    ];
  }

  /**
   * Create a timestamped backup of every store that exists on disk.
   * Missing stores are recorded as errors, not silently skipped — a backup
   * that quietly omits a store looks identical to a complete one and isn't.
   */
  async backup(stores?: BackupStore[]): Promise<BackupResult> {
    const list = stores ?? this.opts.stores ?? LocalStateBackup.defaultStores(this.opts.repoRoot);
    const backupId = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(this.opts.backupRoot, `state-${backupId}`);
    const errors: string[] = [];
    const entries: BackupManifestEntry[] = [];

    fs.mkdirSync(backupDir, { recursive: true });

    for (const store of list) {
      try {
        if (!fs.existsSync(store.sourcePath)) {
          errors.push(`${store.id}: source missing at ${store.sourcePath}`);
          continue;
        }
        const destDir = path.join(backupDir, store.id);
        const { fileCount, totalBytes, sha256, kind } = copyStore(store.sourcePath, destDir);
        entries.push({
          storeId: store.id,
          sourcePath: store.sourcePath,
          backupPath: destDir,
          kind,
          fileCount,
          totalBytes,
          sha256,
        });
      } catch (e) {
        errors.push(`${store.id}: ${(e as Error).message}`);
      }
    }

    // Optional Postgres leg — injectable so the file stores stay hermetic.
    if (this.opts.postgres) {
      try {
        const sql = await (this.opts.pgDump ?? LocalStateBackup.defaultPgDump)(this.opts.postgres);
        const pgFile = path.join(backupDir, 'postgres.sql');
        fs.writeFileSync(pgFile, sql, 'utf8');
        entries.push({
          storeId: 'postgres',
          sourcePath: `${this.opts.postgres.host}:${this.opts.postgres.port}/${this.opts.postgres.database}`,
          backupPath: pgFile,
          kind: 'file',
          fileCount: 1,
          totalBytes: Buffer.byteLength(sql),
          sha256: sha256File(pgFile),
        });
      } catch (e) {
        errors.push(`postgres: ${(e as Error).message}`);
      }
    }

    const manifest: BackupManifest = {
      schema: 'hydi.local-state-backup/v1',
      createdAt: new Date().toISOString(),
      backupId,
      entries,
    };
    fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    // Append-only run log — every backup attempt is auditable.
    fs.mkdirSync(this.opts.backupRoot, { recursive: true });
    fs.appendFileSync(
      path.join(this.opts.backupRoot, 'manifest.log'),
      JSON.stringify({ backupId, createdAt: manifest.createdAt, entries: entries.length, errors }) + '\n',
      'utf8',
    );

    return { ok: errors.length === 0, backupDir, manifest, errors };
  }

  /**
   * Restore a backup into an ISOLATED destination directory.
   *
   * `target` is the directory each store is restored INTO (as
   * `target/<storeId>/...`). It must not be a live store path — this method
   * refuses to write into any declared sourcePath, because restoring over
   * live state is a different operation with its own authorization boundary.
   *
   * Every manifest checksum is verified BEFORE anything is written, and the
   * restored files are re-verified afterwards. Corrupt backups are refused.
   */
  async restore(backupDir: string, target: string): Promise<RestoreResult> {
    const errors: string[] = [];
    const manifestPath = path.join(backupDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return { ok: false, restoredTo: target, restored: [], errors: [`manifest not found in ${backupDir}`] };
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;

    const liveSources = new Set(
      (this.opts.stores ?? LocalStateBackup.defaultStores(this.opts.repoRoot)).map((s) => path.resolve(s.sourcePath)),
    );

    // Pre-flight: verify all checksums before writing anything.
    for (const entry of manifest.entries) {
      if (entry.storeId === 'postgres') continue; // restored via SQL, not file copy
      if (!verifyStore(entry.backupPath, entry)) {
        errors.push(`${entry.storeId}: checksum mismatch in ${entry.backupPath} — backup is corrupt, refusing to restore`);
      }
      if (liveSources.has(path.resolve(target))) {
        errors.push(`restore target ${target} is a live store path — refusing to overwrite live state`);
      }
    }
    if (errors.length) {
      return { ok: false, restoredTo: target, restored: [], errors };
    }

    const restored: string[] = [];
    for (const entry of manifest.entries) {
      if (entry.storeId === 'postgres') continue;
      const destDir = path.join(target, entry.storeId);
      try {
        const { sha256 } = copyStore(entry.backupPath, destDir);
        // Re-verify what actually landed.
        if (!verifyStore(destDir, entry)) {
          errors.push(`${entry.storeId}: post-restore verification failed (copied ${sha256}, expected ${entry.sha256})`);
          continue;
        }
        restored.push(entry.storeId);
      } catch (e) {
        errors.push(`${entry.storeId}: ${(e as Error).message}`);
      }
    }

    return { ok: errors.length === 0, restoredTo: target, restored, errors };
  }

  /** List backups under backupRoot, newest first. */
  list(): Array<{ backupId: string; createdAt: string; entries: number }> {
    if (!fs.existsSync(this.opts.backupRoot)) return [];
    const out: Array<{ backupId: string; createdAt: string; entries: number }> = [];
    for (const name of fs.readdirSync(this.opts.backupRoot)) {
      const manifestPath = path.join(this.opts.backupRoot, name, 'manifest.json');
      try {
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;
        out.push({ backupId: m.backupId, createdAt: m.createdAt, entries: m.entries.length });
      } catch {
        // not a backup dir
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Default pg_dump via the running Supabase docker container. Read-only on
   * the database — it produces a SQL dump on stdout. Injectable in tests so
   * the file-store logic needs no docker.
   */
  static async defaultPgDump(args: { host: string; port: number; database: string; user: string }): Promise<string> {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync('docker', [
      'exec', 'supabase_db_HYDI-System-v2',
      'pg_dump', '-U', args.user, '-d', args.database, '--clean', '--if-exists',
    ], { maxBuffer: 512 * 1024 * 1024 });
    return stdout;
  }
}
