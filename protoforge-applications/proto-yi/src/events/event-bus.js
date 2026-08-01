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
    this.system = options.system || 'proto-yi';
    this.version = options.version || '1.0';
    this.serviceKey = options.serviceKey || options.hydiServiceKey || process.env.HYDI_SERVICE_KEY;
    this.logger = options.logger || { warn: () => {} };
    this.outbox = [];
    this.healthy = null;
    this.eventTypes = options.eventTypes || [];
  }

  translate(event) {
    return {
      eventId: event.id,
      eventType: event.type,
      source: this.system,
      version: this.version,
      timestamp: event.createdAt,
      payload: event.payload
    };
  }

  async publish(event) {
    if (!this.enabled) return { ok: true, skipped: true };
    if (this.eventTypes.length > 0 && !this.eventTypes.includes(event.type)) return { ok: true, skipped: true };
    this.outbox.push({ id: event.id, event, at: new Date().toISOString() });
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.serviceKey) headers['Authorization'] = `Bearer ${this.serviceKey}`;
      const res = await fetch(`${this.endpoint}/events`, {
        method: 'POST',
        headers,
        body: JSON.stringify(this.translate(event))
      });
      if (!res.ok) throw new Error(`External adapter returned ${res.status}`);
      this.healthy = true;
      const idx = this.outbox.findIndex(e => e.id === event.id);
      if (idx >= 0) this.outbox.splice(idx, 1);
      return { ok: true };
    } catch (err) {
      this.healthy = false;
      this.logger.warn('external', 'publish.failed', err.message, { eventType: event.type });
      return { ok: false, error: err.message };
    }
  }

  async health() {
    if (!this.enabled) return { ok: true, status: 'disabled' };
    try {
      const res = await fetch(`${this.endpoint}/health`, { method: 'GET' });
      this.healthy = res.ok;
      return { ok: res.ok, status: res.ok ? 'healthy' : 'unhealthy', outbox: this.outbox.length };
    } catch (err) {
      this.healthy = false;
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
