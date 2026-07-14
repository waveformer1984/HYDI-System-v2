// KILO V2 - Analysis Only
// Reads CASCADE output and RAW LEDGER context
// Outputs hypotheses and suggested fixes
// NO execution authority, NO enforcement

const rawEventLedgerV2 = require('./raw-event-ledger-v2');
const cascadeClassifierV2 = require('./cascade-classifier-v2');
const { EventEmitter } = require('events');

class KiloAnalyzerV2 extends EventEmitter {
  constructor() {
    super();
    
    // Analysis rules for each classification
    this.analysisRules = new Map();
    this.initializeAnalysisRules();
    
    // Processing state
    this.analyzedEvents = new Set(); // event_id -> analysis timestamp
    
    // Statistics
    this.stats = {
      totalAnalyzed: 0,
      hypothesesByClassification: new Map(),
      averageHypothesesPerEvent: 0
    };
    
    console.log('[KILO V2] Initialized - Analysis ONLY');
    console.log('[KILO V2] RULE: Hypothesis generator only, no execution authority');
  }

  // Initialize analysis rules
  initializeAnalysisRules() {
    // Infrastructure failure analysis
    this.analysisRules.set('INFRA_FAILURE', {
      commonCauses: [
        'Service not running',
        'Port blocked or unavailable',
        'Resource exhaustion',
        'Network connectivity issues',
        'Configuration errors'
      ],
      suggestedFixes: [
        'Check service status and restart if needed',
        'Verify network connectivity and firewall rules',
        'Monitor resource utilization (CPU, memory, disk)',
        'Validate configuration files',
        'Check logs for detailed error information'
      ],
      investigationSteps: [
        'Ping the service endpoint',
        'Check system resource usage',
        'Review recent deployments or changes',
        'Examine error logs and stack traces',
        'Verify environment variables'
      ]
    });

    // Route failure analysis
    this.analysisRules.set('ROUTE_FAILURE', {
      commonCauses: [
        'Route not defined',
        'Controller missing',
        'URL pattern mismatch',
        'Middleware blocking request',
        'API version mismatch'
      ],
      suggestedFixes: [
        'Verify route registration in routing table',
        'Check controller method exists',
        'Validate URL pattern syntax',
        'Review middleware configuration',
        'Ensure correct API version endpoint'
      ],
      investigationSteps: [
        'List all registered routes',
        'Check route matching order',
        'Test with curl or Postman',
        'Review routing configuration',
        'Check for conflicting routes'
      ]
    });

    // Deployment mismatch analysis
    this.analysisRules.set('DEPLOYMENT_MISMATCH', {
      commonCauses: [
        'Missing environment variables',
        'Incorrect build configuration',
        'Version incompatibility',
        'Missing dependencies',
        'Platform-specific issues'
      ],
      suggestedFixes: [
        'Update environment variables',
        'Rebuild with correct configuration',
        'Check version compatibility matrix',
        'Install missing dependencies',
        'Verify platform requirements'
      ],
      investigationSteps: [
        'Compare environment configs',
        'Check build logs for errors',
        'Verify dependency versions',
        'Test in staging environment',
        'Review deployment checklist'
      ]
    });

    // Data integrity risk analysis
    this.analysisRules.set('DATA_INTEGRITY_RISK', {
      commonCauses: [
        'Corrupted data files',
        'Database connection issues',
        'Invalid data format',
        'Concurrent access conflicts',
        'Storage device failures'
      ],
      suggestedFixes: [
        'Restore from backup if available',
        'Run data validation and repair',
        'Check database consistency',
        'Implement proper locking mechanisms',
        'Verify storage device health'
      ],
      investigationSteps: [
        'Run checksum verification',
        'Check database logs',
        'Test data access patterns',
        'Review recent data modifications',
        'Verify backup integrity'
      ]
    });

    // Stream break analysis
    this.analysisRules.set('STREAM_BREAK', {
      commonCauses: [
        'WebSocket connection dropped',
        'Server restart',
        'Network interruption',
        'Client disconnection',
        'SSE timeout'
      ],
      suggestedFixes: [
        'Implement automatic reconnection',
        'Add connection health monitoring',
        'Increase timeout values',
        'Use connection pooling',
        'Add heartbeat mechanism'
      ],
      investigationSteps: [
        'Check connection logs',
        'Monitor network stability',
        'Test reconnection logic',
        'Verify server uptime',
        'Review client connection handling'
      ]
    });

    console.log(`[KILO V2] Loaded ${this.analysisRules.size} analysis rules`);
  }

  // Analyze event - READ from CASCADE and RAW LEDGER
  async analyzeEvent(eventId, cascadeClassification) {
    try {
      // FINGERPRINT GUARD: Prevent duplicate analysis of same event
      if (this.analyzedEvents.has(eventId)) {
        console.log(`[KILO V2] SKIPPING: Already analyzed ${eventId}`);
        return null;
      }
      
      // Get full context from RAW LEDGER
      const ledgerRecord = rawEventLedgerV2.getById(eventId);
      if (!ledgerRecord) {
        throw new Error(`Event not found in ledger: ${eventId}`);
      }

      // Get recent events for context
      const recentEvents = rawEventLedgerV2.getRange(
        Math.max(0, ledgerRecord.position - 10),
        ledgerRecord.position
      );

      // Generate hypotheses
      const hypotheses = this.generateHypotheses(
        cascadeClassification,
        ledgerRecord,
        recentEvents
      );

      // Create analysis output
      const analysis = {
        event_id: eventId,
        ledger_position: ledgerRecord.position,
        classification: cascadeClassification.classification,
        confidence: cascadeClassification.confidence,
        hypotheses: hypotheses.hypotheses,
        suggested_fixes: hypotheses.suggestedFixes,
        investigation_steps: hypotheses.investigationSteps,
        context_summary: this.summarizeContext(recentEvents),
        timestamp: Date.now(),
        iso_timestamp: new Date().toISOString()
      };

      // Track analysis
      this.analyzedEvents.add(eventId);
      this.updateStats(analysis);

      // Emit analysis result
      this.emit('event_analyzed', analysis);
      
      console.log(`[KILO V2] Analyzed: ${eventId} -> ${hypotheses.hypotheses.length} hypotheses`);
      
      return analysis;
      
    } catch (error) {
      console.error(`[KILO V2] Error analyzing ${eventId}:`, error);
      
      // Emit error
      this.emit('analysis_error', {
        event_id: eventId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      
      return null;
    }
  }

  // Generate hypotheses based on classification and context
  generateHypotheses(classification, ledgerRecord, recentEvents) {
    const rule = this.analysisRules.get(classification.classification);
    
    if (!rule) {
      return {
        hypotheses: ['Unknown classification - requires manual investigation'],
        suggested_fixes: ['Investigate manually'],
        investigation_steps: ['Review event details']
      };
    }

    // Analyze context to prioritize hypotheses
    const context = this.analyzeContext(recentEvents, ledgerRecord);
    
    // Prioritize hypotheses based on context
    const prioritizedHypotheses = this.prioritizeHypotheses(
      rule.commonCauses,
      context
    );

    // Adjust suggested fixes based on context
    const adjustedFixes = this.adjustFixes(rule.suggestedFixes, context);

    return {
      hypotheses: prioritizedHypotheses,
      suggested_fixes: adjustedFixes,
      investigation_steps: rule.investigationSteps
    };
  }

  // Analyze context from recent events
  analyzeContext(recentEvents, currentEvent) {
    const context = {
      similarEvents: 0,
      errorPattern: null,
      affectedServices: new Set(),
      timeSpan: 0
    };

    if (recentEvents.length > 0) {
      const oldestEvent = recentEvents[0];
      context.timeSpan = currentEvent.timestamp - oldestEvent.timestamp;
    }

    // Count similar events
    for (const event of recentEvents) {
      if (event.event.type === currentEvent.event.type) {
        context.similarEvents++;
      }
      
      // Track affected services
      if (event.event.payload && event.event.payload.service) {
        context.affectedServices.add(event.event.payload.service);
      }
    }

    // Detect error patterns
    if (context.similarEvents > 3) {
      context.errorPattern = 'recurring';
    } else if (context.timeSpan < 60000 && context.similarEvents > 1) {
      context.errorPattern = 'burst';
    }

    return context;
  }

  // Prioritize hypotheses based on context
  prioritizeHypotheses(hypotheses, context) {
    const prioritized = [...hypotheses];
    
    // Boost priority based on context
    if (context.errorPattern === 'recurring') {
      // Move resource-related issues higher
      const resourceIndex = prioritized.findIndex(h => 
        h.toLowerCase().includes('resource') || h.toLowerCase().includes('exhaustion')
      );
      if (resourceIndex > 0) {
        const [item] = prioritized.splice(resourceIndex, 1);
        prioritized.unshift(item);
      }
    }
    
    if (context.affectedServices.size > 1) {
      // Boost network/connectivity issues
      const networkIndex = prioritized.findIndex(h => 
        h.toLowerCase().includes('network') || h.toLowerCase().includes('connectivity')
      );
      if (networkIndex > 0) {
        const [item] = prioritized.splice(networkIndex, 1);
        prioritized.unshift(item);
      }
    }
    
    return prioritized;
  }

  // Adjust fixes based on context
  adjustFixes(fixes, context) {
    const adjusted = [...fixes];
    
    // Add context-specific fixes
    if (context.errorPattern === 'recurring') {
      adjusted.push('Implement monitoring to prevent recurrence');
      adjusted.push('Consider scaling resources');
    }
    
    if (context.timeSpan < 60000) {
      adjusted.unshift('Check for recent deployments or changes');
    }
    
    return adjusted;
  }

  // Summarize context
  summarizeContext(recentEvents) {
    if (recentEvents.length === 0) {
      return 'No recent events for context';
    }
    
    const types = {};
    const sources = {};
    
    for (const event of recentEvents) {
      types[event.event.type] = (types[event.event.type] || 0) + 1;
      sources[event.event.source] = (sources[event.event.source] || 0) + 1;
    }
    
    return {
      recent_events_count: recentEvents.length,
      event_types: types,
      sources: sources,
      time_span_minutes: Math.round((recentEvents[recentEvents.length - 1].timestamp - recentEvents[0].timestamp) / 60000)
    };
  }

  // Update statistics
  updateStats(analysis) {
    this.stats.totalAnalyzed++;
    
    // Track hypotheses by classification
    const count = this.stats.hypothesesByClassification.get(analysis.classification) || 0;
    this.stats.hypothesesByClassification.set(analysis.classification, count + analysis.hypotheses.length);
    
    // Calculate average
    this.stats.averageHypothesesPerEvent = 
      Array.from(this.stats.hypothesesByClassification.values()).reduce((a, b) => a + b, 0) / 
      this.stats.hypothesesByClassification.size || 0;
  }

  // Get statistics
  getStats() {
    return {
      ...this.stats,
      hypothesesByClassification: Object.fromEntries(this.stats.hypothesesByClassification),
      analyzedEventsCount: this.analyzedEvents.size
    };
  }

  // Get info
  getInfo() {
    return {
      type: 'KILO_ANALYZER_V2',
      description: 'Analysis ONLY - Hypothesis generator',
      rules: [
        'READ from CASCADE and RAW LEDGER',
        'OUTPUT hypotheses and suggestions',
        'NO execution authority',
        'NO enforcement',
        'NO direct system modifications'
      ],
      stats: this.getStats()
    };
  }
}

// Create singleton
const kiloAnalyzerV2 = new KiloAnalyzerV2();

// Analyze events when CASCADE classifies them
cascadeClassifierV2.on('event_classified', (classification) => {
  // Analyze asynchronously
  setImmediate(() => {
    kiloAnalyzerV2.analyzeEvent(classification.event_id, classification);
  });
});

module.exports = kiloAnalyzerV2;
