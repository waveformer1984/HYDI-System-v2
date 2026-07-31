'use strict';

const fs = require('fs').promises;
const path = require('path');

/**
 * RuntimeTelemetry captures a structured record for every intelligence
 * execution in the V3 AI layer. It is intentionally simple: one append-only
 * JSONL file per session so telemetry stays local, auditable, and cheap.
 */
class RuntimeTelemetry {
  constructor(config = {}) {
    this.dataPath = config.dataPath || path.resolve(__dirname, '../../data');
    this.storeFile = config.storeFile || 'runtime-telemetry.jsonl';
    this.storePath = path.join(this.dataPath, this.storeFile);
    this.logger = config.logger || console;
    this.buffer = [];
    this.flushIntervalMs = config.flushIntervalMs || 1000;
    this._timer = null;
  }

  async start() {
    await fs.mkdir(this.dataPath, { recursive: true });
    this._timer = setInterval(() => this._flush(), this.flushIntervalMs);
    if (this._timer.unref) this._timer.unref();
    return this;
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    return this._flush();
  }

  record(event) {
    const entry = {
      at: Date.now(),
      task: event.task || 'unknown',
      selectedAgent: event.selectedAgent || null,
      selectedModel: event.selectedModel || null,
      reasoning: event.reasoning || null,
      confidence: typeof event.confidence === 'number' ? event.confidence : null,
      latency: typeof event.latency === 'number' ? event.latency : null,
      outcome: event.outcome || null,
      fallbackUsed: event.fallbackUsed === true,
      meta: event.meta || {},
    };
    this.buffer.push(entry);
    if (this.buffer.length > 100) this._flush();
    return entry;
  }

  async _flush() {
    if (this.buffer.length === 0) return;
    const lines = this.buffer.splice(0).map((e) => JSON.stringify(e)).join('\n') + '\n';
    try {
      await fs.appendFile(this.storePath, lines, 'utf8');
    } catch (e) {
      this.logger.error('[RuntimeTelemetry] flush failed', e instanceof Error ? e.message : String(e));
    }
  }

  async read(limit = 1000) {
    try {
      const text = await fs.readFile(this.storePath, 'utf8');
      return text.split('\n').filter(Boolean).slice(-limit).map((line) => JSON.parse(line));
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  }

  summary() {
    const total = this.buffer.length; // plus persisted? For now simple.
    return { total, storePath: this.storePath };
  }
}

module.exports = RuntimeTelemetry;
