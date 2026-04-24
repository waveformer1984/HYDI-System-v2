// CASCADE V2 - Classification Only
// Input: raw ledger events
// Output: classification object only
// NO routing, NO repair, NO emission, NO side effects

const rawEventLedgerV2 = require('./raw-event-ledger-v2');
const { EventEmitter } = require('events');

class CascadeClassifierV2 extends EventEmitter {
  constructor() {
    super();
    
    // Classification rules
    this.classificationRules = new Map();
    this.initializeClassificationRules();
    
    // Processing state
    this.isProcessing = false;
    this.processingQueue = [];
    this.lastProcessedPosition = -1;
    
    // Statistics
    this.stats = {
      totalProcessed: 0,
      classifications: new Map(),
      confidenceDistribution: {
        high: 0,    // > 0.8
        medium: 0,  // 0.5 - 0.8
        low: 0      // < 0.5
      },
      processingErrors: 0
    };
    
    console.log('[CASCADE V2] Initialized - Classification ONLY');
    console.log('[CASCADE V2] RULE: No side effects, no routing, no repair');
  }

  // Initialize classification rules
  initializeClassificationRules() {
    // Infrastructure failures
    this.classificationRules.set('infrastructure_failure', {
      patterns: [
        { field: 'type', value: 'error' },
        { field: 'payload.error_code', pattern: /ECONNREFUSED|ETIMEDOUT|ENOTFOUND/ },
        { field: 'payload.module', pattern: /database|db|storage/ },
        { field: 'source', value: 'vercel' } // Vercel errors are infrastructure
      ],
      confidence: 0.9,
      classification: 'INFRA_FAILURE'
    });

    // Route failures
    this.classificationRules.set('route_failure', {
      patterns: [
        { field: 'type', value: '404' },
        { field: 'type', value: 'route_error' },
        { field: 'payload.status', value: 404 }
      ],
      confidence: 0.95,
      classification: 'ROUTE_FAILURE'
    });

    // Deployment mismatches
    this.classificationRules.set('deployment_mismatch', {
      patterns: [
        { field: 'type', value: 'config_error' },
        { field: 'payload.missing_env', exists: true },
        { field: 'source', value: 'vercel' }
      ],
      confidence: 0.85,
      classification: 'DEPLOYMENT_MISMATCH'
    });

    // Data integrity risks
    this.classificationRules.set('data_integrity_risk', {
      patterns: [
        { field: 'type', value: 'validation_error' },
        { field: 'payload.corrupted', value: true },
        { field: 'payload.checksum_mismatch', value: true }
      ],
      confidence: 0.8,
      classification: 'DATA_INTEGRITY_RISK'
    });

    // Stream breaks
    this.classificationRules.set('stream_break', {
      patterns: [
        { field: 'type', value: 'websocket_error' },
        { field: 'type', value: 'sse_disconnect' },
        { field: 'payload.stream', exists: true }
      ],
      confidence: 0.75,
      classification: 'STREAM_BREAK'
    });

    console.log(`[CASCADE V2] Loaded ${this.classificationRules.size} classification rules`);
  }

  // Process event - READ from ledger, OUTPUT classification only
  async processEvent(eventId) {
    try {
      // Get event from RAW LEDGER (READ ONLY)
      const ledgerRecord = rawEventLedgerV2.getById(eventId);
      if (!ledgerRecord) {
        throw new Error(`Event not found in ledger: ${eventId}`);
      }

      // Classify the event
      const classification = this.classify(ledgerRecord);
      
      // Update statistics
      this.updateStats(classification);
      
      // LOW-SIGNAL GATE: Block non-actionable garbage from downstream
      if (classification.confidence < 0.3) {
        console.log(`[CASCADE V2] LOW_SIGNAL_BLOCKED: ${eventId} (confidence: ${classification.confidence.toFixed(2)})`);
        this.emit('event_filtered', {
          event_id: eventId,
          reason: 'LOW_SIGNAL',
          confidence: classification.confidence,
          timestamp: new Date().toISOString()
        });
        return null;
      }

      // Create output object - classification ONLY
      const output = {
        event_id: eventId,
        ledger_position: ledgerRecord.position,
        classification: classification.classification,
        confidence: classification.confidence,
        matched_rules: classification.matchedRules,
        actionable: classification.confidence >= 0.3, // Explicit actionable flag
        timestamp: Date.now(),
        iso_timestamp: new Date().toISOString()
      };

      // Emit classification result
      this.emit('event_classified', output);
      
      console.log(`[CASCADE V2] Classified: ${eventId} -> ${classification.classification} (${classification.confidence.toFixed(2)})`);
      
      return output;
      
    } catch (error) {
      this.stats.processingErrors++;
      console.error(`[CASCADE V2] Error processing ${eventId}:`, error);
      
      // Emit error
      this.emit('classification_error', {
        event_id: eventId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      
      return null;
    }
  }

  // Classify event based on rules
  classify(ledgerRecord) {
    const event = ledgerRecord.event;
    const matches = [];
    
    // Check each rule
    for (const [ruleName, rule] of this.classificationRules) {
      const match = this.checkRule(event, rule);
      if (match.matches) {
        matches.push({
          rule: ruleName,
          classification: rule.classification,
          confidence: rule.confidence * match.confidence,
          matchedPatterns: match.patterns
        });
      }
    }

    // Determine final classification
    if (matches.length === 0) {
      return {
        classification: 'UNKNOWN_ANOMALY',
        confidence: 0.1,
        matchedRules: []
      };
    }

    // Use highest confidence match
    const bestMatch = matches.reduce((best, current) => 
      current.confidence > best.confidence ? current : best
    );

    return {
      classification: bestMatch.classification,
      confidence: Math.min(bestMatch.confidence, 1.0),
      matchedRules: [bestMatch.rule]
    };
  }

  // Check if event matches a rule
  checkRule(event, rule) {
    let matches = true;
    let confidence = 1.0;
    const matchedPatterns = [];

    for (const pattern of rule.patterns) {
      let patternMatches = false;
      
      if (pattern.value !== undefined) {
        // Exact value match
        patternMatches = this.getNestedValue(event, pattern.field) === pattern.value;
      } else if (pattern.pattern !== undefined) {
        // Regex pattern match
        const value = this.getNestedValue(event, pattern.field);
        patternMatches = value && pattern.pattern.test(value.toString());
      } else if (pattern.exists !== undefined) {
        // Field existence check
        patternMatches = this.getNestedValue(event, pattern.field) !== undefined;
      }

      if (!patternMatches) {
        matches = false;
        break;
      }

      matchedPatterns.push(pattern.field);
    }

    return {
      matches,
      confidence,
      patterns: matchedPatterns
    };
  }

  // Get nested value from object
  getNestedValue(obj, path) {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }

  // Process all unprocessed events
  async processUnprocessedEvents() {
    if (this.isProcessing) {
      console.log('[CASCADE V2] Already processing, skipping');
      return;
    }

    this.isProcessing = true;
    console.log('[CASCADE V2] Processing unprocessed events...');

    try {
      // Get all events from ledger
      const allEvents = rawEventLedgerV2.getRange(this.lastProcessedPosition + 1);
      
      for (const ledgerRecord of allEvents) {
        await this.processEvent(ledgerRecord.id);
        this.lastProcessedPosition = ledgerRecord.position;
      }

      console.log(`[CASCADE V2] Processed ${allEvents.length} events`);
      
    } catch (error) {
      console.error('[CASCADE V2] Batch processing error:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  // Replay and reclassify events
  async reclassifyEvents(fromPosition, toPosition) {
    console.log(`[CASCADE V2] Reclassifying events ${fromPosition} to ${toPosition}`);
    
    const events = rawEventLedgerV2.getRange(fromPosition, toPosition + 1);
    const results = [];
    
    for (const ledgerRecord of events) {
      const result = await this.processEvent(ledgerRecord.id);
      results.push(result);
    }
    
    return results;
  }

  // Update statistics
  updateStats(classification) {
    this.stats.totalProcessed++;
    
    // Track classifications
    const count = this.stats.classifications.get(classification.classification) || 0;
    this.stats.classifications.set(classification.classification, count + 1);
    
    // Track confidence distribution
    if (classification.confidence > 0.8) {
      this.stats.confidenceDistribution.high++;
    } else if (classification.confidence >= 0.5) {
      this.stats.confidenceDistribution.medium++;
    } else {
      this.stats.confidenceDistribution.low++;
    }
  }

  // Get statistics
  getStats() {
    return {
      ...this.stats,
      classifications: Object.fromEntries(this.stats.classifications),
      isProcessing: this.isProcessing,
      lastProcessedPosition: this.lastProcessedPosition,
      totalRules: this.classificationRules.size
    };
  }

  // Add classification rule
  addClassificationRule(name, rule) {
    this.classificationRules.set(name, rule);
    console.log(`[CASCADE V2] Added classification rule: ${name}`);
  }

  // Remove classification rule
  removeClassificationRule(name) {
    this.classificationRules.delete(name);
    console.log(`[CASCADE V2] Removed classification rule: ${name}`);
  }

  // Get info
  getInfo() {
    return {
      type: 'CASCADE_CLASSIFIER_V2',
      description: 'Classification ONLY - No side effects',
      rules: [
        'READ from RAW LEDGER only',
        'OUTPUT classification objects only',
        'NO routing',
        'NO repair logic',
        'NO emissions',
        'NO side effects'
      ],
      stats: this.getStats()
    };
  }
}

// Create singleton
const cascadeClassifierV2 = new CascadeClassifierV2();

// Start processing when ledger gets new events
rawEventLedgerV2.on('event_appended', (eventInfo) => {
  // Process new events asynchronously
  setImmediate(() => {
    cascadeClassifierV2.processEvent(eventInfo.id);
  });
});

module.exports = cascadeClassifierV2;
