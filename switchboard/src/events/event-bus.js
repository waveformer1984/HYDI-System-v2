const crypto = require('crypto');
const fs = require('fs');

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
    listeners.forEach(fn => {
      try { fn(event); } catch (err) { console.error(`Event listener error for ${type}:`, err.message); }
    });
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
      this.events = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch { this.events = []; }
  }
  handle(event) { this.events.push(event); this.flush(); }
  flush() { fs.writeFileSync(this.filePath, JSON.stringify(this.events, null, 2)); }
  all() { return this.events.slice(); }
}

class HydiAdapter {
  constructor(options) { this.options = options; }
  handle(event) {
    // Translate Switchboard domain events into whatever envelope HYDI consumes.
    // This adapter does not mutate state and does not throw.
    if (this.options && typeof this.options.onEvent === 'function') {
      this.options.onEvent(event);
    }
  }
}

module.exports = { EventBus, MemoryTransport, FileTransport, HydiAdapter };
