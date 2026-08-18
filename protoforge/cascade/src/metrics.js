class Metrics {
  constructor() {
    this.eventsProcessed = 0;
    this.duplicatesIgnored = 0;
    this.validationFailures = 0;
    this.processingLatencyTotalMs = 0;
    this.replayProgress = 0;
    this.replayDurationMs = 0;
    this.lastReplayAt = null;
  }

  recordProcessed(latencyMs) {
    this.eventsProcessed += 1;
    this.processingLatencyTotalMs += latencyMs;
  }

  recordDuplicate() {
    this.duplicatesIgnored += 1;
  }

  recordValidationFailure() {
    this.validationFailures += 1;
  }

  startReplay(total) {
    this._replayStart = Date.now();
    this._replayTotal = total;
    this.replayProgress = 0;
  }

  advanceReplay() {
    this.replayProgress = this._replayTotal
      ? Math.min(100, Math.round((this.eventsProcessed / this._replayTotal) * 100))
      : 0;
  }

  endReplay() {
    this.replayDurationMs = this._replayStart ? Date.now() - this._replayStart : 0;
    this.lastReplayAt = new Date().toISOString();
  }

  avgLatencyMs() {
    return this.eventsProcessed ? this.processingLatencyTotalMs / this.eventsProcessed : 0;
  }

  snapshot() {
    return {
      eventsProcessed: this.eventsProcessed,
      processingLatencyMs: this.processingLatencyTotalMs,
      averageLatencyMs: this.avgLatencyMs(),
      replayProgress: this.replayProgress,
      replayDurationMs: this.replayDurationMs,
      duplicatesIgnored: this.duplicatesIgnored,
      validationFailures: this.validationFailures,
      lastReplayAt: this.lastReplayAt
    };
  }
}

module.exports = { Metrics };
