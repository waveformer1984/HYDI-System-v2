const fs = require('fs');
const path = require('path');

class Ledger {
  constructor(config) {
    this.ledgerPath = config.ledgerPath;
    fs.mkdirSync(path.dirname(this.ledgerPath), { recursive: true });
    if (!fs.existsSync(this.ledgerPath)) {
      this._save([]);
    }
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.ledgerPath, 'utf-8');
      return raw.trim() ? JSON.parse(raw) : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  _save(records) {
    const tmp = `${this.ledgerPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(records, null, 2));
    if (fs.existsSync(this.ledgerPath)) {
      fs.unlinkSync(this.ledgerPath);
    }
    fs.renameSync(tmp, this.ledgerPath);
  }

  append(record) {
    const records = this._load();
    const enriched = {
      ...record,
      receivedAt: new Date().toISOString()
    };
    records.push(enriched);
    this._save(records);
    return enriched;
  }

  list(options = {}) {
    const records = this._load();
    let result = records;

    if (options.eventType) {
      result = result.filter(r => r.eventType === options.eventType);
    }
    if (options.source) {
      result = result.filter(r => r.source === options.source);
    }
    if (options.since) {
      const since = Date.parse(options.since);
      result = result.filter(r => Date.parse(r.timestamp || r.receivedAt) >= since);
    }
    if (options.until) {
      const until = Date.parse(options.until);
      result = result.filter(r => Date.parse(r.timestamp || r.receivedAt) <= until);
    }

    const offset = Math.max(0, parseInt(options.offset, 10) || 0);
    const limit = Math.min(1000, Math.max(1, parseInt(options.limit, 10) || 100));

    return {
      events: result.slice(offset, offset + limit),
      total: result.length,
      offset,
      limit,
      hasMore: offset + limit < result.length
    };
  }

  get(eventId) {
    const records = this._load();
    return records.find(r => r.eventId === eventId) || null;
  }

  count() {
    return this._load().length;
  }
}

module.exports = { Ledger };
