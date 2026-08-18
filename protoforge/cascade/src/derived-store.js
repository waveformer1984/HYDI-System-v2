const fs = require('fs');
const path = require('path');

class DerivedStore {
  constructor(options = {}) {
    this.dataDir = options.dataDir || path.join(__dirname, '..', 'data');
    this.file = path.join(this.dataDir, 'derived-events.json');
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.events = this._load();
    this.byFingerprint = new Map(this.events.map(e => [e.fingerprint, e]));
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf-8');
      return raw.trim() ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  _save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.events, null, 2));
    if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
    fs.renameSync(tmp, this.file);
  }

  _existing(derived) {
    return this.byFingerprint.get(derived.fingerprint);
  }

  add(derived) {
    if (this._existing(derived)) {
      return { ok: true, event: this._existing(derived), isNew: false };
    }

    this.events.push(derived);
    this.byFingerprint.set(derived.fingerprint, derived);

    if (derived.parentFingerprint) {
      const parent = this.byFingerprint.get(derived.parentFingerprint);
      if (parent && !parent.children.includes(derived.fingerprint)) {
        parent.children.push(derived.fingerprint);
      }
    }

    this._save();
    return { ok: true, event: derived, isNew: true };
  }

  get(id) {
    const fp = id.startsWith('cascade:') ? id.slice(8) : id;
    const e = this.byFingerprint.get(fp);
    if (!e) return { ok: false, error: 'Not found', code: '404' };
    return { ok: true, event: e };
  }

  getByFingerprint(fingerprint) {
    return this.get(fingerprint);
  }

  list(options = {}) {
    let events = this.events.slice();
    if (options.eventType) {
      events = events.filter(e => e.eventType === options.eventType);
    }
    if (options.source) {
      events = events.filter(e => e.source === options.source);
    }
    const offset = Math.max(0, parseInt(options.offset, 10) || 0);
    const limit = Math.min(1000, Math.max(1, parseInt(options.limit, 10) || 100));
    return {
      ok: true,
      events: events.slice(offset, offset + limit),
      total: events.length,
      offset,
      limit,
      hasMore: offset + limit < events.length
    };
  }

  count() {
    return this.events.length;
  }
}

class LineageGraph {
  constructor(store) {
    this.store = store;
  }

  getChildren(fingerprint) {
    const e = this.store.byFingerprint.get(fingerprint);
    if (!e) return [];
    return e.children.slice();
  }

  getDescendants(fingerprint) {
    const result = [];
    const queue = this.getChildren(fingerprint);
    const seen = new Set([fingerprint]);
    while (queue.length) {
      const fp = queue.shift();
      if (fp === fingerprint || seen.has(fp)) continue;
      seen.add(fp);
      const e = this.store.byFingerprint.get(fp);
      if (!e) continue;
      result.push(e);
      queue.push(...e.children);
    }
    return result;
  }

  getAncestors(fingerprint) {
    const result = [];
    let current = this.store.byFingerprint.get(fingerprint);
    const seen = new Set();
    while (current && current.parentFingerprint) {
      if (current.parentFingerprint === fingerprint || seen.has(current.parentFingerprint)) break;
      const parent = this.store.byFingerprint.get(current.parentFingerprint);
      if (!parent) break;
      seen.add(parent.fingerprint);
      result.push(parent);
      current = parent;
    }
    return result;
  }

  getLineage(fingerprint) {
    const event = this.store.byFingerprint.get(fingerprint);
    if (!event) return { ok: false, error: 'Not found', code: '404' };
    return {
      ok: true,
      event,
      children: this.getChildren(fingerprint),
      descendants: this.getDescendants(fingerprint).map(e => e.fingerprint),
      ancestors: this.getAncestors(fingerprint).map(e => e.fingerprint)
    };
  }
}

module.exports = { DerivedStore, LineageGraph };
