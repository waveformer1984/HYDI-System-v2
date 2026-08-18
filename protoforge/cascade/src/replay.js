class ReplayEngine {
  constructor({ ledger, processor, store, metrics }) {
    this.ledger = ledger;
    this.processor = processor;
    this.store = store;
    this.metrics = metrics;
    this.lastFingerprint = null;
  }

  async replay(options = {}) {
    const query = {
      eventType: options.eventType,
      limit: options.limit,
      offset: options.offset
    };

    if (options.from && options.from !== 'beginning') {
      const { ok, event } = await this.ledger.get(options.from);
      if (!ok) return { ok: false, error: `from fingerprint not found: ${options.from}` };
      query.since = event.created_at;
    } else if (options.fromTimestamp) {
      query.since = options.fromTimestamp;
    }

    const list = await this.ledger.list(query);
    if (!list.ok) return { ok: false, error: list.error };

    this.metrics.startReplay(list.total);
    const start = Date.now();
    let processed = 0;
    let duplicates = 0;
    let failures = 0;

    for (const raw of list.events) {
      const t0 = Date.now();
      const p = this.processor.process(raw);
      if (!p.ok) {
        this.metrics.recordValidationFailure();
        failures += 1;
        continue;
      }
      const added = this.store.add(p.event);
      if (!added.isNew) {
        this.metrics.recordDuplicate();
        duplicates += 1;
      } else {
        this.metrics.recordProcessed(Date.now() - t0);
        processed += 1;
        this.lastFingerprint = p.event.fingerprint;
      }
      this.metrics.advanceReplay();
    }

    this.metrics.endReplay();
    return {
      ok: true,
      processed,
      duplicates,
      failures,
      total: list.total,
      durationMs: Date.now() - start,
      lastFingerprint: this.lastFingerprint
    };
  }
}

module.exports = { ReplayEngine };
