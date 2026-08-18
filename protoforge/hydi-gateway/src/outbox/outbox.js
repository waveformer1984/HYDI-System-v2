const fs = require('fs');
const path = require('path');

const DEFAULT_BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 60 * 1000;

class Outbox {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.join(process.cwd(), 'data', 'outbox');
    this.file = path.join(this.dataDir, 'pending.json');
    this.baseDelayMs = options.baseDelayMs || DEFAULT_BASE_DELAY_MS;
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (!fs.existsSync(this.file)) {
      this._save([]);
    }
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf-8');
      return raw.trim() ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  _save(items) {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(items, null, 2));
    if (fs.existsSync(this.file)) {
      fs.unlinkSync(this.file);
    }
    fs.renameSync(tmp, this.file);
  }

  _now() {
    return Date.now();
  }

  _nextDelay(attempt) {
    const ms = this.baseDelayMs * Math.pow(2, attempt);
    return Math.min(ms, MAX_DELAY_MS);
  }

  enqueue(event, context = {}) {
    const items = this._load();
    if (items.some(i => i.fingerprint === event.fingerprint)) {
      return { ok: false, error: 'Already in outbox' };
    }
    const item = {
      fingerprint: event.fingerprint,
      event,
      attempt: 0,
      enqueuedAt: this._now(),
      nextAttempt: context.nextAttempt || this._now(),
      lastAttempt: null,
      lastError: null
    };
    items.push(item);
    this._save(items);
    return { ok: true, item };
  }

  pending(now = this._now()) {
    const items = this._load();
    return items
      .filter(i => i.nextAttempt <= now)
      .sort((a, b) => a.nextAttempt - b.nextAttempt);
  }

  peek() {
    const items = this._load().sort((a, b) => a.nextAttempt - b.nextAttempt);
    return items[0] || null;
  }

  list() {
    return this._load().sort((a, b) => a.nextAttempt - b.nextAttempt);
  }

  remove(fingerprint) {
    const items = this._load();
    const filtered = items.filter(i => i.fingerprint !== fingerprint);
    if (filtered.length === items.length) return { ok: false, error: 'Not found' };
    this._save(filtered);
    return { ok: true };
  }

  markFailure(fingerprint, error) {
    const items = this._load();
    const item = items.find(i => i.fingerprint === fingerprint);
    if (!item) return { ok: false, error: 'Not found' };
    item.attempt += 1;
    item.lastAttempt = this._now();
    item.lastError = error ? (error.message || String(error)) : null;
    item.nextAttempt = this._now() + this._nextDelay(item.attempt);
    this._save(items);
    return { ok: true, item };
  }

  markSuccess(fingerprint) {
    return this.remove(fingerprint);
  }

  pendingCount() {
    return this._load().length;
  }

  stats() {
    const items = this._load();
    const now = this._now();
    const ready = items.filter(i => i.nextAttempt <= now).length;
    const oldest = items.length ? items.reduce((min, i) => (i.nextAttempt < min.nextAttempt ? i : min), items[0]) : null;
    return {
      total: items.length,
      ready,
      oldestPendingAt: oldest ? new Date(oldest.nextAttempt).toISOString() : null,
      oldestFingerprint: oldest ? oldest.fingerprint : null
    };
  }
}

module.exports = { Outbox, DEFAULT_BASE_DELAY_MS, MAX_DELAY_MS };
