// Cascade Validation Gate - Architectural Truth Enforcement
require('dotenv').config();

class CascadeValidationGate {
  constructor() {
    this.systemGraph = null;
    this.dependencyMap = null;
    this.validationRules = {
      requiredFields: ['event_id', 'type', 'source', 'timestamp', 'payload'],
      eventIdFormat: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      allowedSources: new Set(['heidi', 'protoforge', 'kilo', 'ursula', 'system']),
      maxPayloadSize: 1000000 // 1MB
    };
    this.eventPipeline = null;
    this.stats = {
      eventsValidated: 0,
      eventsRejected: 0,
      lastValidation: null,
      startTime: new Date().toISOString()
    };
  }

  async initialize() {
    console.log('=== INITIALIZING CASCADE VALIDATION GATE ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    try {
      // Phase 1: Load system graph
      await this.loadSystemGraph();
      
      // Phase 2: Connect to event pipeline
      await this.connectToEventPipeline();
      
      console.log('=== CASCADE VALIDATION GATE INITIALIZED ===');
      
      return {
        systemGraphLoaded: !!this.systemGraph,
        dependencyMapLoaded: !!this.dependencyMap,
        eventPipelineConnected: !!this.eventPipeline
      };
      
    } catch (error) {
      console.log(`Cascade validation gate initialization failed: ${error.message}`);
      throw error;
    }
  }

  async loadSystemGraph() {
    console.log('Phase 1: Loading system graph...');
    
    const fs = require('fs');
    
    try {
      // Load system graph
      const systemGraphData = fs.readFileSync('cascade-system-graph.json', 'utf8');
      this.systemGraph = JSON.parse(systemGraphData);
      
      // Load dependency map
      const dependencyMapData = fs.readFileSync('cascade-dependency-map.json', 'utf8');
      this.dependencyMap = JSON.parse(dependencyMapData);
      
      console.log(`Loaded system graph with ${this.systemGraph.modules.length} modules`);
      console.log(`Loaded dependency map with ${Object.keys(this.dependencyMap.direct).length} dependencies`);
      
    } catch (error) {
      console.log('System graph not found, building from scratch...');
      const { CascadeSystemGraph } = require('./cascade-system-graph');
      const graph = new CascadeSystemGraph();
      await graph.buildSystemGraph();
      
      this.systemGraph = graph.getSystemGraph().systemGraph;
      this.dependencyMap = graph.getSystemGraph().dependencyMap;
    }
  }

  async connectToEventPipeline() {
    console.log('Phase 2: Connecting to Event Pipeline...');
    
    const { EventPipeline } = require('./event-pipeline');
    this.eventPipeline = new EventPipeline();
    await this.eventPipeline.initialize();
    
    console.log('Connected to Event Pipeline');
  }

  validateEvent(event) {
    console.log(`Validating event: ${event.event_id || 'UNKNOWN'}`);
    
    this.stats.lastValidation = new Date().toISOString();
    
    const validationResult = {
      valid: true,
      errors: [],
      warnings: [],
      confidence: 1.0,
      actions: []
    };
    
    // Check required fields
    for (const field of this.validationRules.requiredFields) {
      if (!event[field]) {
        validationResult.valid = false;
        validationResult.errors.push(`Missing required field: ${field}`);
        validationResult.confidence = 0;
        validationResult.actions.push(`Add required field: ${field}`);
      }
    }
    
    // Validate event_id format (UUID)
    if (event.event_id && !this.validationRules.eventIdFormat.test(event.event_id)) {
      validationResult.valid = false;
      validationResult.errors.push(`Invalid event_id format: ${event.event_id}`);
      validationResult.confidence = 0;
      validationResult.actions.push(`Fix event_id to valid UUID format`);
    }
    
    // Validate source
    if (event.source && !this.validationRules.allowedSources.has(event.source)) {
      validationResult.warnings.push(`Unknown source: ${event.source}`);
      validationResult.confidence -= 0.1;
      validationResult.actions.push(`Verify source: ${event.source}`);
    }
    
    // Validate timestamp
    if (event.timestamp) {
      const timestamp = new Date(event.timestamp);
      if (isNaN(timestamp.getTime())) {
        validationResult.valid = false;
        validationResult.errors.push(`Invalid timestamp: ${event.timestamp}`);
        validationResult.confidence = 0;
        validationResult.actions.push(`Fix timestamp to ISO format`);
      } else {
        // Check if timestamp is reasonable (not too old or future)
        const now = new Date();
        const diff = Math.abs(now - timestamp);
        const oneHour = 60 * 60 * 1000;
        
        if (diff > oneHour) {
          validationResult.warnings.push(`Timestamp is ${Math.round(diff / oneHour)} hours ${timestamp < now ? 'old' : 'in the future'}`);
          validationResult.confidence -= 0.05;
        }
      }
    }
    
    // Validate payload size
    if (event.payload && JSON.stringify(event.payload).length > this.validationRules.maxPayloadSize) {
      validationResult.valid = false;
      validationResult.errors.push(`Payload too large: ${JSON.stringify(event.payload).length} bytes`);
      validationResult.confidence = 0;
      validationResult.actions.push(`Reduce payload size to under ${this.validationRules.maxPayloadSize} bytes`);
    }
    
    // Validate payload structure
    if (event.payload) {
      if (typeof event.payload !== 'object') {
        validationResult.valid = false;
        validationResult.errors.push(`Payload must be an object, got ${typeof event.payload}`);
        validationResult.confidence = 0;
        validationResult.actions.push(`Convert payload to object`);
      }
    }
    
    // Update stats
    if (validationResult.valid) {
      this.stats.eventsValidated++;
    } else {
      this.stats.eventsRejected++;
    }
    
    // Emit validation event
    this.emitValidationEvent(event, validationResult);
    
    return validationResult;
  }

  emitValidationEvent(event, validationResult) {
    if (this.eventPipeline) {
      const validationEvent = {
        event_id: 'cascade-validation-' + Date.now().toString(),
        type: 'cascade_validation',
        source: 'cascade',
        timestamp: new Date().toISOString(),
        payload: {
          originalEvent: event.event_id || 'UNKNOWN',
          valid: validationResult.valid,
          confidence: validationResult.confidence,
          errors: validationResult.errors,
          warnings: validationResult.warnings,
          actions: validationResult.actions
        }
      };
      
      this.eventPipeline.emit(validationEvent);
    }
  }

  detectDrift(configValue, systemMapValue, context) {
    const drift = {
      detected: false,
      severity: 'none',
      difference: null,
      recommendation: null
    };
    
    if (configValue !== systemMapValue) {
      drift.detected = true;
      drift.difference = {
        config: configValue,
        systemMap: systemMapValue,
        context
      };
      
      // Determine severity
      if (typeof configValue === 'number' && typeof systemMapValue === 'number') {
        const diff = Math.abs(configValue - systemMapValue);
        const percentDiff = diff / Math.max(configValue, systemMapValue);
        
        if (percentDiff > 0.5) {
          drift.severity = 'high';
          drift.recommendation = `Critical drift detected in ${context}: config=${configValue}, system=${systemMapValue}. Immediate reconciliation required.`;
        } else if (percentDiff > 0.1) {
          drift.severity = 'medium';
          drift.recommendation = `Moderate drift detected in ${context}: config=${configValue}, system=${systemMapValue}. Review and reconcile.`;
        } else {
          drift.severity = 'low';
          drift.recommendation = `Minor drift detected in ${context}: config=${configValue}, system=${systemMapValue}. Monitor for changes.`;
        }
      } else {
        drift.severity = 'high';
        drift.recommendation = `Type mismatch detected in ${context}: config=${configValue} (${typeof configValue}), system=${systemMapValue} (${typeof systemMapValue}). Immediate reconciliation required.`;
      }
    }
    
    return drift;
  }

  async query(query) {
    // Load truth layer for querying
    const { CascadeTruthLayer } = require('./cascade-truth-layer');
    const truthLayer = new CascadeTruthLayer();
    
    // Load existing truth layer
    try {
      const fs = require('fs');
      const truthData = fs.readFileSync('cascade-truth-layer.json', 'utf8');
      const truthLayerData = JSON.parse(truthData);
      
      // Reconstruct knowledge base
      truthLayer.knowledgeBase = new Map();
      truthLayerData.knowledgeBase.forEach(item => {
        truthLayer.knowledgeBase.set(item.path, item);
      });
      
      truthLayer.contradictions = truthLayerData.contradictions;
      
    } catch (error) {
      console.log('Truth layer not found, returning empty results');
      return {
        results: [],
        contradictions: [],
        confidence: 0,
        semanticGroups: []
      };
    }
    
    // Perform query
    const result = truthLayer.query(query);
    
    // Add drift detection for configuration conflicts
    const driftResults = [];
    
    // Check for port conflicts
    if (query.toLowerCase().includes('port')) {
      for (const module of this.systemGraph.modules) {
        if (module.ports.length > 0) {
          for (const port of module.ports) {
            // This would check against actual config files in a real implementation
            const drift = this.detectDrift(port, port, `Port ${port} in ${module.name}`);
            if (drift.detected) {
              driftResults.push(drift);
            }
          }
        }
      }
    }
    
    return {
      ...result,
      drift: driftResults
    };
  }

  getStatus() {
    return {
      initialized: true,
      systemGraphLoaded: !!this.systemGraph,
      dependencyMapLoaded: !!this.dependencyMap,
      eventPipelineConnected: !!this.eventPipeline,
      stats: this.stats,
      validationRules: this.validationRules,
      timestamp: new Date().toISOString()
    };
  }

  async shutdown() {
    console.log('Shutting down Cascade Validation Gate...');
    
    // Save stats
    const fs = require('fs');
    const statusReport = {
      timestamp: new Date().toISOString(),
      stats: this.stats,
      validationRules: this.validationRules,
      uptime: Date.now() - new Date(this.stats.startTime).getTime()
    };
    
    fs.writeFileSync('cascade-validation-report.json', JSON.stringify(statusReport, null, 2));
    
    console.log('Cascade Validation Gate shutdown complete');
  }
}

// CLI interface
if (require.main === module) {
  const validator = new CascadeValidationGate();
  
  const command = process.argv[2] || 'initialize';
  
  (async () => {
    switch (command) {
      case 'initialize':
        await validator.initialize();
        
        // Keep running for validation
        console.log('\nCascade Validation Gate is active. Press Ctrl+C to stop.');
        
        process.on('SIGINT', async () => {
          console.log('\nShutting down...');
          await validator.shutdown();
          process.exit(0);
        });
        
        // Keep process alive
        setInterval(() => {}, 10000);
        break;
        
      case 'validate':
        await validator.initialize();
        
        // Test validation
        const testEvent = {
          event_id: 'test-event-' + Date.now().toString(),
          type: 'test',
          source: 'test',
          timestamp: new Date().toISOString(),
          payload: { message: 'Test event' }
        };
        
        const result = validator.validateEvent(testEvent);
        console.log('Validation result:', result);
        
        await validator.shutdown();
        break;
        
      case 'status':
        const status = validator.getStatus();
        console.log('Cascade Status:', JSON.stringify(status, null, 2));
        break;
        
      default:
        console.log('Usage: node cascade-validation-gate.js [initialize|validate|status]');
    }
  })();
}

module.exports = { CascadeValidationGate };
