// System Observability Layer - Machine-readable global state snapshots
// Provides real-time system truth coherence without human formatting

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

class SystemObservabilityLayer extends EventEmitter {
  constructor() {
    super();
    
    // Global state snapshot
    this.globalState = {
      timestamp: null,
      system_id: 'protoforge_hydi_system',
      version: '1.0.0',
      
      // CASCADE metrics
      cascade: {
        event_throughput: {
          current: 0,           // events/sec
          average_1m: 0,        // 1-minute average
          average_5m: 0,        // 5-minute average
          peak: 0               // peak in last hour
        },
        classification_distribution: {
          INFRA_FAILURE: 0,
          ROUTE_FAILURE: 0,
          DEPLOYMENT_MISMATCH: 0,
          DATA_INTEGRITY_RISK: 0,
          STREAM_BREAK: 0,
          UNKNOWN_ANOMALY: 0
        },
        quarantine: {
          size: 0,
          growth_rate: 0,       // events/min
          oldest_event: null,
          retry_queue_depth: 0
        },
        emissions: {
          success_rate: 0,      // percentage
          total_sent: 0,
          total_failed: 0,
          pending_count: 0,
          last_confirmed_resolution: null
        }
      },
      
      // KILO metrics
      kilo: {
        repair_manifests_generated: 0,
        repair_success_rate: 0,
        average_repair_time: 0,   // milliseconds
        active_repairs: 0,
        repair_attempts_by_classification: {}
      },
      
      // System health
      system: {
        health: 'unknown',       // healthy | degraded | warning | critical
        uptime: 0,               // seconds
        memory_usage: 0,         // MB
        cpu_usage: 0,            // percentage
        active_connections: 0,
        error_rate: 0,           // errors/minute
        last_restart: null
      },
      
      // Event bus metrics
      event_bus: {
        total_events_processed: 0,
        events_per_second: 0,
        backlog_size: 0,
        subscriber_count: 0,
        average_processing_time: 0 // milliseconds
      }
    };
    
    // Historical data for trend analysis
    this.historicalData = {
      throughput: [],
      errorRates: [],
      classificationRates: [],
      repairRates: []
    };
    
    // Baseline for drift detection
    this.baseline = {
      classification_distribution: null,
      average_throughput: null,
      error_rate_threshold: 0.1,  // 10%
      repair_frequency_threshold: 0.05 // 5%
    };
    
    // Update intervals
    this.updateInterval = null;
    this.updateFrequency = 5000; // 5 seconds
    
    // Persistence
    this.persistenceEnabled = true;
    this.persistencePath = path.join(__dirname, '../data/system-state.json');
    
    this.initialize();
  }

  initialize() {
    console.log('[SYSTEM OBSERVABILITY] Initialized - Machine-readable state tracking');
    
    // Start periodic updates
    this.startPeriodicUpdates();
    
    // Load persisted state
    this.loadPersistedState();
    
    // Calculate baseline after initial data collection
    setTimeout(() => {
      this.calculateBaseline();
    }, 60000); // After 1 minute
  }

  // Start periodic state updates
  startPeriodicUpdates() {
    this.updateInterval = setInterval(() => {
      this.updateGlobalState();
      this.detectDrift();
      this.persistState();
      this.emit('state_updated', this.globalState);
    }, this.updateFrequency);
  }

  // Update global state snapshot
  updateGlobalState() {
    const now = new Date();
    this.globalState.timestamp = now.toISOString();
    
    // Update system metrics
    this.updateSystemMetrics();
    
    // Update CASCADE metrics (would be fetched from CASCADE)
    this.updateCascadeMetrics();
    
    // Update KILO metrics (would be fetched from KILO)
    this.updateKiloMetrics();
    
    // Update event bus metrics
    this.updateEventBusMetrics();
    
    // Store historical data points
    this.storeHistoricalData();
  }

  // Update system metrics
  updateSystemMetrics() {
    const memUsage = process.memoryUsage();
    
    this.globalState.system.memory_usage = Math.round(memUsage.heapUsed / 1024 / 1024); // MB
    this.globalState.system.uptime = Math.round(process.uptime());
    
    // CPU usage would require more complex monitoring
    // For now, simulate
    this.globalState.system.cpu_usage = Math.random() * 20; // Simulated 0-20%
    
    // Calculate overall health
    this.calculateSystemHealth();
  }

  // Update CASCADE metrics
  updateCascadeMetrics() {
    // In real implementation, these would be fetched from CASCADE
    // For now, simulate with realistic values
    
    // Simulate event throughput
    this.globalState.cascade.event_throughput.current = 5 + Math.random() * 10;
    this.globalState.cascade.event_throughput.average_1m = 7.5;
    this.globalState.cascade.event_throughput.average_5m = 8.2;
    this.globalState.cascade.event_throughput.peak = 15.3;
    
    // Simulate classification distribution
    const total = 100;
    this.globalState.cascade.classification_distribution = {
      INFRA_FAILURE: Math.floor(total * 0.3),
      ROUTE_FAILURE: Math.floor(total * 0.2),
      DEPLOYMENT_MISMATCH: Math.floor(total * 0.15),
      DATA_INTEGRITY_RISK: Math.floor(total * 0.1),
      STREAM_BREAK: Math.floor(total * 0.2),
      UNKNOWN_ANOMALY: Math.floor(total * 0.05)
    };
    
    // Simulate quarantine metrics
    this.globalState.cascade.quarantine.size = Math.floor(Math.random() * 10);
    this.globalState.cascade.quarantine.growth_rate = (Math.random() - 0.5) * 2;
    this.globalState.cascade.quarantine.retry_queue_depth = Math.floor(Math.random() * 5);
    
    // Simulate emission metrics
    const totalSent = 1000;
    const totalFailed = Math.floor(totalSent * 0.05);
    this.globalState.cascade.emissions.success_rate = ((totalSent - totalFailed) / totalSent * 100).toFixed(2);
    this.globalState.cascade.emissions.total_sent = totalSent;
    this.globalState.cascade.emissions.total_failed = totalFailed;
    this.globalState.cascade.emissions.pending_count = Math.floor(Math.random() * 3);
    
    // Simulate last resolution
    if (Math.random() < 0.1) {
      this.globalState.cascade.emissions.last_confirmed_resolution = new Date().toISOString();
    }
  }

  // Update KILO metrics
  updateKiloMetrics() {
    // Simulate KILO metrics
    this.globalState.kilo.repair_manifests_generated = Math.floor(Math.random() * 50);
    this.globalState.kilo.repair_success_rate = (85 + Math.random() * 10).toFixed(2);
    this.globalState.kilo.average_repair_time = Math.floor(5000 + Math.random() * 10000); // 5-15 seconds
    this.globalState.kilo.active_repairs = Math.floor(Math.random() * 5);
    
    // Repair attempts by classification
    this.globalState.kilo.repair_attempts_by_classification = {
      INFRA_FAILURE: Math.floor(Math.random() * 20),
      ROUTE_FAILURE: Math.floor(Math.random() * 15),
      DEPLOYMENT_MISMATCH: Math.floor(Math.random() * 10),
      DATA_INTEGRITY_RISK: Math.floor(Math.random() * 5),
      STREAM_BREAK: Math.floor(Math.random() * 15),
      UNKNOWN_ANOMALY: Math.floor(Math.random() * 3)
    };
  }

  // Update event bus metrics
  updateEventBusMetrics() {
    // Simulate event bus metrics
    this.globalState.event_bus.total_events_processed += Math.floor(Math.random() * 10);
    this.globalState.event_bus.events_per_second = this.globalState.cascade.event_throughput.current;
    this.globalState.event_bus.backlog_size = Math.floor(Math.random() * 100);
    this.globalState.event_bus.subscriber_count = 3 + Math.floor(Math.random() * 5);
    this.globalState.event_bus.average_processing_time = 50 + Math.random() * 100; // 50-150ms
  }

  // Calculate system health
  calculateSystemHealth() {
    let healthScore = 100;
    
    // Deduct for high error rate
    const errorRate = parseFloat(this.globalState.cascade.emissions.success_rate || 100);
    if (errorRate < 95) healthScore -= 20;
    
    // Deduct for large quarantine
    if (this.globalState.cascade.quarantine.size > 20) healthScore -= 15;
    
    // Deduct for memory usage
    if (this.globalState.system.memory_usage > 500) healthScore -= 10;
    
    // Deduct for backlog
    if (this.globalState.event_bus.backlog_size > 1000) healthScore -= 15;
    
    // Determine health status
    if (healthScore >= 90) {
      this.globalState.system.health = 'healthy';
    } else if (healthScore >= 70) {
      this.globalState.system.health = 'degraded';
    } else if (healthScore >= 50) {
      this.globalState.system.health = 'warning';
    } else {
      this.globalState.system.health = 'critical';
    }
  }

  // Store historical data
  storeHistoricalData() {
    const now = Date.now();
    
    // Store throughput data
    this.historicalData.throughput.push({
      timestamp: now,
      value: this.globalState.cascade.event_throughput.current
    });
    
    // Store error rates
    const errorRate = (100 - parseFloat(this.globalState.cascade.emissions.success_rate || 100)) / 100;
    this.historicalData.errorRates.push({
      timestamp: now,
      value: errorRate
    });
    
    // Store classification rates
    this.historicalData.classificationRates.push({
      timestamp: now,
      distribution: { ...this.globalState.cascade.classification_distribution }
    });
    
    // Keep only last hour of data
    const oneHourAgo = now - (60 * 60 * 1000);
    
    Object.keys(this.historicalData).forEach(key => {
      this.historicalData[key] = this.historicalData[key].filter(
        point => point.timestamp > oneHourAgo
      );
    });
  }

  // Calculate baseline for drift detection
  calculateBaseline() {
    if (this.historicalData.throughput.length < 10) return;
    
    // Calculate average throughput
    const throughputValues = this.historicalData.throughput.map(p => p.value);
    this.baseline.average_throughput = throughputValues.reduce((a, b) => a + b, 0) / throughputValues.length;
    
    // Calculate baseline classification distribution
    const recentClassifications = this.historicalData.classificationRates.slice(-10);
    const baselineDistribution = {};
    
    Object.keys(this.globalState.cascade.classification_distribution).forEach(key => {
      baselineDistribution[key] = recentClassifications.reduce((sum, point) => {
        return sum + (point.distribution[key] || 0);
      }, 0) / recentClassifications.length;
    });
    
    this.baseline.classification_distribution = baselineDistribution;
    
    console.log('[SYSTEM OBSERVABILITY] Baseline calculated for drift detection');
  }

  // Detect system drift
  detectDrift() {
    if (!this.baseline.average_throughput) return;
    
    const drifts = [];
    
    // Check throughput drift (>15% deviation)
    const currentThroughput = this.globalState.cascade.event_throughput.current;
    const throughputDeviation = Math.abs(currentThroughput - this.baseline.average_throughput) / this.baseline.average_throughput;
    
    if (throughputDeviation > 0.15) {
      drifts.push({
        type: 'THROUGHPUT_DRIFT',
        current: currentThroughput,
        baseline: this.baseline.average_throughput,
        deviation: (throughputDeviation * 100).toFixed(2) + '%'
      });
    }
    
    // Check classification ratio drift
    if (this.baseline.classification_distribution) {
      Object.keys(this.baseline.classification_distribution).forEach(classification => {
        const current = this.globalState.cascade.classification_distribution[classification];
        const baseline = this.baseline.classification_distribution[classification];
        const deviation = Math.abs(current - baseline) / baseline;
        
        if (deviation > 0.15) {
          drifts.push({
            type: 'CLASSIFICATION_DRIFT',
            classification: classification,
            current: current,
            baseline: baseline,
            deviation: (deviation * 100).toFixed(2) + '%'
          });
        }
      });
    }
    
    // Check error rate drift
    const errorRate = (100 - parseFloat(this.globalState.cascade.emissions.success_rate || 100)) / 100;
    if (errorRate > this.baseline.error_rate_threshold) {
      drifts.push({
        type: 'ERROR_RATE_DRIFT',
        current: errorRate,
        threshold: this.baseline.error_rate_threshold,
        deviation: ((errorRate - this.baseline.error_rate_threshold) * 100).toFixed(2) + '%'
      });
    }
    
    // Emit drift alerts
    if (drifts.length > 0) {
      this.emit('SYSTEM_DRIFT_DETECTED', {
        timestamp: new Date().toISOString(),
        drifts: drifts
      });
      
      console.log('[SYSTEM OBSERVABILITY] DRIFT DETECTED:', drifts.length, 'anomalies');
    }
  }

  // Get machine-readable state snapshot
  getStateSnapshot() {
    return {
      ...this.globalState,
      snapshot_type: 'full',
      format: 'machine_readable'
    };
  }

  // Get compact state for APIs
  getCompactState() {
    return {
      timestamp: this.globalState.timestamp,
      system_health: this.globalState.system.health,
      event_throughput: this.globalState.cascade.event_throughput.current,
      error_rate: ((100 - parseFloat(this.globalState.cascade.emissions.success_rate || 100)) / 100).toFixed(3),
      quarantine_size: this.globalState.cascade.quarantine.size,
      active_repairs: this.globalState.kilo.active_repairs
    };
  }

  // Persist state to disk
  async persistState() {
    if (!this.persistenceEnabled) return;
    
    try {
      await fs.writeFile(
        this.persistencePath,
        JSON.stringify(this.globalState, null, 2),
        'utf8'
      );
    } catch (error) {
      console.error('[SYSTEM OBSERVABILITY] Failed to persist state:', error);
    }
  }

  // Load persisted state
  async loadPersistedState() {
    try {
      const data = await fs.readFile(this.persistencePath, 'utf8');
      const persisted = JSON.parse(data);
      
      // Restore some metrics that make sense to persist
      if (persisted.cascade) {
        this.globalState.cascade.event_throughput.average_5m = persisted.cascade.event_throughput?.average_5m || 0;
        this.globalState.cascade.event_throughput.peak = persisted.cascade.event_throughput?.peak || 0;
        this.globalState.cascade.emissions.total_sent = persisted.cascade.emissions?.total_sent || 0;
        this.globalState.cascade.emissions.total_failed = persisted.cascade.emissions?.total_failed || 0;
      }
      
      if (persisted.system) {
        this.globalState.system.last_restart = persisted.system.last_restart;
      }
      
      console.log('[SYSTEM OBSERVABILITY] Loaded persisted state');
    } catch (error) {
      // File doesn't exist yet, which is fine
    }
  }

  // Stop observability layer
  stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    console.log('[SYSTEM OBSERVABILITY] Stopped');
  }
}

// Create singleton instance
const systemObservability = new SystemObservabilityLayer();

// Export the observability layer
module.exports = systemObservability;
