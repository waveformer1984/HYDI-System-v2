const fs = require('fs');
const path = require('path');

function parseVersionFile(file) {
  const match = file.match(/^(\d{4})-(.*)\.js$/);
  if (!match) return null;
  return { version: match[1], name: match[2], file };
}

class MigrationRunner {
  constructor(options = {}) {
    this.migrationsDir = options.migrationsDir || path.join(process.cwd(), 'migrations');
    this.statusPath = options.statusPath || path.join(this.migrationsDir, '..', '.migration-status.json');
    this.dryRun = options.dryRun || false;
  }

  _readStatus() {
    try {
      return JSON.parse(fs.readFileSync(this.statusPath, 'utf-8'));
    } catch {
      return { applied: [], failed: [] };
    }
  }

  _writeStatus(status) {
    const dir = path.dirname(this.statusPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.statusPath, JSON.stringify(status, null, 2));
  }

  discover() {
    if (!fs.existsSync(this.migrationsDir)) return [];
    const entries = fs.readdirSync(this.migrationsDir);
    const migrations = entries
      .map(f => parseVersionFile(f))
      .filter(Boolean)
      .sort((a, b) => a.version.localeCompare(b.version));
    return migrations.map(m => {
      const mod = require(path.join(this.migrationsDir, m.file));
      return { ...m, up: mod.up, down: mod.down, description: mod.description || m.name };
    });
  }

  status() {
    const all = this.discover();
    const status = this._readStatus();
    return all.map(m => ({
      version: m.version,
      name: m.name,
      description: m.description,
      applied: status.applied.includes(m.version),
      failed: status.failed.includes(m.version)
    }));
  }

  async run(options = {}) {
    const toVersion = options.to;
    const status = this._readStatus();
    const all = this.discover();
    const results = [];

    for (const migration of all) {
      if (status.applied.includes(migration.version)) {
        results.push({ version: migration.version, name: migration.name, status: 'skipped' });
        continue;
      }
      if (toVersion && migration.version > toVersion) break;

      if (!migration.up || typeof migration.up !== 'function') {
        throw new Error(`Migration ${migration.version} does not export an up() function`);
      }

      try {
        if (!this.dryRun) {
          await migration.up();
          status.applied.push(migration.version);
          status.failed = status.failed.filter(v => v !== migration.version);
          this._writeStatus(status);
        }
        results.push({ version: migration.version, name: migration.name, status: this.dryRun ? 'dry-run' : 'applied' });
      } catch (err) {
        if (!status.failed.includes(migration.version)) status.failed.push(migration.version);
        this._writeStatus(status);
        results.push({
          version: migration.version,
          name: migration.name,
          status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown error'
        });
        if (!options.continueOnError) break;
      }
    }

    return { ok: results.every(r => r.status !== 'failed'), results };
  }

  async rollback(options = {}) {
    const toVersion = options.to;
    const status = this._readStatus();
    const all = this.discover().filter(m => status.applied.includes(m.version));
    const results = [];

    for (let i = all.length - 1; i >= 0; i--) {
      const migration = all[i];
      if (toVersion && migration.version <= toVersion) break;

      try {
        if (migration.down) await migration.down();
        status.applied = status.applied.filter(v => v !== migration.version);
        this._writeStatus(status);
        results.push({ version: migration.version, name: migration.name, status: 'rolled back' });
      } catch (err) {
        results.push({
          version: migration.version,
          name: migration.name,
          status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown error'
        });
        if (!options.continueOnError) break;
      }
    }

    return { ok: results.every(r => r.status !== 'failed'), results };
  }

  reset() {
    this._writeStatus({ applied: [], failed: [] });
    return { ok: true };
  }
}

module.exports = { MigrationRunner, parseVersionFile };
