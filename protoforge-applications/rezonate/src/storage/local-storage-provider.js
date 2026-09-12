const fs = require('fs');
const path = require('path');
const { StorageProvider } = require('./storage-provider');

/**
 * Local filesystem storage — the default, matching the platform-wide local-first
 * decision documented in CLAUDE.md ("Local-First Architecture"). Formalizes the
 * behavior that src/api/router.js's asset endpoints already implement directly
 * (fs.existsSync / fs.readFileSync / res.sendFile against a file_path), without
 * changing that call path (see storage-provider.js scope note).
 *
 * Keys may be absolute paths (today's convention) or relative to options.baseDir.
 */
class LocalStorageProvider extends StorageProvider {
  constructor(options = {}) {
    super();
    this.baseDir = options.baseDir || null;
  }

  name() { return 'local'; }

  _resolve(key) {
    if (!key) throw new Error('key is required');
    if (path.isAbsolute(key) || !this.baseDir) return key;
    return path.join(this.baseDir, key);
  }

  async save(key, buffer) {
    try {
      const target = this._resolve(key);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, buffer);
      return { ok: true, key: target };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async read(key) {
    const target = this._resolve(key);
    if (!fs.existsSync(target)) return null;
    return fs.readFileSync(target);
  }

  async exists(key) {
    return fs.existsSync(this._resolve(key));
  }

  async delete(key) {
    try {
      const target = this._resolve(key);
      if (fs.existsSync(target)) fs.unlinkSync(target);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

module.exports = { LocalStorageProvider };
