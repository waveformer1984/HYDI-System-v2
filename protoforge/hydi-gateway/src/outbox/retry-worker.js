class RetryWorker {
  constructor(outbox, deliver, options = {}) {
    this.outbox = outbox;
    this.deliver = deliver;
    this.intervalMs = options.intervalMs || 5000;
    this.running = false;
    this._timer = null;
    this.stats = {
      attempts: 0,
      successes: 0,
      failures: 0,
      lastRun: null,
      lastError: null
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._tick();
    this._timer = setInterval(() => this._tick(), this.intervalMs);
  }

  stop() {
    this.running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async _tick() {
    this.stats.lastRun = new Date().toISOString();
    const ready = this.outbox.pending();
    for (const item of ready) {
      this.stats.attempts += 1;
      try {
        const result = await this.deliver(item.event);
        if (result.ok) {
          this.outbox.markSuccess(item.fingerprint);
          this.stats.successes += 1;
        } else {
          this.outbox.markFailure(item.fingerprint, new Error(result.error || 'delivery failed'));
          this.stats.failures += 1;
        }
      } catch (err) {
        this.outbox.markFailure(item.fingerprint, err);
        this.stats.failures += 1;
        this.stats.lastError = err.message;
      }
    }
  }
}

module.exports = { RetryWorker };
