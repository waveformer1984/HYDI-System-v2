'use strict';

const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');

/**
 * Append-only evolution history (problems, attempts, outcomes).
 * Uses repo-local .runtime/evolution/ — not a separate DB; complements heidi-core memory.
 */
class EvolutionMemory {
  /**
   * @param {{ rootDir?: string }} [opts]
   */
  constructor(opts = {}) {
    this.rootDir = opts.rootDir || path.join(process.cwd(), '.runtime', 'evolution');
    this.eventsPath = path.join(this.rootDir, 'events.jsonl');
    this.snapshotsDir = path.join(this.rootDir, 'snapshots');
  }

  ensureDirs() {
    fs.mkdirSync(this.rootDir, { recursive: true });
    fs.mkdirSync(this.snapshotsDir, { recursive: true });
  }

  /**
   * @param {string} type
   * @param {object} payload
   */
  record(type, payload = {}) {
    this.ensureDirs();
    const row = {
      id: randomBytes(8).toString('hex'),
      type,
      ts: new Date().toISOString(),
      ...payload,
    };
    fs.appendFileSync(this.eventsPath, `${JSON.stringify(row)}\n`, 'utf8');
    return row;
  }

  /**
   * @param {number} [limit]
   */
  readHistory(limit = 100) {
    if (!fs.existsSync(this.eventsPath)) return [];
    const lines = fs.readFileSync(this.eventsPath, 'utf8').trim().split('\n').filter(Boolean);
    const slice = lines.slice(-limit);
    return slice.map((line) => {
      try { return JSON.parse(line); } catch { return { type: 'corrupt', raw: line.slice(0, 200) }; }
    });
  }

  saveSnapshot(name, data) {
    this.ensureDirs();
    const file = path.join(this.snapshotsDir, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify({ saved_at: new Date().toISOString(), data }, null, 2));
    return file;
  }

  loadSnapshot(name) {
    const file = path.join(this.snapshotsDir, `${name}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
}

module.exports = { EvolutionMemory };
