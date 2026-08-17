const { Store } = require('./store');
const path = require('path');
const fs = require('fs');

const SCHEMA_VERSION = 3;
const MAX_BACKUPS = 5;

const defaultTables = {
  users: [],
  venues: [],
  gigs: [],
  availability: [],
  applications: [],
  messages: [],
  contracts: [],
  payments: [],
  ratings: [],
  moderation: [],
  availability_profiles: [],
  availability_exceptions: [],
  audit_log: []
};

function timestamp() {
  const d = new Date();
  return d.toISOString().replace(/[:.]/g, '-');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function rotateBackups(backupDir, base) {
  ensureDir(backupDir);
  const prefix = `${base}.`;
  const ext = '.bak';
  const files = fs.readdirSync(backupDir)
    .filter(f => f.startsWith(prefix) && f.endsWith(ext))
    .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtime.getTime() }))
    .sort((a, b) => a.time - b.time);
  while (files.length >= MAX_BACKUPS) {
    const oldest = files.shift();
    fs.unlinkSync(path.join(backupDir, oldest.name));
  }
}

function backupDb(filePath, backupDir) {
  const base = path.basename(filePath);
  const dir = path.dirname(filePath);
  const backupPath = path.join(backupDir || dir, `${base}.${timestamp()}.bak`);
  if (!fs.existsSync(filePath)) return null;
  if (backupDir) {
    ensureDir(backupDir);
    rotateBackups(backupDir, base);
    fs.copyFileSync(filePath, backupPath);
  }
  return backupPath;
}

function findLatestBackup(filePath, backupDir) {
  if (!backupDir || !fs.existsSync(backupDir)) return null;
  const base = path.basename(filePath);
  const files = fs.readdirSync(backupDir)
    .filter(f => f.startsWith(`${base}.`) && f.endsWith('.bak'))
    .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtime.getTime() }))
    .sort((a, b) => b.time - a.time);
  return files.length ? path.join(backupDir, files[0].name) : null;
}

function atomicWrite(filePath, data, backupDir) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmp = path.join(dir, `${path.basename(filePath)}.tmp`);
  backupDb(filePath, backupDir);
  const buffer = Buffer.from(data);
  let fd;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, buffer);
    try { fs.fsyncSync(fd); } catch (e) { /* fsync may be restricted on some filesystems */ }
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, filePath);
    fd = fs.openSync(filePath, 'r');
    try { fs.fsyncSync(fd); } catch (e) { /* best effort */ }
    fs.closeSync(fd);
    fd = null;
  } catch (err) {
    if (fd != null) {
      try { fs.closeSync(fd); } catch {}
    }
    if (fs.existsSync(tmp)) {
      try { fs.unlinkSync(tmp); } catch {}
    }
    throw err;
  }
}

class JsonStore extends Store {
  constructor({ filePath, backupDir, logger, onCorruption }) {
    super();
    this.filePath = filePath;
    this.backupDir = backupDir;
    this.logger = logger || { error: () => {}, warn: () => {}, info: () => {} };
    this.onCorruption = onCorruption || (() => {});
    this.state = null;
    this.lastAtomicWrite = null;
  }

  init() {
    if (fs.existsSync(this.filePath)) {
      let raw;
      try {
        raw = fs.readFileSync(this.filePath, 'utf8');
        this.state = this.migrate(JSON.parse(raw));
      } catch (err) {
        this.logger.error('json-store', 'corruption_detected', `Corrupted ${this.filePath}: ${err.message}`);
        const backup = findLatestBackup(this.filePath, this.backupDir);
        if (backup) {
          const damaged = `${this.filePath}.corrupt.${timestamp()}`;
          fs.renameSync(this.filePath, damaged);
          fs.copyFileSync(backup, this.filePath);
          this.onCorruption({ damaged, restoredFrom: backup });
          this.logger.info('json-store', 'restore_from_backup', `Restored ${this.filePath} from ${backup}`);
          this.state = this.migrate(JSON.parse(fs.readFileSync(this.filePath, 'utf8')));
        } else {
          this.state = this.migrate({ schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString(), ...defaultTables });
          this.save(this.state);
          this.onCorruption({ damaged: this.filePath, restoredFrom: null });
        }
      }
    } else {
      this.state = this.migrate({ schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString(), ...defaultTables });
      this.save(this.state);
    }
  }

  migrate(state) {
    let s = state || {};
    if (s.schemaVersion == null) s.schemaVersion = 0;

    if (s.schemaVersion < 1) {
      const next = { schemaVersion: 1, updatedAt: s.updatedAt || new Date().toISOString() };
      Object.keys(defaultTables).forEach(k => { next[k] = Array.isArray(s[k]) ? s[k] : defaultTables[k]; });
      s = next;
    }

    if (s.schemaVersion < 2) {
      if (!Array.isArray(s.moderation)) s.moderation = [];
      s.schemaVersion = 2;
    }

    if (s.schemaVersion < 3) {
      if (!Array.isArray(s.availability_profiles)) s.availability_profiles = [];
      if (!Array.isArray(s.availability_exceptions)) s.availability_exceptions = [];
      s.schemaVersion = 3;
    }

    s.schemaVersion = SCHEMA_VERSION;
    s.updatedAt = new Date().toISOString();
    return s;
  }

  load() { return this.state; }

  save(state) {
    this.state = state || this.state;
    this.state.schemaVersion = SCHEMA_VERSION;
    this.state.updatedAt = new Date().toISOString();
    const json = JSON.stringify(this.state, null, 2);
    atomicWrite(this.filePath, json, this.backupDir);
    this.lastAtomicWrite = new Date().toISOString();
  }

  getAll(table) { return (this.state[table] || []).slice(); }
  getById(table, id) { return (this.state[table] || []).find(r => r.id === id); }

  create(table, record) {
    if (!this.state[table]) this.state[table] = [];
    this.state[table].push(record);
    this.save();
    return record;
  }

  update(table, id, record) {
    if (!this.state[table]) return null;
    const idx = this.state[table].findIndex(r => r.id === id);
    if (idx === -1) return null;
    this.state[table][idx] = record;
    this.save();
    return record;
  }

  delete(table, id) {
    if (!this.state[table]) return false;
    const len = this.state[table].length;
    this.state[table] = this.state[table].filter(r => r.id !== id);
    if (this.state[table].length !== len) {
      this.save();
      return true;
    }
    return false;
  }
}

module.exports = { JsonStore, SCHEMA_VERSION, MAX_BACKUPS, findLatestBackup };
