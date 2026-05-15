/**
 * Ursula Forecast Engine — Predictive Health Intelligence
 *
 * Upgrades Ursula from reactive reporter to proactive forecaster.
 * Ursula records health snapshots over time, computes trends via
 * linear regression, and predicts whether metrics will breach
 * thresholds in the next N hours — alerting before they do.
 *
 * Usage:
 *   const ursula = new UrsullaForecast();
 *   ursula.record({ jobsFailed: 3, eventsLastHour: 42, queueDepth: 15 });
 *   const forecast = ursula.forecast(6);  // predict 6 hours ahead
 *   const briefing = ursula.generateBriefing();
 */

const THRESHOLDS = {
  jobsFailed: { warn: 5, critical: 20 },
  queueDepth: { warn: 50, critical: 200 },
  errorRate: { warn: 0.05, critical: 0.20 },   // fraction 0-1
  latencyMs: { warn: 2000, critical: 8000 },
};

const WINDOW_SIZES = { short: 5, medium: 15, long: 60 }; // minutes

class UrsulaForecast {
  constructor(config = {}) {
    this.snapshots = [];                              // { ts, metrics }
    this.maxHistory = config.maxHistory || 1440;     // 24h at 1/min
    this.thresholds = { ...THRESHOLDS, ...(config.thresholds || {}) };
  }

  // ─── Data Ingestion ───────────────────────────────────────────────────────

  record(metrics) {
    this.snapshots.push({ ts: Date.now(), metrics: { ...metrics } });
    if (this.snapshots.length > this.maxHistory) {
      this.snapshots.shift();
    }
    return this;
  }

  // ─── Trend Analysis ───────────────────────────────────────────────────────

  /**
   * Compute linear trend for a single metric over the last `windowMinutes`.
   * Returns { slope, lastValue, trend: 'improving'|'stable'|'degrading'|'critical' }
   */
  trendFor(metricName, windowMinutes = WINDOW_SIZES.medium) {
    const cutoff = Date.now() - windowMinutes * 60_000;
    const points = this.snapshots
      .filter(s => s.ts >= cutoff && s.metrics[metricName] !== undefined)
      .map(s => ({ x: s.ts, y: s.metrics[metricName] }));

    if (points.length < 2) {
      return { slope: 0, lastValue: points[0]?.y ?? null, trend: 'unknown', points: points.length };
    }

    const slope = this._linReg(points);
    const lastValue = points[points.length - 1].y;
    const threshold = this.thresholds[metricName];

    let trend = 'stable';
    if (threshold) {
      if (lastValue >= threshold.critical) trend = 'critical';
      else if (lastValue >= threshold.warn && slope > 0) trend = 'degrading';
      else if (lastValue < threshold.warn && slope < 0) trend = 'improving';
      else if (slope > 0) trend = 'degrading';
    } else {
      trend = slope > 0.01 ? 'degrading' : slope < -0.01 ? 'improving' : 'stable';
    }

    return { slope, lastValue, trend, points: points.length };
  }

  // ─── Forecasting ──────────────────────────────────────────────────────────

  /**
   * Predict metric values `hoursAhead` from now using current trends.
   * Returns array of { metric, predictedValue, willBreachWarn, willBreachCritical }
   */
  forecast(hoursAhead = 6) {
    const futureMs = hoursAhead * 3600_000;
    const results = [];

    for (const [metric, threshold] of Object.entries(this.thresholds)) {
      const { slope, lastValue } = this.trendFor(metric, WINDOW_SIZES.long);
      if (lastValue === null) continue;

      const predicted = lastValue + slope * futureMs;
      results.push({
        metric,
        currentValue: lastValue,
        predictedValue: Math.max(0, predicted),
        willBreachWarn: predicted >= threshold.warn && lastValue < threshold.warn,
        willBreachCritical: predicted >= threshold.critical && lastValue < threshold.critical,
        hoursAhead,
      });
    }

    return results;
  }

  // ─── Alerts ───────────────────────────────────────────────────────────────

  /**
   * Return proactive alerts: issues that haven't happened yet but will
   * based on current trajectory.
   */
  getProactiveAlerts(hoursAhead = 4) {
    return this.forecast(hoursAhead)
      .filter(f => f.willBreachWarn || f.willBreachCritical)
      .map(f => ({
        severity: f.willBreachCritical ? 'critical' : 'warning',
        metric: f.metric,
        message: `${f.metric} on track to breach ${f.willBreachCritical ? 'critical' : 'warning'} threshold in ~${hoursAhead}h (now: ${f.currentValue?.toFixed(1)}, forecast: ${f.predictedValue?.toFixed(1)})`,
      }));
  }

  getCurrentAlerts() {
    const alerts = [];
    for (const [metric, threshold] of Object.entries(this.thresholds)) {
      const { lastValue } = this.trendFor(metric, WINDOW_SIZES.short);
      if (lastValue === null) continue;
      if (lastValue >= threshold.critical) {
        alerts.push({ severity: 'critical', metric, value: lastValue, threshold: threshold.critical });
      } else if (lastValue >= threshold.warn) {
        alerts.push({ severity: 'warning', metric, value: lastValue, threshold: threshold.warn });
      }
    }
    return alerts;
  }

  // ─── Briefing ─────────────────────────────────────────────────────────────

  /**
   * Generate a natural-language health briefing for the operator.
   */
  generateBriefing() {
    const currentAlerts = this.getCurrentAlerts();
    const proactive = this.getProactiveAlerts(6);
    const snapshotCount = this.snapshots.length;

    if (snapshotCount === 0) {
      return 'No health data recorded yet. Call ursula.record(metrics) to start tracking.';
    }

    const lines = ['--- Ursula Health Briefing ---'];

    if (currentAlerts.length === 0) {
      lines.push('All monitored metrics are within normal range.');
    } else {
      lines.push(`Active alerts (${currentAlerts.length}):`);
      for (const a of currentAlerts) {
        const icon = a.severity === 'critical' ? '[CRIT]' : '[WARN]';
        lines.push(`  ${icon} ${a.metric}: ${a.value} (threshold: ${a.threshold})`);
      }
    }

    if (proactive.length > 0) {
      lines.push(`Forecast alerts for next 6h (${proactive.length}):`);
      for (const a of proactive) {
        lines.push(`  [FORECAST] ${a.message}`);
      }
    } else {
      lines.push('No forecast alerts — system trajectory looks stable for next 6h.');
    }

    const trackedMetrics = Object.keys(this.thresholds)
      .map(m => {
        const { trend, lastValue } = this.trendFor(m, WINDOW_SIZES.medium);
        return lastValue !== null ? `${m}: ${lastValue?.toFixed ? lastValue.toFixed(1) : lastValue} (${trend})` : null;
      })
      .filter(Boolean);

    if (trackedMetrics.length) {
      lines.push('Metric trends (15min): ' + trackedMetrics.join(' | '));
    }

    lines.push(`History: ${snapshotCount} snapshots`);
    return lines.join('\n');
  }

  getSnapshot() {
    return {
      dataPoints: this.snapshots.length,
      currentAlerts: this.getCurrentAlerts(),
      proactiveAlerts: this.getProactiveAlerts(6),
      trends: Object.keys(this.thresholds).reduce((acc, m) => {
        const t = this.trendFor(m, WINDOW_SIZES.medium);
        if (t.lastValue !== null) acc[m] = t;
        return acc;
      }, {}),
    };
  }

  // ─── Math ─────────────────────────────────────────────────────────────────

  _linReg(points) {
    const n = points.length;
    const meanX = points.reduce((s, p) => s + p.x, 0) / n;
    const meanY = points.reduce((s, p) => s + p.y, 0) / n;
    const num = points.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0);
    const den = points.reduce((s, p) => s + Math.pow(p.x - meanX, 2), 0);
    return den === 0 ? 0 : num / den; // slope in units/ms
  }
}

module.exports = UrsulaForecast;
