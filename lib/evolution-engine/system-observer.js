'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Collect host + service observation snapshot (read-only).
 */
class SystemObserver {
  /**
   * @param {{ repoRoot?: string, probeUrl?: Function }} [deps]
   */
  constructor(deps = {}) {
    this.repoRoot = deps.repoRoot || process.cwd();
    this.probeUrl = deps.probeUrl || null;
  }

  async collect() {
    const mem = process.memoryUsage();
    const snapshot = {
      ts: new Date().toISOString(),
      host: {
        platform: process.platform,
        arch: process.arch,
        cpus: os.cpus().length,
        loadavg: os.loadavg(),
        freemem_mb: Math.round(os.freemem() / 1048576),
        totalmem_mb: Math.round(os.totalmem() / 1048576),
        rss_mb: Math.round(mem.rss / 1048576),
      },
      storage: this._storageHint(),
      services: await this._probeServices(),
      frank: this._readFrankSnapshot(),
    };
    return snapshot;
  }

  _storageHint() {
    try {
      const stat = fs.statfsSync ? fs.statfsSync(this.repoRoot) : null;
      if (stat && stat.bfree != null && stat.bsize != null) {
        const freeMb = Math.round((stat.bfree * stat.bsize) / 1048576);
        return { repo_free_mb: freeMb, source: 'statfs' };
      }
    } catch { /* ignore */ }
    return { repo_free_mb: null, source: 'unknown' };
  }

  _readFrankSnapshot() {
    const p = path.join(this.repoRoot, '.runtime', 'observation', 'frank.json');
    if (!fs.existsSync(p)) return null;
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      return { level: j.level, issue_count: j.issues?.length ?? null, generatedAt: j.generatedAt ?? null };
    } catch {
      return { error: 'unreadable' };
    }
  }

  async _probeServices() {
    if (!this.probeUrl) return [];
    const endpoints = [
      { name: 'heidi-web', url: 'http://127.0.0.1:3000/api/health' },
      { name: 'protoforge-core', url: 'http://127.0.0.1:3005/health' },
      { name: 'heidi-mobile', url: 'http://127.0.0.1:3006/api/health' },
      { name: 'ollama', url: 'http://127.0.0.1:11434/api/tags' },
    ];
    const out = [];
    for (const e of endpoints) {
      // eslint-disable-next-line no-await-in-loop
      const r = await this.probeUrl(e.name, e.url);
      out.push({ ...e, ...r });
    }
    return out;
  }
}

module.exports = { SystemObserver };
