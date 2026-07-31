const crypto = require('crypto');

class EventBus {
  constructor(transports = []) {
    this.transports = transports;
    this.handlers = new Map();
  }

  emit(type, payload, meta = {}) {
    const event = {
      id: crypto.randomUUID(),
      type,
      payload,
      meta,
      createdAt: new Date().toISOString()
    };
    this.transports.forEach(t => t.handle(event));
    const listeners = this.handlers.get(type) || [];
    listeners.forEach(fn => { try { fn(event); } catch (err) { /* no throw */ } });
    return event;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const listeners = this.handlers.get(type) || [];
    this.handlers.set(type, listeners.filter(f => f !== fn));
  }
}

class MemoryTransport {
  constructor() { this.events = []; }
  handle(event) { this.events.push(event); }
  all() { return this.events.slice(); }
  ofType(type) { return this.events.filter(e => e.type === type); }
  reset() { this.events = []; }
}

class FileTransport {
  constructor(filePath) {
    this.filePath = filePath;
    this.events = [];
    try {
      this.events = JSON.parse(require('fs').readFileSync(filePath, 'utf8'));
    } catch { this.events = []; }
  }
  handle(event) { this.events.push(event); this.flush(); }
  flush() {
    const fs = require('fs');
    const path = require('path');
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.events, null, 2));
  }
  all() { return this.events.slice(); }
}

class ExternalAdapter {
  constructor(options = {}) {
    this.endpoint = (options.endpoint || '').replace(/\/$/, '');
    this.enabled = Boolean(options.endpoint) && options.enabled !== false;
    this.system = options.system || 'resonate';
    this.version = options.version || '1.0';
    this.logger = options.logger || { warn: () => {} };
    this.outbox = [];
  }

  translate(event) {
    return {
      system: this.system,
      event: event.type,
      version: this.version,
      id: event.id,
      createdAt: event.createdAt,
      data: { ...event.payload, _meta: { ...event.meta } }
    };
  }

  async publish(event) {
    if (!this.enabled) return { ok: true, skipped: true };
    this.outbox.push({ id: event.id, event, at: new Date().toISOString() });
    try {
      const res = await fetch(`${this.endpoint}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.translate(event))
      });
      if (!res.ok) throw new Error(`External adapter returned ${res.status}`);
      const idx = this.outbox.findIndex(e => e.id === event.id);
      if (idx >= 0) this.outbox.splice(idx, 1);
      return { ok: true };
    } catch (err) {
      this.logger.warn('external', 'publish.failed', err.message, { eventType: event.type });
      return { ok: false, error: err.message };
    }
  }

  async health() {
    if (!this.enabled) return { ok: true, status: 'disabled' };
    try {
      const res = await fetch(`${this.endpoint}/health`, { method: 'GET' });
      return { ok: res.ok, status: res.ok ? 'healthy' : 'unhealthy', outbox: this.outbox.length };
    } catch (err) {
      return { ok: false, status: 'unreachable', outbox: this.outbox.length, error: err.message };
    }
  }

  handle(event) {
    if (!this.enabled) return;
    this.publish(event).catch(() => {});
  }

  subscribe(handler) { this.onEvent = handler; }
}

module.exports = { EventBus, MemoryTransport, FileTransport, ExternalAdapter };
