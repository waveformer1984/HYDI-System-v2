// @deprecated Legacy CASCADE health snapshot. Use api/platform/diagnostics.js or api/health.js.
// Replacement: lib/platform-diagnostics.js and the canonical diagnostics endpoint
// Migration: GET /api/platform/diagnostics for runtime inventory. Removal target: Phase 5.
//
// CASCADE Health Snapshot Engine
// Real-time system state updated every 10 seconds

const EventEmitter = require('events');

class CascadeHealthSnapshot extends EventEmitter {
  constructor() {
    super();
    
    // Snapshot state
    this.snapshot = {
      timestamp: null,
      active_streams: 0,
      event_throughput: {
        current: 0,
        average_1m: 0,
        peak_1m: 0
      },
      error_ratio: {
        current: 0,
        average_1m: 0,
        threshold: 0.1 // 10% error threshold
      },
      quarantine: {
        size: 0,
        growth_rate: 0,
        oldest_event: null
      },
      emissions: {
        last_successful: null,
        pending_count: 0,
        failure_rate: 0
      },
      system_health: 'unknown',
      components: {
        intake: 'unknown',
        classification: 'unknown',
        emission: 'unknown',
        quarantine: 'unknown'
      }
    };
    
    // Metrics history for calculations
    this.metricsHistory = {
      events: [],
      errors: [],
      quarantine: [],
      emissions: []
    };
    
    // History window (1 minute of data at 10-second intervals)
    this.historyWindow = 6;
    
    // Update interval
    this.updateInterval = null;
    
    // Component references
    this.components = {};
    
    console.log('[HEALTH SNAPSHOT] Initialized');
  }

  // Register components for monitoring
  registerComponent(name, component) {
    this.components[name] = component;
    console.log(`[HEALTH SNAPSHOT] Registered component: ${name}`);
  }

  // Start health monitoring
  start() {
    if (this.updateInterval) {
      return;
    }
    
    // Update every 10 seconds
    this.updateInterval = setInterval(() => {
      this.updateSnapshot();
    }, 10000);
    
    // Initial update
    this.updateSnapshot();
    
    console.log('[HEALTH SNAPSHOT] Started monitoring (10s interval)');
  }

  // Stop health monitoring
  stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    console.log('[HEALTH SNAPSHOT] Stopped monitoring');
  }

  // Update snapshot with current state
  updateSnapshot() {
    const now = new Date();
    this.snapshot.timestamp = now.toISOString();
    
    // Update active streams
    this.updateActiveStreams();
    
    // Update event throughput
    this.updateEventThroughput();
    
    // Update error ratio
    this.updateErrorRatio();
    
    // Update quarantine metrics
    this.updateQuarantineMetrics();
    
    // Update emission metrics
    this.updateEmissionMetrics();
    
    // Update component health
    this.updateComponentHealth();
    
    // Calculate overall system health
    this.calculateSystemHealth();
    
    // Emit updated snapshot
    this.emit('snapshot_updated', this.snapshot);
  }

  // Update active streams count
  updateActiveStreams() {
    let count = 0;
    
    // Count from various sources
    if (this.components.cascade) {
      const status = this.components.cascade.getStatus();
      if (status.intake_status && status.intake_status.active_modules) {
        count += status.intake_status.active_modules.length;
      }
    }
    
    // Add SSE connections if available
    if (this.components.ursulaSSE) {
      count += this.components.ursulaSSE.getSubscriberCount();
    }
    
    this.snapshot.active_streams = count;
  }

  // Update event throughput metrics
  updateEventThroughput() {
    let currentEvents = 0;
    let currentErrors = 0;
    
    // Get current metrics from components
    if (this.components.cascade) {
      const status = this.components.cascade.getStatus();
      currentEvents = status.stats.events_processed || 0;
      currentErrors = status.stats.events_rejected || 0;
    }
    
    // Add to history
    this.metricsHistory.events.push({
      timestamp: Date.now(),
      count: currentEvents
    });
    
    this.metricsHistory.errors.push({
      timestamp: Date.now(),
      count: currentErrors
    });
    
    // Trim history
    if (this.metricsHistory.events.length > this.historyWindow) {
      this.metricsHistory.events.shift();
    }
    if (this.metricsHistory.errors.length > this.historyWindow) {
      this.metricsHistory.errors.shift();
    }
    
    // Calculate current throughput (events per second)
    if (this.metricsHistory.events.length >= 2) {
      const recent = this.metricsHistory.events[this.metricsHistory.events.length - 1];
      const previous = this.metricsHistory.events[this.metricsHistory.events.length - 2];
      const timeDiff = (recent.timestamp - previous.timestamp) / 1000;
      const eventDiff = recent.count - previous.count;
      
      this.snapshot.event_throughput.current = timeDiff > 0 ? eventDiff / timeDiff : 0;
    }
    
    // Calculate 1-minute average
    if (this.metricsHistory.events.length > 0) {
      const totalEvents = this.metricsHistory.events[this.metricsHistory.events.length - 1].count;
      const firstEvents = this.metricsHistory.events[0].count;
      const timeSpan = (this.metricsHistory.events[this.metricsHistory.events.length - 1].timestamp - 
                       this.metricsHistory.events[0].timestamp) / 1000;
      
      this.snapshot.event_throughput.average_1m = timeSpan > 0 ? (totalEvents - firstEvents) / timeSpan : 0;
      this.snapshot.event_throughput.peak_1m = this.snapshot.event_throughput.average_1m; // Simplified
    }
  }

  // Update error ratio
  updateErrorRatio() {
    let currentEvents = 0;
    let currentErrors = 0;
    
    if (this.components.cascade) {
      const status = this.components.cascade.getStatus();
      currentEvents = status.stats.events_processed || 0;
      currentErrors = status.stats.events_rejected || 0;
    }
    
    const total = currentEvents + currentErrors;
    this.snapshot.error_ratio.current = total > 0 ? currentErrors / total : 0;
    
    // Calculate 1-minute average
    if (this.metricsHistory.errors.length >= 2 && this.metricsHistory.events.length >= 2) {
      const recentErrors = this.metricsHistory.errors[this.metricsHistory.errors.length - 1].count;
      const previousErrors = this.metricsHistory.errors[this.metricsHistory.errors.length - 2];
      const recentEvents = this.metricsHistory.events[this.metricsHistory.events.length - 1].count;
      const previousEvents = this.metricsHistory.events[this.metricsHistory.events.length - 2].count;
      
      const errorDiff = recentErrors - previousErrors;
      const eventDiff = recentEvents - previousEvents;
      const totalDiff = errorDiff + eventDiff;
      
      this.snapshot.error_ratio.average_1m = totalDiff > 0 ? errorDiff / totalDiff : 0;
    }
  }

  // Update quarantine metrics
  updateQuarantineMetrics() {
    if (this.components.cascade) {
      const quarantineStatus = this.components.cascade.getStatus().quarantine;
      this.snapshot.quarantine.size = quarantineStatus.total_quarantined || 0;
      
      // Calculate growth rate
      this.metricsHistory.quarantine.push({
        timestamp: Date.now(),
        size: this.snapshot.quarantine.size
      });
      
      if (this.metricsHistory.quarantine.length > this.historyWindow) {
        this.metricsHistory.quarantine.shift();
      }
      
      if (this.metricsHistory.quarantine.length >= 2) {
        const recent = this.metricsHistory.quarantine[this.metricsHistory.quarantine.length - 1];
        const previous = this.metricsHistory.quarantine[this.metricsHistory.quarantine.length - 2];
        const timeDiff = (recent.timestamp - previous.timestamp) / 1000;
        const sizeDiff = recent.size - previous.size;
        
        this.snapshot.quarantine.growth_rate = timeDiff > 0 ? sizeDiff / timeDiff : 0;
      }
      
      // Get oldest event
      if (quarantineStatus.oldest_event) {
        this.snapshot.quarantine.oldest_event = quarantineStatus.oldest_event;
      }
    }
  }

  // Update emission metrics
  updateEmissionMetrics() {
    if (this.components.cascade) {
      const emissionStatus = this.components.cascade.getStatus().emission;

      // Track last successful emission
      if (this.components.lastEmissionSuccess) {
        this.snapshot.emissions.last_successful = this.components.lastEmissionSuccess;
      }
      
      this.snapshot.emissions.pending_count = emissionStatus.queue_length || 0;
      
      // Calculate failure rate
      const totalEmissions = this.components.totalEmissions || 0;
      const failedEmissions = this.components.failedEmissions || 0;
      this.snapshot.emissions.failure_rate = totalEmissions > 0 ? failedEmissions / totalEmissions : 0;
    }
  }

  // Update component health
  updateComponentHealth() {
    if (!this.components.cascade) return;
    const status = this.components.cascade.getStatus();

    // Intake component — no dedicated intake submodule; use CASCADE's own
    // running state as the proxy for "is intake alive".
    this.snapshot.components.intake = status.is_running ? 'healthy' : 'unhealthy';

    // Classification component
    this.snapshot.components.classification = 'healthy'; // Simplified

    // Emission component
    this.snapshot.components.emission = status.emission.is_processing ? 'healthy' : 'degraded';

    // Quarantine component
    const quarantineSize = status.quarantine.total_quarantined || 0;
    this.snapshot.components.quarantine = quarantineSize > 100 ? 'warning' : 'healthy';
  }

  // Calculate overall system health
  calculateSystemHealth() {
    let healthScore = 100;
    
    // Deduct for high error ratio
    if (this.snapshot.error_ratio.current > this.snapshot.error_ratio.threshold) {
      healthScore -= 30;
    }
    
    // Deduct for no recent emissions
    if (this.snapshot.emissions.last_successful) {
      const timeSinceLastEmission = Date.now() - new Date(this.snapshot.emissions.last_successful).getTime();
      if (timeSinceLastEmission > 60000) { // 1 minute
        healthScore -= 20;
      }
    }
    
    // Deduct for large quarantine
    if (this.snapshot.quarantine.size > 100) {
      healthScore -= 20;
    }
    
    // Deduct for unhealthy components
    Object.values(this.snapshot.components).forEach(componentHealth => {
      if (componentHealth === 'unhealthy') {
        healthScore -= 25;
      } else if (componentHealth === 'degraded') {
        healthScore -= 10;
      } else if (componentHealth === 'warning') {
        healthScore -= 5;
      }
    });
    
    // Determine health status
    if (healthScore >= 90) {
      this.snapshot.system_health = 'healthy';
    } else if (healthScore >= 70) {
      this.snapshot.system_health = 'degraded';
    } else if (healthScore >= 50) {
      this.snapshot.system_health = 'warning';
    } else {
      this.snapshot.system_health = 'critical';
    }
  }

  // Get current snapshot
  getSnapshot() {
    return { ...this.snapshot };
  }

  // Get health report
  getHealthReport() {
    const snapshot = this.getSnapshot();
    
    return {
      summary: {
        overall_health: snapshot.system_health,
        active_streams: snapshot.active_streams,
        uptime: this.components.cascade ? this.components.cascade.stats.uptime : 0
      },
      metrics: snapshot,
      alerts: this.generateAlerts(snapshot),
      generated_at: new Date().toISOString()
    };
  }

  // Generate alerts based on snapshot
  generateAlerts(snapshot) {
    const alerts = [];
    
    // Error ratio alert
    if (snapshot.error_ratio.current > snapshot.error_ratio.threshold) {
      alerts.push({
        type: 'error_ratio_high',
        severity: 'warning',
        message: `Error ratio ${(snapshot.error_ratio.current * 100).toFixed(2)}% exceeds threshold`,
        value: snapshot.error_ratio.current
      });
    }
    
    // No emissions alert
    if (snapshot.emissions.last_successful) {
      const timeSinceLastEmission = Date.now() - new Date(snapshot.emissions.last_successful).getTime();
      if (timeSinceLastEmission > 120000) { // 2 minutes
        alerts.push({
          type: 'no_emissions',
          severity: 'critical',
          message: `No successful emissions for ${Math.floor(timeSinceLastEmission / 60000)} minutes`,
          value: timeSinceLastEmission
        });
      }
    }
    
    // Quarantine size alert
    if (snapshot.quarantine.size > 50) {
      alerts.push({
        type: 'quarantine_large',
        severity: 'warning',
        message: `Quarantine size ${snapshot.quarantine.size} is above normal`,
        value: snapshot.quarantine.size
      });
    }
    
    return alerts;
  }
}

module.exports = CascadeHealthSnapshot;
