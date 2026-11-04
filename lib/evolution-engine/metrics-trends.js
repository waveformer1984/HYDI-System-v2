'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Append-only host/service metrics for trend detection.
 */
class MetricsTrendStore {
  /**
   * @param {{ rootDir?: string }} [opts]
   */
  constructor(opts = {}) {
    this.seriesPath = path.join(opts.rootDir || path.join(process.cwd(), '.runtime', 'evolution'), 'metrics.jsonl');
  }

  append(snapshot) {
    fs.mkdirSync(path.dirname(this.seriesPath), { recursive: true });
    const row = {
      ts: snapshot.ts || new Date().toISOString(),
      host: snapshot.host || null,
      storage: snapshot.storage || null,
      services: snapshot.services || null,
      pipeline: snapshot.pipeline || { status: 'not_measured' },
      memory_retrieval_accuracy: snapshot.memory_retrieval_accuracy ?? 'not_measured',
      task_success_rate: snapshot.task_success_rate ?? 'not_measured',
      inference: snapshot.inference ?? 'not_measured',
    };
    fs.appendFileSync(this.seriesPath, `${JSON.stringify(row)}\n`, 'utf8');
    return row;
  }

  readRecent(limit = 48) {
    if (!fs.existsSync(this.seriesPath)) return [];
    const lines = fs.readFileSync(this.seriesPath, 'utf8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  }
}

module.exports = { MetricsTrendStore };
