'use strict';

const fs = require('fs').promises;
const path = require('path');

class BenchmarkDatabase {
  constructor(config = {}) {
    this.dataPath = config.dataPath || path.resolve(__dirname, '../../data');
    this.storeFile = config.storeFile || 'benchmark-database.jsonl';
    this.storePath = path.join(this.dataPath, this.storeFile);
    this.logger = config.logger || console;
    this._cache = null;
  }

  async start() {
    await fs.mkdir(this.dataPath, { recursive: true });
    return this;
  }

  async record(record) {
    const entry = {
      at: Date.now(),
      provider: record.provider || 'unknown',
      model: record.model || 'unknown',
      hardwareProfile: record.hardwareProfile || 'default',
      latency: typeof record.latency === 'number' ? record.latency : null,
      throughput: typeof record.throughput === 'number' ? record.throughput : null,
      startupTime: typeof record.startupTime === 'number' ? record.startupTime : null,
      embeddingSpeed: typeof record.embeddingSpeed === 'number' ? record.embeddingSpeed : null,
      meta: record.meta || {},
    };
    const line = JSON.stringify(entry) + '\n';
    await fs.appendFile(this.storePath, line, 'utf8');
    this._cache = null;
    return entry;
  }

  async readAll() {
    if (this._cache) return this._cache;
    let text;
    try {
      text = await fs.readFile(this.storePath, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
    const rows = text.split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    this._cache = rows;
    return rows;
  }

  async history(provider, model) {
    const rows = await this.readAll();
    return rows.filter((r) => (!provider || r.provider === provider) && (!model || r.model === model));
  }

  async compare(providerA, providerB) {
    const rows = await this.readAll();
    const a = rows.filter((r) => r.provider === providerA);
    const b = rows.filter((r) => r.provider === providerB);
    const avg = (arr, key) => arr.length ? arr.reduce((s, r) => s + (r[key] || 0), 0) / arr.length : 0;
    return {
      [providerA]: {
        count: a.length,
        avgLatency: avg(a, 'latency'),
        avgThroughput: avg(a, 'throughput'),
        avgStartupTime: avg(a, 'startupTime'),
        avgEmbeddingSpeed: avg(a, 'embeddingSpeed'),
      },
      [providerB]: {
        count: b.length,
        avgLatency: avg(b, 'latency'),
        avgThroughput: avg(b, 'throughput'),
        avgStartupTime: avg(b, 'startupTime'),
        avgEmbeddingSpeed: avg(b, 'embeddingSpeed'),
      },
    };
  }

  async trendReport(model) {
    const rows = (await this.history(null, model)).sort((a, b) => a.at - b.at);
    if (!rows.length) return null;
    const avg = (arr, key) => arr.reduce((s, r) => s + (r[key] || 0), 0) / arr.length;
    return {
      model,
      samples: rows.length,
      latencyTrend: rows.map((r) => ({ at: r.at, value: r.latency })),
      throughputTrend: rows.map((r) => ({ at: r.at, value: r.throughput })),
      avgLatency: avg(rows, 'latency'),
      avgThroughput: avg(rows, 'throughput'),
      avgStartupTime: avg(rows, 'startupTime'),
    };
  }

  async summary() {
    const rows = await this.readAll();
    const providers = new Set(rows.map((r) => r.provider));
    const models = new Set(rows.map((r) => r.model));
    return {
      totalRecords: rows.length,
      providers: Array.from(providers),
      models: Array.from(models),
      byProvider: Array.from(providers).map((p) => ({ provider: p, records: rows.filter((r) => r.provider === p).length })),
    };
  }
}

module.exports = BenchmarkDatabase;
