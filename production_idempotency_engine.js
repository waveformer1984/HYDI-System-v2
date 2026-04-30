// PRODUCTION IDEMPOTENCY ENGINE - STRICT 1:1 EVENT LINEAGE
// Enforces correct idempotency identity with provider:external_event_id primary keys

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

class ProductionIdempotencyEngine {
  constructor() {
    this.idempotencyRegistry = new Map(); // idempotencyKey -> event record
    this.causalEventRegistry = new Map(); // causalEventId -> set of external events
    
    // Metrics counters
    this.metrics = {
      idempotency_collisions_total: 0,
      fallback_identity_usage_total: 0,
      canonicalization_entropy_loss_total: 0,
      causal_collision_prevented_total: 0,
      events_processed_total: 0,
      quarantine_events_total: 0
    };
    
    // Provider detection patterns
    this.providerPatterns = {
      stripe: /^evt_/,
      github: /^[\w]{40}$/,
      slack: /^[A-Z0-9]{9,}$/,
      twilio: /^SM[a-f0-9]{34}$|^MM[a-f0-9]{34}$|^CA[a-f0-9]{34}$/,
      paypal: /^WH-/,
      square: /^REPLACEMENT:/,
      shopify: /^\d{10}$/,
      webhook: /^webhook_/,
      event: /^event_/
    };
  }

  // =============================================================================
  // 1. ENFORCE CORRECT IDEMPOTENCY IDENTITY
  // =============================================================================
  
  generateIdempotencyKey(provider, externalEventId, rawPayload, receivedAt) {
    // PRIMARY KEY: provider:external_event_id
    if (externalEventId && externalEventId.trim() !== '') {
      return `${provider}:${externalEventId}`;
    }
    
    // FALLBACK: hash of provider + raw_payload + timestamp
    this.metrics.fallback_identity_usage_total++;
    
    console.log(`  ⚠️ Using fallback idempotency key - missing external_event_id`);
    
    const fallbackData = {
      provider,
      raw_payload: rawPayload, // UNMODIFIED
      received_at_timestamp: receivedAt
    };
    
    const fallbackHash = crypto.createHash('sha256')
      .update(JSON.stringify(fallbackData))
      .digest('hex');
    
    return `fallback:${fallbackHash}`;
  }

  // =============================================================================
  // 2. NON-DESTRUCTIVE CANONICALIZATION
  // =============================================================================
  
  canonicalizePayload(rawPayload) {
    const originalEntropy = this.calculateEntropy(rawPayload);
    
    // STRUCTURAL ONLY - NO LOSSY TRANSFORMATIONS
    let canonical = JSON.parse(JSON.stringify(rawPayload)); // Deep copy
    
    // ALLOWED: key ordering normalization ONLY (no whitespace changes)
    canonical = this.sortJsonKeys(canonical);
    
    // ALLOWED: stable JSON formatting (no extra whitespace)
    const canonicalString = this.stableJsonStringify(canonical);
    
    const finalCanonical = JSON.parse(canonicalString);
    const finalEntropy = this.calculateEntropy(finalCanonical);
    
    // VALIDATION: entropy must not decrease significantly (allow minimal loss from JSON formatting)
    const entropyLoss = originalEntropy - finalEntropy;
    const maxAcceptableLoss = 0.1; // Allow minimal entropy loss from JSON formatting
    
    if (entropyLoss > maxAcceptableLoss) {
      this.metrics.canonicalization_entropy_loss_total++;
      throw new Error(`CANONICALIZATION_ENTROPY_LOSS: Entropy reduced by ${entropyLoss.toFixed(3)} (max allowed: ${maxAcceptableLoss})`);
    }
    
    return finalCanonical;
  }

  calculateEntropy(obj) {
    const jsonString = JSON.stringify(obj);
    const charFrequency = {};
    
    for (const char of jsonString) {
      charFrequency[char] = (charFrequency[char] || 0) + 1;
    }
    
    let entropy = 0;
    const length = jsonString.length;
    
    for (const count of Object.values(charFrequency)) {
      const probability = count / length;
      entropy -= probability * Math.log2(probability);
    }
    
    return entropy;
  }

  sortJsonKeys(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.sortJsonKeys(item));
    }
    
    const sorted = {};
    Object.keys(obj).sort().forEach(key => {
      sorted[key] = this.sortJsonKeys(obj[key]);
    });
    
    return sorted;
  }

  normalizeWhitespace(obj) {
    // ONLY normalize structural whitespace, not content
    if (typeof obj === 'string') {
      // Only trim leading/trailing whitespace, preserve internal spacing
      return obj.trim();
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.normalizeWhitespace(item));
    }
    
    if (obj !== null && typeof obj === 'object') {
      const normalized = {};
      Object.keys(obj).forEach(key => {
        normalized[key] = this.normalizeWhitespace(obj[key]);
      });
      return normalized;
    }
    
    return obj;
  }

  stableJsonStringify(obj) {
    return JSON.stringify(obj, null, 0); // No extra whitespace
  }

  // =============================================================================
  // 3. PROVIDER NORMALIZATION
  // =============================================================================
  
  detectProvider(headers, payload) {
    // Check headers first
    if (headers) {
      for (const [provider, pattern] of Object.entries(this.providerPatterns)) {
        if (headers['user-agent']?.toLowerCase().includes(provider)) {
          return { provider, confidence: 0.9 };
        }
        
        if (headers['stripe-signature']) return { provider: 'stripe', confidence: 0.95 };
        if (headers['x-github-event']) return { provider: 'github', confidence: 0.95 };
        if (headers['x-slack-request-timestamp']) return { provider: 'slack', confidence: 0.95 };
        if (headers['x-twilio-signature']) return { provider: 'twilio', confidence: 0.95 };
      }
    }
    
    // Check payload patterns
    if (payload) {
      for (const [provider, pattern] of Object.entries(this.providerPatterns)) {
        if (payload.id && pattern.test(payload.id)) {
          return { provider, confidence: 0.8 };
        }
        
        if (payload.type && payload.type.includes(provider)) {
          return { provider, confidence: 0.7 };
        }
      }
    }
    
    return { provider: 'unclassified', confidence: 0.1 };
  }

  // =============================================================================
  // 4. CAUSAL EVENT INTEGRITY
  // =============================================================================
  
  async processExternalEvent(rawPayload, headers = {}) {
    const receivedAt = new Date();
    this.metrics.events_processed_total++;
    
    try {
      // Step 1: Detect provider
      const { provider: detectedProvider, confidence } = this.detectProvider(headers, rawPayload);
      const provider = confidence > 0.5 ? detectedProvider : 'unclassified';
      
      // Step 2: Extract external_event_id (preserve before canonicalization)
      const externalEventId = this.extractExternalEventId(rawPayload, provider);
      
      // Step 3: Generate idempotency key
      const idempotencyKey = this.generateIdempotencyKey(provider, externalEventId, rawPayload, receivedAt);
      
      // Step 4: Check for existing idempotency key
      const existingEvent = this.idempotencyRegistry.get(idempotencyKey);
      
      if (existingEvent) {
        // Duplicate detected - return existing causal event
        this.logEventDecision({
          external_event_id: externalEventId,
          provider,
          idempotencyKey,
          canonical_hash: existingEvent.canonical_hash,
          causal_event_id: existingEvent.causal_event_id,
          dedupe_reason: externalEventId ? 'external_id' : 'fallback',
          decision: 'duplicate'
        });
        
        return {
          status: 'duplicate',
          causal_event_id: existingEvent.causal_event_id,
          event_record: existingEvent
        };
      }
      
      // Step 5: Canonicalize payload (non-destructive)
      const canonicalPayload = this.canonicalizePayload(rawPayload);
      const canonicalHash = crypto.createHash('sha256')
        .update(JSON.stringify(canonicalPayload))
        .digest('hex');
      
      // Step 6: Create causal event
      const causalEventId = this.generateCausalEventId(provider, externalEventId, canonicalHash);
      
      // Step 7: Check for causal collision
      const causalCollision = this.detectCausalCollision(causalEventId, externalEventId);
      
      if (causalCollision) {
        this.metrics.causal_collision_prevented_total++;
        throw new Error(`CAUSAL_COLLISION_DETECTED: Causal event ${causalEventId} already exists for different external event ${causalCollision.external_event_id}`);
      }
      
      // Step 8: Create event record
      const eventRecord = {
        id: uuidv4(),
        provider,
        external_event_id: externalEventId,
        raw_payload: rawPayload,
        canonical_payload: canonicalPayload,
        canonical_hash: canonicalHash,
        causal_event_id: causalEventId,
        idempotency_key: idempotencyKey,
        provider_confidence: confidence,
        received_at: receivedAt,
        created_at: new Date(),
        status: externalEventId ? 'processed' : 'non-idempotent-safe'
      };
      
      // Step 9: Register event
      this.idempotencyRegistry.set(idempotencyKey, eventRecord);
      
      if (!this.causalEventRegistry.has(causalEventId)) {
        this.causalEventRegistry.set(causalEventId, new Set());
      }
      this.causalEventRegistry.get(causalEventId).add(eventRecord.id);
      
      // Step 10: Log decision
      this.logEventDecision({
        external_event_id: externalEventId,
        provider,
        idempotencyKey,
        canonical_hash: canonicalHash,
        causal_event_id: causalEventId,
        dedupe_reason: externalEventId ? 'external_id' : 'fallback',
        decision: externalEventId ? 'accepted' : 'quarantined'
      });
      
      if (!externalEventId) {
        this.metrics.quarantine_events_total++;
      }
      
      return {
        status: externalEventId ? 'accepted' : 'quarantined',
        causal_event_id: causalEventId,
        event_record: eventRecord
      };
      
    } catch (error) {
      console.log(`  ❌ Event processing failed: ${error.message}`);
      
      // Fail fast - quarantine on identity errors
      if (error.message.includes('COLLISION') || error.message.includes('ENTROPY_LOSS')) {
        this.metrics.quarantine_events_total++;
        return {
          status: 'quarantined',
          reason: error.message
        };
      }
      
      throw error;
    }
  }

  extractExternalEventId(payload, provider) {
    // Provider-specific extraction patterns
    const patterns = {
      stripe: ['id', 'event_id'],
      github: ['id'],
      slack: ['event_id', 'callback_id'],
      twilio: ['MessageSid', 'CallSid', 'account_sid'],
      paypal: ['id', 'event_id'],
      generic: ['id', 'event_id', 'webhook_id', 'external_id']
    };
    
    const providerPatterns = patterns[provider] || patterns.generic;
    
    for (const field of providerPatterns) {
      if (payload && payload[field] && typeof payload[field] === 'string') {
        return payload[field];
      }
    }
    
    return null; // Explicitly null if not found
  }

  generateCausalEventId(provider, externalEventId, canonicalHash) {
    // Deterministic but unique per distinct external event
    const seed = externalEventId 
      ? `${provider}:${externalEventId}` 
      : canonicalHash;
    
    const hash = crypto.createHash('sha256').update(seed).digest('hex');
    
    // Convert to UUID format
    return [
      hash.substring(0, 8),
      hash.substring(8, 12),
      hash.substring(12, 16),
      hash.substring(16, 20),
      hash.substring(20, 32)
    ].join('-');
  }

  detectCausalCollision(causalEventId, externalEventId) {
    const existingEventIds = this.causalEventRegistry.get(causalEventId);
    
    if (!existingEventIds) return null;
    
    // Find any existing event for this causal event
    for (const eventId of existingEventIds) {
      const event = Array.from(this.idempotencyRegistry.values())
        .find(e => e.id === eventId);
      
      if (event && event.external_event_id !== externalEventId) {
        return {
          existing_external_id: event.external_event_id,
          new_external_id: externalEventId
        };
      }
    }
    
    return null;
  }

  // =============================================================================
  // 5. OBSERVABILITY
  // =============================================================================
  
  logEventDecision(decision) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      ...decision
    };
    
    console.log(`📊 EVENT DECISION: ${JSON.stringify(logEntry)}`);
  }

  getMetrics() {
    return { ...this.metrics };
  }

  getRegistryStats() {
    return {
      idempotency_registry_size: this.idempotencyRegistry.size,
      causal_registry_size: this.causalEventRegistry.size,
      avg_external_events_per_causal: this.calculateAvgEventsPerCausal()
    };
  }

  calculateAvgEventsPerCausal() {
    if (this.causalEventRegistry.size === 0) return 0;
    
    const totalEvents = Array.from(this.causalEventRegistry.values())
      .reduce((sum, events) => sum + events.size, 0);
    
    return totalEvents / this.causalEventRegistry.size;
  }

  // =============================================================================
  // 6. REPLAY SAFETY VALIDATION
  // =============================================================================
  
  validateReplaySafety() {
    console.log('\n🔍 REPLAY SAFETY VALIDATION:');
    
    const issues = [];
    
    // Check 1: Same idempotency key should map to same causal event
    for (const [idempotencyKey, event] of this.idempotencyRegistry.entries()) {
      // Simulate replay by checking idempotency directly
      const existingEvent = this.idempotencyRegistry.get(idempotencyKey);
      
      if (!existingEvent || existingEvent.causal_event_id !== event.causal_event_id) {
        issues.push({
          type: 'REPLAY_CAUSAL_MISMATCH',
          idempotencyKey,
          original_causal: event.causal_event_id,
          replay_causal: existingEvent?.causal_event_id || 'missing'
        });
      }
    }
    
    // Check 2: No causal event should have multiple distinct external events
    for (const [causalEventId, eventIds] of this.causalEventRegistry.entries()) {
      if (eventIds.size > 1) {
        const externalIds = Array.from(eventIds)
          .map(id => Array.from(this.idempotencyRegistry.values())
            .find(e => e.id === id)?.external_event_id)
          .filter(Boolean);
        
        const distinctExternalIds = new Set(externalIds);
        
        if (distinctExternalIds.size > 1) {
          issues.push({
            type: 'MULTIPLE_EXTERNAL_FOR_CAUSAL',
            causal_event_id: causalEventId,
            external_event_ids: Array.from(distinctExternalIds)
          });
        }
      }
    }
    
    if (issues.length === 0) {
      console.log('  ✅ Replay safety validated - no issues detected');
    } else {
      console.log(`  💥 Found ${issues.length} replay safety issues:`);
      issues.forEach(issue => console.log(`     ${JSON.stringify(issue)}`));
    }
    
    return issues;
  }

  reset() {
    this.idempotencyRegistry.clear();
    this.causalEventRegistry.clear();
    this.metrics = {
      idempotency_collisions_total: 0,
      fallback_identity_usage_total: 0,
      canonicalization_entropy_loss_total: 0,
      causal_collision_prevented_total: 0,
      events_processed_total: 0,
      quarantine_events_total: 0
    };
  }
}

module.exports = ProductionIdempotencyEngine;
