// Ingestion Layer V2 - Dumb Pipes Only
// Accepts events from all sources, normalizes ONLY structure, pushes to RAW LEDGER
// NO interpretation, NO classification, NO meaning

const rawEventLedgerV2 = require('./replay-family/raw-event-ledger-v2');
const { EventEmitter } = require('events');

class IngestionLayerV2 extends EventEmitter {
  constructor() {
    super();
    
    // Accepted sources
    this.acceptedSources = new Set([
      'vercel',
      'local',
      'supabase',
      'ui',
      'api',
      'websocket',
      'cron',
      'external'
    ]);
    
    // Required structure (minimal)
    this.requiredFields = ['source', 'type'];
    
    // Statistics
    this.stats = {
      totalReceived: 0,
      totalAccepted: 0,
      totalRejected: 0,
      rejectionsByReason: new Map()
    };
    
    console.log('[INGESTION V2] Initialized - Dumb pipes only');
    console.log('[INGESTION V2] RULE: Normalize structure ONLY, no meaning interpretation');
  }

  // Ingest event from any source
  async ingest(rawEvent, sourceContext = {}) {
    this.stats.totalReceived++;
    
    try {
      // Normalize structure ONLY
      const normalizedEvent = this.normalizeStructure(rawEvent, sourceContext);
      
      // Validate required fields
      const validation = this.validateStructure(normalizedEvent);
      if (!validation.valid) {
        this.reject('INVALID_STRUCTURE', validation.errors, rawEvent);
        return null;
      }
      
      // Accept and push to RAW LEDGER
      const ledgerRecord = await rawEventLedgerV2.append(normalizedEvent);
      this.stats.totalAccepted++;
      
      // Emit for downstream notification
      this.emit('event_ingested', {
        eventId: ledgerRecord.id,
        source: normalizedEvent.source,
        type: normalizedEvent.type,
        position: ledgerRecord.position
      });
      
      console.log(`[INGESTION V2] Ingested: ${normalizedEvent.source}/${normalizedEvent.type} -> position ${ledgerRecord.position}`);
      
      return ledgerRecord;
      
    } catch (error) {
      this.reject('PROCESSING_ERROR', [error.message], rawEvent);
      console.error('[INGESTION V2] Processing error:', error);
      return null;
    }
  }

  // Normalize structure ONLY - no meaning changes
  normalizeStructure(rawEvent, sourceContext) {
    // Extract source
    let source = rawEvent.source || sourceContext.source || 'unknown';
    
    // Normalize source to accepted values
    if (!this.acceptedSources.has(source)) {
      source = 'external';
    }
    
    // Extract type
    let type = rawEvent.type || rawEvent.event_type || 'unknown';
    
    // Normalize type to lowercase
    type = type.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    
    // Create normalized event - PRESERVE all original data
    const normalized = {
      source: source,
      type: type,
      payload: rawEvent.payload || rawEvent.data || rawEvent,
      metadata: {
        original_source: rawEvent.source,
        original_type: rawEvent.type || rawEvent.event_type,
        received_at: Date.now(),
        received_from: sourceContext.receivedFrom || 'direct',
        ingress_point: sourceContext.ingressPoint || 'api'
      }
    };
    
    // Preserve any additional fields but don't interpret them
    Object.keys(rawEvent).forEach(key => {
      if (!['source', 'type', 'payload', 'data', 'event_type'].includes(key)) {
        normalized.metadata[key] = rawEvent[key];
      }
    });
    
    return normalized;
  }

  // Validate structure only
  validateStructure(event) {
    const errors = [];
    
    // Check required fields
    if (!event.source) {
      errors.push('Missing required field: source');
    }
    
    if (!event.type) {
      errors.push('Missing required field: type');
    }
    
    // Check source is accepted
    if (!this.acceptedSources.has(event.source)) {
      errors.push(`Source not accepted: ${event.source}`);
    }
    
    // Check type format
    if (event.type && !/^[a-z0-9_]+$/.test(event.type)) {
      errors.push('Type must contain only lowercase letters, numbers, and underscores');
    }
    
    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  // Reject event
  reject(reason, errors, originalEvent) {
    this.stats.totalRejected++;
    
    // Track rejection reasons
    this.stats.rejectionsByReason.set(
      reason,
      (this.stats.rejectionsByReason.get(reason) || 0) + 1
    );
    
    // Emit rejection event
    this.emit('event_rejected', {
      reason: reason,
      errors: errors,
      originalEvent: this.sanitizeForLogging(originalEvent),
      timestamp: new Date().toISOString()
    });
    
    console.warn(`[INGESTION V2] Rejected event: ${reason} - ${errors.join(', ')}`);
  }

  // Sanitize event for logging
  sanitizeForLogging(event) {
    const sanitized = { ...event };
    
    // Remove sensitive fields
    if (sanitized.payload) {
      if (typeof sanitized.payload === 'object') {
        sanitized.payload = {
          _type: typeof sanitized.payload,
          _keys: Object.keys(sanitized.payload),
          _size: JSON.stringify(sanitized.payload).length
        };
      } else {
        sanitized.payload = typeof sanitized.payload;
      }
    }
    
    return sanitized;
  }

  // Batch ingest multiple events
  async ingestBatch(events, sourceContext = {}) {
    const results = [];
    
    for (const event of events) {
      const result = await this.ingest(event, sourceContext);
      results.push(result);
    }
    
    return results;
  }

  // Get statistics
  getStats() {
    return {
      ...this.stats,
      rejectionsByReason: Object.fromEntries(this.stats.rejectionsByReason),
      acceptanceRate: this.stats.totalReceived > 0 
        ? (this.stats.totalAccepted / this.stats.totalReceived * 100).toFixed(2) + '%'
        : '0%'
    };
  }

  // Get accepted sources
  getAcceptedSources() {
    return Array.from(this.acceptedSources);
  }

  // Add accepted source
  addAcceptedSource(source) {
    this.acceptedSources.add(source);
    console.log(`[INGESTION V2] Added accepted source: ${source}`);
  }

  // Remove accepted source
  removeAcceptedSource(source) {
    this.acceptedSources.delete(source);
    console.log(`[INGESTION V2] Removed accepted source: ${source}`);
  }

  // Get info
  getInfo() {
    return {
      type: 'INGESTION_LAYER_V2',
      description: 'Dumb pipes - Structure normalization only',
      rules: [
        'Normalize structure ONLY',
        'No meaning interpretation',
        'No classification',
        'No validation of content',
        'Push everything to RAW LEDGER'
      ],
      acceptedSources: this.getAcceptedSources(),
      stats: this.getStats()
    };
  }
}

// Create singleton
const ingestionLayerV2 = new IngestionLayerV2();

module.exports = ingestionLayerV2;
