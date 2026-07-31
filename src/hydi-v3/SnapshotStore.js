'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class SnapshotStore {
  constructor(config = {}) {
    this.dataPath = config.dataPath || path.resolve(__dirname, '../../data/snapshots');
    this.logger = config.logger || console;
    this.maxSnapshots = config.maxSnapshots || 20;
    this.previous = null;
  }

  async start() {
    await fs.mkdir(this.dataPath, { recursive: true });
    return this;
  }

  async capture(context = {}) {
    const snapshot = {
      at: Date.now(),
      previous: this.previous,
      subsystems: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        ...(context.subsystems || {}),
      },
      bundles: context.bundles || {},
      meta: context.meta || {},
    };

    const payload = JSON.stringify(snapshot);
    const checksum = crypto.createHash('sha256').update(payload).digest('hex');
    const name = `${snapshot.at}-${checksum.slice(0, 16)}.json`;
    const filePath = path.join(this.dataPath, name);

    await fs.writeFile(filePath, JSON.stringify({ ...snapshot, checksum }, null, 2), 'utf8');
    this.previous = checksum;
    await this._prune();
    return { hash: checksum, filePath, snapshot };
  }

  async list() {
    const entries = await fs.readdir(this.dataPath).catch(() => []);
    const files = [];
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      const filePath = path.join(this.dataPath, name);
      try {
        const text = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(text);
        files.push({ filePath, hash: parsed.checksum, at: parsed.at });
      } catch {
        // ignore corrupt listing
      }
    }
    return files.sort((a, b) => b.at - a.at);
  }

  async restore(hashOrLatest = 'latest') {
    const list = await this.list();
    if (!list.length) return { success: false, error: 'no_snapshots' };

    let target;
    if (hashOrLatest === 'latest') {
      target = list[0];
    } else {
      target = list.find((s) => s.hash === hashOrLatest);
    }

    if (!target) return { success: false, error: 'snapshot_not_found' };

    try {
      const text = await fs.readFile(target.filePath, 'utf8');
      const parsed = JSON.parse(text);
      const payload = { ...parsed };
      delete payload.checksum;
      const computed = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      if (computed !== parsed.checksum) {
        return { success: false, error: 'checksum_mismatch', filePath: target.filePath };
      }
      return { success: true, snapshot: payload, hash: parsed.checksum };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), filePath: target.filePath };
    }
  }

  async _prune() {
    const list = await this.list();
    if (list.length > this.maxSnapshots) {
      const toRemove = list.slice(this.maxSnapshots);
      for (const f of toRemove) {
        await fs.unlink(f.filePath).catch(() => {});
      }
    }
  }
}

module.exports = SnapshotStore;
