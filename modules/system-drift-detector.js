// System Drift Detector - Detects deviations from expected system behavior
// Triggers SYSTEM_DRIFT_DETECTED when metrics deviate >15% from baseline

const EventEmitter = require('events');

class SystemDriftDetector extends EventEmitter {
  constructor() {
    super();
    
    // Drift detection configuration
    this.config = {
      deviationThreshold: 0.15,    // 15% deviation triggers alert
      baselineWindow: 300,        // 5 minutes to establish baseline
      evaluationWindow: 60,       // 1 minute windows for evaluation
      minDataPoints: 10,          // Minimum data points before detection
      alertCooldown: 300000       // 5 minutes between same type alerts
    };
    
    // Metrics tracking
    this.metrics = {
      eventThroughput: [],
      classificationDistribution: [],
      errorRates: [],
      repairFrequency: [],
      quarantineGrowth: [],
      responseTimes: []
    };
    
    // Baselines
    this.baselines = {
      eventThroughput: null,
      classificationDistribution: null,
      errorRate: null,
      repairFrequency: null,
      quarantineGrowthRate: null,
      averageResponseTime: null
    };
    
    // Alert tracking
    this.lastAlerts = new Map();
    this.activeDrifts = new Map();
    
    // Statistics
    this.stats = {
      driftsDetected: 0,
      falsePositives: 0,
      truePositives: 0,
      alertsByType: {}
    };
    
    console.log('[DRIFT DETECTOR] Initialized - 15% deviation threshold');
  }

  // Add metric data point
  addMetric(metricType, value, timestamp = Date.now()) {
    if (!this.metrics[metricType]) {
      console.warn(`[DRIFT DETECTOR] Unknown metric type: ${metricType}`);
      return;
    }
    
    // Add data point
    this.metrics[metricType].push({
      timestamp: timestamp,
      value: value
    });
    
    // Clean old data (keep last hour)
    const oneHourAgo = timestamp - (60 * 60 * 1000);
    this.metrics[metricType] = this.metrics[metricType].filter(
      point => point.timestamp > oneHourAgo
    );
    
    // Update baseline if needed
    this.updateBaseline(metricType);
    
    // Check for drift
    this.checkForDrift(metricType);
  }

  // Update baseline for metric
  updateBaseline(metricType) {
    const data = this.metrics[metricType];
    
    // Need minimum data points
    if (data.length < this.config.minDataPoints) return;
    
    // Use recent data for baseline
    const recentData = data.slice(-this.config.baselineWindow);
    
    switch (metricType) {
      case 'eventThroughput':
        this.baselines.eventThroughput = this.calculateBaselineStats(recentData.map(d => d.value));
        break;
        
      case 'errorRates':
        this.baselines.errorRate = this.calculateBaselineStats(recentData.map(d => d.value));
        break;
        
      case 'repairFrequency':
        this.baselines.repairFrequency = this.calculateBaselineStats(recentData.map(d => d.value));
        break;
        
      case 'quarantineGrowth':
        this.baselines.quarantineGrowthRate = this.calculateBaselineStats(recentData.map(d => d.value));
        break;
        
      case 'responseTimes':
        this.baselines.averageResponseTime = this.calculateBaselineStats(recentData.map(d => d.value));
        break;
        
      case 'classificationDistribution':
        this.baselines.classificationDistribution = this.calculateDistributionBaseline(recentData);
        break;
    }
  }

  // Calculate baseline statistics
  calculateBaselineStats(values) {
    const sorted = values.sort((a, b) => a - b);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const stdDev = Math.sqrt(
      values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length
    );
    
    return {
      mean: mean,
      median: median,
      stdDev: stdDev,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }

  // Calculate distribution baseline
  calculateDistributionBaseline(dataPoints) {
    // Aggregate all classification keys
    const allKeys = new Set();
    dataPoints.forEach(point => {
      if (point.value && typeof point.value === 'object') {
        Object.keys(point.value).forEach(key => allKeys.add(key));
      }
    });
    
    // Calculate average distribution
    const baseline = {};
    allKeys.forEach(key => {
      const values = dataPoints
        .map(p => p.value[key] || 0)
        .filter(v => v > 0);
      
      if (values.length > 0) {
        baseline[key] = {
          mean: values.reduce((a, b) => a + b, 0) / values.length,
          stdDev: Math.sqrt(
            values.reduce((sum, val) => {
              const mean = values.reduce((a, b) => a + b, 0) / values.length;
              return sum + Math.pow(val - mean, 2);
            }, 0) / values.length
          )
        };
      }
    });
    
    return baseline;
  }

  // Check for drift in specific metric
  checkForDrift(metricType) {
    const data = this.metrics[metricType];
    const baseline = this.baselines[this.getBaselineKey(metricType)];
    
    if (!baseline || data.length < this.config.evaluationWindow) return;
    
    // Get recent data for evaluation
    const recentData = data.slice(-this.config.evaluationWindow);
    const now = Date.now();
    
    switch (metricType) {
      case 'eventThroughput':
        this.checkValueDrift('event_throughput', recentData, baseline, now);
        break;
        
      case 'errorRates':
        this.checkValueDrift('error_rate', recentData, baseline, now);
        break;
        
      case 'repairFrequency':
        this.checkValueDrift('repair_frequency', recentData, baseline, now);
        break;
        
      case 'quarantineGrowth':
        this.checkValueDrift('quarantine_growth', recentData, baseline, now);
        break;
        
      case 'responseTimes':
        this.checkValueDrift('response_time', recentData, baseline, now);
        break;
        
      case 'classificationDistribution':
        this.checkDistributionDrift('classification_distribution', recentData, baseline, now);
        break;
    }
  }

  // Check for value drift
  checkValueDrift(driftType, data, baseline, now) {
    const recentValues = data.map(d => d.value);
    const recentMean = recentValues.reduce((a, b) => a + b, 0) / recentValues.length;
    
    // Calculate deviation
    const deviation = Math.abs(recentMean - baseline.mean) / baseline.mean;
    
    if (deviation > this.config.deviationThreshold) {
      // Check cooldown
      const lastAlert = this.lastAlerts.get(driftType);
      if (lastAlert && (now - lastAlert) < this.config.alertCooldown) {
        return; // Still in cooldown
      }
      
      // Determine drift direction
      const direction = recentMean > baseline.mean ? 'increase' : 'decrease';
      
      // Create drift alert
      const drift = {
        type: driftType.toUpperCase() + '_DRIFT',
        detected_at: new Date().toISOString(),
        severity: this.calculateSeverity(deviation),
        metric: driftType,
        current_value: recentMean,
        baseline_value: baseline.mean,
        deviation: (deviation * 100).toFixed(2) + '%',
        direction: direction,
        data_points: recentValues.length,
        statistical_significance: this.calculateStatisticalSignificance(recentValues, baseline)
      };
      
      // Emit alert
      this.emitDriftAlert(drift);
    }
  }

  // Check for distribution drift
  checkDistributionDrift(driftType, data, baseline, now) {
    if (data.length === 0) return;
    
    // Get most recent distribution
    const latestDistribution = data[data.length - 1].value;
    if (!latestDistribution) return;
    
    const drifts = [];
    
    // Check each classification
    Object.keys(baseline).forEach(classification => {
      const current = latestDistribution[classification] || 0;
      const baselineMean = baseline[classification].mean;
      
      if (baselineMean > 0) {
        const deviation = Math.abs(current - baselineMean) / baselineMean;
        
        if (deviation > this.config.deviationThreshold) {
          drifts.push({
            classification: classification,
            current: current,
            baseline: baselineMean,
            deviation: (deviation * 100).toFixed(2) + '%'
          });
        }
      }
    });
    
    if (drifts.length > 0) {
      // Check cooldown
      const lastAlert = this.lastAlerts.get(driftType);
      if (lastAlert && (now - lastAlert) < this.config.alertCooldown) {
        return;
      }
      
      // Create drift alert
      const drift = {
        type: driftType.toUpperCase() + '_DRIFT',
        detected_at: new Date().toISOString(),
        severity: 'medium', // Distribution drifts are usually medium severity
        metric: driftType,
        details: drifts,
        total_classifications: Object.keys(latestDistribution).length
      };
      
      this.emitDriftAlert(drift);
    }
  }

  // Calculate drift severity
  calculateSeverity(deviation) {
    if (deviation > 0.5) return 'critical';
    if (deviation > 0.3) return 'high';
    if (deviation > 0.2) return 'medium';
    return 'low';
  }

  // Calculate statistical significance (simplified)
  calculateStatisticalSignificance(values, baseline) {
    // Simple Z-score calculation
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const zScore = Math.abs(mean - baseline.mean) / baseline.stdDev;
    
    return {
      z_score: zScore.toFixed(2),
      confidence: zScore > 2 ? 'high' : zScore > 1.5 ? 'medium' : 'low'
    };
  }

  // Emit drift alert
  emitDriftAlert(drift) {
    // Update tracking
    this.lastAlerts.set(drift.metric, Date.now());
    this.activeDrifts.set(drift.metric, drift);
    this.stats.driftsDetected++;
    this.stats.alertsByType[drift.type] = (this.stats.alertsByType[drift.type] || 0) + 1;
    
    // Log alert
    console.log(`[DRIFT DETECTOR] ${drift.type}: ${drift.deviation} deviation`);
    
    // Emit event
    this.emit('SYSTEM_DRIFT_DETECTED', drift);
  }

  // Get baseline key for metric
  getBaselineKey(metricType) {
    const keyMap = {
      'eventThroughput': 'eventThroughput',
      'errorRates': 'errorRate',
      'repairFrequency': 'repairFrequency',
      'quarantineGrowth': 'quarantineGrowthRate',
      'responseTimes': 'averageResponseTime',
      'classificationDistribution': 'classificationDistribution'
    };
    
    return keyMap[metricType] || metricType;
  }

  // Get drift detector status
  getStatus() {
    return {
      config: this.config,
      baselines: this.baselines,
      active_drifts: Array.from(this.activeDrifts.values()),
      metrics_tracking: Object.keys(this.metrics).map(key => ({
        metric: key,
        data_points: this.metrics[key].length,
        has_baseline: !!this.baselines[this.getBaselineKey(key)]
      })),
      statistics: this.stats
    };
  }

  // Acknowledge drift (mark as resolved)
  acknowledgeDrift(driftType) {
    if (this.activeDrifts.has(driftType)) {
      const drift = this.activeDrifts.get(driftType);
      drift.acknowledged_at = new Date().toISOString();
      drift.status = 'acknowledged';
      
      this.activeDrifts.delete(driftType);
      
      console.log(`[DRIFT DETECTOR] Drift acknowledged: ${driftType}`);
      
      return drift;
    }
    
    return null;
  }

  // Reset drift detector
  reset() {
    // Clear all metrics
    Object.keys(this.metrics).forEach(key => {
      this.metrics[key] = [];
    });
    
    // Clear baselines
    Object.keys(this.baselines).forEach(key => {
      this.baselines[key] = null;
    });
    
    // Clear alerts
    this.lastAlerts.clear();
    this.activeDrifts.clear();
    
    // Reset stats
    this.stats = {
      driftsDetected: 0,
      falsePositives: 0,
      truePositives: 0,
      alertsByType: {}
    };
    
    console.log('[DRIFT DETECTOR] Reset complete');
  }
}

// Create singleton instance
const driftDetector = new SystemDriftDetector();

// Export the drift detector
module.exports = driftDetector;
