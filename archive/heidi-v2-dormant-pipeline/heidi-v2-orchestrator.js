// HEIDI V2 Orchestrator - Single Truth Architecture
// Ties all layers together: Ingestion -> RAW LEDGER -> CASCADE -> KILO -> ProtoForge -> Emission
// Explicit layers with no overlap

const rawEventLedgerV2 = require('../../modules/raw-event-ledger-v2');
const ingestionLayerV2 = require('./ingestion-layer-v2');
const cascadeClassifierV2 = require('../../modules/cascade-classifier-v2');
const kiloAnalyzerV2 = require('../../modules/kilo-analyzer-v2');
const protoforgePolicyV2 = require('../../modules/protoforge-policy-v2');
const emissionLayerV2 = require('./emission-layer-v2');
const replayEngineV2 = require('../../modules/replay-engine-v2');
const { EventEmitter } = require('events');

class HeidiV2Orchestrator extends EventEmitter {
  constructor() {
    super();
    
    // Layer references
    this.layers = {
      ingestion: ingestionLayerV2,
      rawLedger: rawEventLedgerV2,
      cascade: cascadeClassifierV2,
      kilo: kiloAnalyzerV2,
      protoforge: protoforgePolicyV2,
      emission: emissionLayerV2,
      replay: replayEngineV2
    };
    
    // System state
    this.isRunning = false;
    this.startTime = null;
    
    // Observability
    this.observability = {
      externalStore: null,
      metrics: new Map(),
      alerts: []
    };
    
    console.log('[HEIDI V2] Orchestrator Initialized');
    console.log('[HEIDI V2] Architecture: Single Truth with Explicit Layers');
    console.log('[HEIDI V2] Flow: Ingestion -> RAW LEDGER -> CASCADE -> KILO -> ProtoForge -> Emission');
  }

  // Start the system
  async start() {
    if (this.isRunning) {
      console.log('[HEIDI V2] Already running');
      return;
    }
    
    console.log('[HEIDI V2] Starting Single Truth Architecture...');
    this.startTime = Date.now();
    this.isRunning = true;
    
    // Set up layer connections
    this.setupLayerConnections();
    
    // Start background processes
    this.startBackgroundProcesses();
    
    // Emit system start
    this.emit('system_started', {
      timestamp: new Date().toISOString(),
      architecture: 'SINGLE_TRUTH_V2'
    });
    
    console.log('[HEIDI V2] System started successfully');
  }

  // Set up connections between layers
  setupLayerConnections() {
    // Ingestion -> Raw Ledger (already connected in ingestion layer)
    
    // Raw Ledger -> CASCADE (already connected in cascade layer)
    
    // CASCADE -> KILO (already connected in kilo layer)
    
    // KILO -> ProtoForge (already connected in protoforge layer)
    
    // ProtoForge -> Emission (already connected in emission layer)
    
    // Cross-layer monitoring
    this.setupMonitoring();
  }

  // Set up monitoring across layers
  setupMonitoring() {
    // Monitor ingestion
    this.layers.ingestion.on('event_ingested', (data) => {
      this.updateMetric('ingestion_rate', 1);
      this.emitToExternalStore('layer_event', {
        layer: 'ingestion',
        event: 'event_ingested',
        data: data
      });
    });
    
    // Monitor classifications
    this.layers.cascade.on('event_classified', (data) => {
      this.updateMetric('classification_rate', 1);
      this.updateMetric(`classification_${data.classification}`, 1);
      this.emitToExternalStore('layer_event', {
        layer: 'cascade',
        event: 'event_classified',
        data: data
      });
    });
    
    // Monitor analyses
    this.layers.kilo.on('event_analyzed', (data) => {
      this.updateMetric('analysis_rate', 1);
      this.emitToExternalStore('layer_event', {
        layer: 'kilo',
        event: 'event_analyzed',
        data: data
      });
    });
    
    // Monitor policy decisions
    this.layers.protoforge.on('action_approved', (data) => {
      this.updateMetric('action_approval_rate', 1);
      this.emitToExternalStore('layer_event', {
        layer: 'protoforge',
        event: 'action_approved',
        data: data
      });
    });
    
    this.layers.protoforge.on('action_rejected', (data) => {
      this.updateMetric('action_rejection_rate', 1);
    });
    
    // Monitor emissions
    this.layers.emission.on('emission_complete', (data) => {
      this.updateMetric('emission_rate', 1);
      this.emitToExternalStore('layer_event', {
        layer: 'emission',
        event: 'emission_complete',
        data: data
      });
    });
    
    // Monitor drift
    this.layers.replay.on('drift_detected', (data) => {
      this.createAlert('SYSTEM_DRIFT', data);
      this.emitToExternalStore('system_alert', {
        type: 'SYSTEM_DRIFT',
        data: data
      });
    });
  }

  // Ingest event through the proper pipeline
  async ingestEvent(rawEvent, sourceContext = {}) {
    if (!this.isRunning) {
      throw new Error('System not running');
    }
    
    console.log(`[HEIDI V2] Ingesting event from ${sourceContext.source || 'unknown'}`);
    
    // Layer 1: Ingestion (normalizes structure only)
    const ledgerRecord = await this.layers.ingestion.ingest(rawEvent, sourceContext);
    
    if (!ledgerRecord) {
      console.log('[HEIDI V2] Event rejected by ingestion layer');
      return null;
    }
    
    // The rest of the pipeline is automatic through event connections
    return ledgerRecord;
  }

  // Start background processes
  startBackgroundProcesses() {
    // Periodic determinism validation
    setInterval(async () => {
      if (this.isRunning) {
        try {
          const validation = await this.layers.replay.validateDeterminism(10);
          this.updateMetric('determinism_rate', validation.deterministic_rate);
          
          if (validation.deterministic_rate < 95) {
            this.createAlert('LOW_DETERMINISM', {
              rate: validation.deterministic_rate,
              sample_size: validation.sample_size
            });
          }
        } catch (error) {
          console.error('[HEIDI V2] Determinism validation error:', error);
        }
      }
    }, 300000); // Every 5 minutes
    
    // Metrics aggregation
    setInterval(() => {
      if (this.isRunning) {
        this.aggregateMetrics();
      }
    }, 60000); // Every minute
    
    // Alert processing
    setInterval(() => {
      if (this.isRunning) {
        this.processAlerts();
      }
    }, 30000); // Every 30 seconds
  }

  // Update metric
  updateMetric(name, value) {
    const current = this.observability.metrics.get(name) || 0;
    this.observability.metrics.set(name, current + value);
  }

  // Aggregate metrics
  aggregateMetrics() {
    const aggregated = {
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      metrics: {},
      layer_stats: {}
    };
    
    // Aggregate internal metrics
    for (const [key, value] of this.observability.metrics) {
      aggregated.metrics[key] = value;
    }
    
    // Get layer statistics
    aggregated.layer_stats.ingestion = this.layers.ingestion.getStats();
    aggregated.layer_stats.rawLedger = this.layers.rawLedger.getStats();
    aggregated.layer_stats.cascade = this.layers.cascade.getStats();
    aggregated.layer_stats.kilo = this.layers.kilo.getStats();
    aggregated.layer_stats.protoforge = this.layers.protoforge.getStats();
    aggregated.layer_stats.emission = this.layers.emission.getStats();
    aggregated.layer_stats.replay = this.layers.replay.getStats();
    
    // Emit to external store
    this.emitToExternalStore('metrics', aggregated);
    
    // Reset counters
    this.observability.metrics.clear();
  }

  // Create alert
  createAlert(type, data) {
    const alert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: type,
      data: data,
      timestamp: new Date().toISOString(),
      acknowledged: false
    };
    
    this.observability.alerts.push(alert);
    
    // Keep only last 100 alerts
    if (this.observability.alerts.length > 100) {
      this.observability.alerts = this.observability.alerts.slice(-100);
    }
    
    console.warn(`[HEIDI V2] Alert created: ${type}`, data);
    this.emit('alert_created', alert);
  }

  // Process alerts with ACKNOWLEDGMENT to prevent infinite loops
  processAlerts() {
    const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minute cooldown per alert type
    const now = Date.now();
    
    // Filter: unacknowledged + not in cooldown + not already processed
    const unacknowledged = this.observability.alerts.filter(a => {
      if (a.acknowledged) return false;
      if (a.processed_at) return false; // Already processed this cycle
      
      // Check cooldown by alert type
      const lastProcessed = this.observability.lastProcessedAlerts?.[a.type] || 0;
      if (now - lastProcessed < ALERT_COOLDOWN_MS) {
        return false; // In cooldown
      }
      
      return true;
    });
    
    if (unacknowledged.length === 0) return;
    
    console.log(`[HEIDI V2] Processing ${unacknowledged.length} unacknowledged alerts`);
    
    // Initialize lastProcessedAlerts if needed
    if (!this.observability.lastProcessedAlerts) {
      this.observability.lastProcessedAlerts = {};
    }
    
    for (const alert of unacknowledged) {
      // Mark as PROCESSED (emitted to external store)
      alert.processed_at = new Date().toISOString();
      
      // Update cooldown timestamp for this alert type
      this.observability.lastProcessedAlerts[alert.type] = now;
      
      console.log(`[HEIDI V2] Alert processed: ${alert.id} (${alert.type})`);
    }
    
    // Emit to external store
    this.emitToExternalStore('alerts', {
      alerts: unacknowledged,
      timestamp: new Date().toISOString()
    });
  }
  
  // ACKNOWLEDGE alert (call this when human/external system acknowledges)
  acknowledgeAlert(alertId) {
    const alert = this.observability.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledged_at = new Date().toISOString();
      console.log(`[HEIDI V2] Alert acknowledged: ${alertId}`);
      this.emit('alert_acknowledged', alert);
      return true;
    }
    return false;
  }
  
  // Auto-acknowledge processed alerts after timeout (prevents pile-up)
  autoAcknowledgeOldAlerts(maxAgeMs = 3600000) { // 1 hour default
    const now = Date.now();
    let acknowledgedCount = 0;
    
    for (const alert of this.observability.alerts) {
      if (!alert.acknowledged && alert.processed_at) {
        const processedTime = new Date(alert.processed_at).getTime();
        if (now - processedTime > maxAgeMs) {
          alert.acknowledged = true;
          alert.auto_acknowledged = true;
          acknowledgedCount++;
        }
      }
    }
    
    if (acknowledgedCount > 0) {
      console.log(`[HEIDI V2] Auto-acknowledged ${acknowledgedCount} old alerts`);
    }
  }

  // Set external store for observability
  setExternalStore(store) {
    this.observability.externalStore = store;
    console.log('[HEIDI V2] External observability store configured');
  }

  // Emit to external store
  emitToExternalStore(type, data) {
    if (this.observability.externalStore) {
      this.observability.externalStore.write(type, data);
    }
  }

  // Get system status
  getSystemStatus() {
    return {
      is_running: this.isRunning,
      uptime: this.isRunning ? Date.now() - this.startTime : 0,
      architecture: 'SINGLE_TRUTH_V2',
      layers: {
        ingestion: this.layers.ingestion.getInfo(),
        rawLedger: this.layers.rawLedger.getInfo(),
        cascade: this.layers.cascade.getInfo(),
        kilo: this.layers.kilo.getInfo(),
        protoforge: this.layers.protoforge.getInfo(),
        emission: this.layers.emission.getInfo(),
        replay: this.layers.replay.getInfo()
      },
      observability: {
        metrics: Object.fromEntries(this.observability.metrics),
        alerts_count: this.observability.alerts.length,
        unacknowledged_alerts: this.observability.alerts.filter(a => !a.acknowledged).length
      }
    };
  }

  // Get trace for an event
  getEventTrace(eventId) {
    const trace = this.layers.replay.getTrace(eventId);
    const ledgerRecord = this.layers.rawLedger.getById(eventId);
    
    return {
      event_id: eventId,
      ledger_record: ledgerRecord,
      execution_trace: trace,
      available: !!trace
    };
  }

  // Validate entire system
  async validateSystem() {
    console.log('[HEIDI V2] Running system validation...');
    
    const validation = {
      timestamp: new Date().toISOString(),
      layers: {},
      overall_health: 'unknown'
    };
    
    // Validate each layer
    validation.layers.ingestion = await this.validateLayer('ingestion');
    validation.layers.rawLedger = await this.validateLayer('rawLedger');
    validation.layers.cascade = await this.validateLayer('cascade');
    validation.layers.kilo = await this.validateLayer('kilo');
    validation.layers.protoforge = await this.validateLayer('protoforge');
    validation.layers.emission = await this.validateLayer('emission');
    validation.layers.replay = await this.validateLayer('replay');
    
    // Determine overall health
    const healthScores = Object.values(validation.layers).map(l => l.health_score);
    const averageHealth = healthScores.reduce((a, b) => a + b, 0) / healthScores.length;
    
    if (averageHealth >= 0.9) {
      validation.overall_health = 'excellent';
    } else if (averageHealth >= 0.7) {
      validation.overall_health = 'good';
    } else if (averageHealth >= 0.5) {
      validation.overall_health = 'degraded';
    } else {
      validation.overall_health = 'critical';
    }
    
    console.log(`[HEIDI V2] Validation complete: ${validation.overall_health} health`);
    
    return validation;
  }

  // Validate individual layer
  async validateLayer(layerName) {
    const layer = this.layers[layerName];
    const stats = layer.getStats();
    
    // Simple health calculation based on error rates
    const errorRate = stats.processingErrors / (stats.totalProcessed || 1);
    const healthScore = Math.max(0, 1 - errorRate);
    
    return {
      name: layerName,
      health_score: healthScore,
      stats: stats,
      healthy: healthScore > 0.8
    };
  }

  // Stop the system
  async stop() {
    if (!this.isRunning) {
      console.log('[HEIDI V2] Already stopped');
      return;
    }
    
    console.log('[HEIDI V2] Stopping system...');
    
    // Force flush all layers
    await this.layers.rawLedger.forceFlush();
    
    this.isRunning = false;
    
    // Emit system stop
    this.emit('system_stopped', {
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime
    });
    
    console.log('[HEIDI V2] System stopped');
  }
}

// Create singleton
const heidiV2Orchestrator = new HeidiV2Orchestrator();

module.exports = heidiV2Orchestrator;
