// STRICT IDENTITY PROCESSOR - FIXING IDENTITY COLLISION
// Separate 3 identities explicitly with proper collision detection

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

class StrictIdentityProcessor {
  constructor() {
    this.webhookInbox = new Map(); // Simulates webhook_events table
    this.causalSpine = new Map(); // Simulates global_causal_spine
    
    this.trustworthyProviders = ['stripe', 'github', 'slack', 'twilio'];
    
    this.processingMetrics = {
      eventsReceived: 0,
      eventsQuarantined: 0,
      eventsProcessed: 0,
      duplicateCollisions: 0,
      deliveryCollisions: 0,
      contentCollisions: 0,
      causalMappingViolations: 0
    };
  }

  // =============================================================================
  // 1) SEPARATE 3 IDENTITIES EXPLICITLY
  // =============================================================================
  
  validateDeliveryIdentity(provider, externalEventId) {
    const hasExternalId = externalEventId && externalEventId.trim() !== '';
    
    if (this.trustworthyProviders.includes(provider) && hasExternalId) {
      return { isValid: true, trustLevel: 'high', quarantineReason: null };
    } else if (hasExternalId) {
      return { isValid: true, trustLevel: 'medium', quarantineReason: null };
    } else {
      return { 
        isValid: false, 
        trustLevel: 'low', 
        quarantineReason: 'Weak delivery identity: unknown provider and no external event ID' 
      };
    }
  }

  canonicalizePayload(rawPayload) {
    // Strip transport-only fields
    let canonical = { ...rawPayload };
    delete canonical.delivery_id;
    delete canonical.attempt;
    delete canonical.receipt_time;
    delete canonical.signature_header;
    delete canonical.signature;
    
    // Deep sort keys recursively
    canonical = this.sortJsonKeys(canonical);
    
    // Normalize values
    canonical = this.normalizeValues(canonical);
    
    return canonical;
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

  normalizeValues(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.normalizeValues(item));
    }
    
    const normalized = {};
    Object.keys(obj).forEach(key => {
      const value = obj[key];
      
      if (typeof value === 'string') {
        normalized[key] = value.trim();
      } else if (typeof value === 'number') {
        normalized[key] = value;
      } else if (typeof value === 'object') {
        normalized[key] = this.normalizeValues(value);
      } else {
        normalized[key] = value;
      }
    });
    
    return normalized;
  }

  generatePayloadHash(canonicalPayload) {
    const payloadString = JSON.stringify(canonicalPayload);
    return crypto.createHash('sha256').update(payloadString).digest('hex');
  }

  // =============================================================================
  // 2) FAIL CLOSED FOR WEAK INGRESS
  // =============================================================================
  
  quarantineWeakIngress(provider, externalEventId, rawPayload) {
    const validation = this.validateDeliveryIdentity(provider, externalEventId);
    
    if (!validation.isValid) {
      const quarantinedEvent = {
        id: uuidv4(),
        provider: provider,
        external_event_id: externalEventId,
        raw_payload: rawPayload,
        status: 'quarantined',
        delivery_trustworthy: false,
        content_classified: false,
        causal_mapping_allowed: false,
        created_at: new Date()
      };
      
      this.webhookInbox.set(quarantinedEvent.id, quarantinedEvent);
      this.processingMetrics.eventsQuarantined++;
      
      console.log(`  🚫 Quarantined weak ingress: ${validation.quarantineReason}`);
      
      return quarantinedEvent.id;
    }
    
    return null; // Signal to continue with normal flow
  }

  // =============================================================================
  // 3) ADD COLLISION ASSERTIONS
  // =============================================================================
  
  detectDuplicateCollision(provider, externalEventId, canonicalPayloadHash) {
    // Check for delivery identity collision
    for (const event of this.webhookInbox.values()) {
      if (event.provider === provider && 
          event.external_event_id === externalEventId && 
          event.status !== 'failed') {
        
        if (event.canonical_payload_hash !== canonicalPayloadHash) {
          // Delivery collision: same external ID, different payload
          return {
            hasCollision: true,
            collisionType: 'DELIVERY_COLLISION',
            existingEventId: event.id,
            collisionDetails: {
              existing_hash: event.canonical_payload_hash,
              new_hash: canonicalPayloadHash,
              collision_type: 'delivery_identity'
            }
          };
        }
        
        // Same delivery identity and same payload - legitimate duplicate
        return {
          hasCollision: false,
          collisionType: 'LEGITIMATE_DUPLICATE',
          existingEventId: event.id,
          collisionDetails: null
        };
      }
    }
    
    // Check for content identity collision (same payload, different delivery)
    for (const event of this.webhookInbox.values()) {
      if (event.canonical_payload_hash === canonicalPayloadHash &&
          (event.provider !== provider || event.external_event_id !== externalEventId) &&
          event.status !== 'failed') {
        
        // Content collision: same payload, different delivery identity
        return {
          hasCollision: true,
          collisionType: 'CONTENT_COLLISION',
          existingEventId: event.id,
          collisionDetails: {
            existing_provider: event.provider,
            existing_external_id: event.external_event_id,
            new_provider: provider,
            new_external_id: externalEventId,
            collision_type: 'content_identity'
          }
        };
      }
    }
    
    // No collisions detected
    return {
      hasCollision: false,
      collisionType: 'NO_COLLISION',
      existingEventId: null,
      collisionDetails: null
    };
  }

  // =============================================================================
  // 4) PREVENT MANY-TO-ONE CAUSAL MAPPING
  // =============================================================================
  
  checkCausalMappingLimits(causalEventId, provider, externalEventId, canonicalPayloadHash) {
    const existingMappings = Array.from(this.webhookInbox.values())
      .filter(event => event.causal_event_id === causalEventId);
    
    if (existingMappings.length === 0) {
      return {
        mappingAllowed: true,
        reason: 'First mapping to causal event',
        currentMappingCount: 0
      };
    }
    
    const distinctDeliveryCount = new Set(
      existingMappings.map(e => `${e.provider}:${e.external_event_id || 'null'}`)
    ).size;
    
    const distinctContentCount = new Set(
      existingMappings.map(e => e.canonical_payload_hash)
    ).size;
    
    if (distinctDeliveryCount > 1 || distinctContentCount > 1) {
      return {
        mappingAllowed: false,
        reason: `Many-to-one mapping violation: ${distinctDeliveryCount} distinct deliveries, ${distinctContentCount} distinct content hashes already mapped to this causal event`,
        currentMappingCount: existingMappings.length
      };
    }
    
    return {
      mappingAllowed: true,
      reason: 'Additional identical mapping allowed',
      currentMappingCount: existingMappings.length
    };
  }

  // =============================================================================
  // 5) ENHANCED INGESTION FUNCTION WITH PROPER IDENTITY HANDLING
  // =============================================================================
  
  async insertWebhookEventStrict(provider, externalEventId, rawPayload) {
    console.log(`📥 Strict ingestion: ${provider}:${externalEventId}`);
    
    try {
      // Step 1: Canonicalize payload
      const canonicalPayload = this.canonicalizePayload(rawPayload);
      const payloadHash = this.generatePayloadHash(canonicalPayload);
      
      // Step 2: Fail closed for weak ingress
      const quarantineResult = this.quarantineWeakIngress(provider, externalEventId, rawPayload);
      
      if (quarantineResult) {
        return {
          inboxEventId: quarantineResult,
          status: 'quarantined',
          isDuplicate: false,
          collisionDetected: false,
          quarantineReason: 'Weak delivery identity'
        };
      }
      
      // Step 3: Check for legitimate duplicates
      const existingEvent = this.findLegitimateDuplicate(provider, externalEventId, payloadHash);
      
      if (existingEvent) {
        console.log(`  ⚠️ Legitimate duplicate detected`);
        return {
          inboxEventId: existingEvent.id,
          status: 'duplicate',
          isDuplicate: true,
          collisionDetected: false,
          quarantineReason: null
        };
      }
      
      // Step 4: Check for collisions
      const collisionCheck = this.detectDuplicateCollision(provider, externalEventId, payloadHash);
      
      if (collisionCheck.hasCollision) {
        console.log(`  💥 COLLISION DETECTED: ${collisionCheck.collisionType}`);
        this.processingMetrics.duplicateCollisions++;
        
        if (collisionCheck.collisionType === 'DELIVERY_COLLISION') {
          this.processingMetrics.deliveryCollisions++;
        } else if (collisionCheck.collisionType === 'CONTENT_COLLISION') {
          this.processingMetrics.contentCollisions++;
        }
        
        throw new Error(`DUPLICATE_COLLISION: ${collisionCheck.collisionType} detected. Details: ${JSON.stringify(collisionCheck.collisionDetails)}`);
      }
      
      // Step 5: Insert new event
      const inboxEvent = {
        id: uuidv4(),
        provider: provider,
        external_event_id: externalEventId,
        raw_payload: rawPayload,
        canonical_payload: canonicalPayload,
        canonical_payload_hash: payloadHash,
        status: 'received',
        delivery_trustworthy: this.validateDeliveryIdentity(provider, externalEventId).isValid,
        content_classified: true,
        causal_mapping_allowed: true,
        created_at: new Date()
      };
      
      this.webhookInbox.set(inboxEvent.id, inboxEvent);
      this.processingMetrics.eventsReceived++;
      
      console.log(`  ✅ Event ingested with strict identity handling`);
      
      return {
        inboxEventId: inboxEvent.id,
        status: 'received',
        isDuplicate: false,
        collisionDetected: false,
        quarantineReason: null
      };
      
    } catch (error) {
      console.log(`  ❌ Failed to ingest webhook: ${error.message}`);
      throw error;
    }
  }

  findLegitimateDuplicate(provider, externalEventId, payloadHash) {
    for (const event of this.webhookInbox.values()) {
      if (event.provider === provider && 
          event.external_event_id === externalEventId && 
          event.canonical_payload_hash === payloadHash &&
          !['failed', 'quarantined'].includes(event.status)) {
        return event;
      }
    }
    return null;
  }

  // =============================================================================
  // 6) HIGH-VALUE SANITY QUERY
  // =============================================================================
  
  causalMappingSanityCheck() {
    const causalMappings = new Map();
    
    // Group by causal_event_id
    for (const event of this.webhookInbox.values()) {
      if (event.causal_event_id && !['failed', 'quarantined'].includes(event.status)) {
        if (!causalMappings.has(event.causal_event_id)) {
          causalMappings.set(event.causal_event_id, {
            inboxRows: 0,
            distinctExternalIds: new Set(),
            distinctPayloadHashes: new Set()
          });
        }
        
        const mapping = causalMappings.get(event.causal_event_id);
        mapping.inboxRows++;
        mapping.distinctExternalIds.add(`${event.provider}:${event.external_event_id || 'null'}`);
        mapping.distinctPayloadHashes.add(event.canonical_payload_hash);
      }
    }
    
    // Find violations
    const violations = [];
    
    for (const [causalEventId, mapping] of causalMappings.entries()) {
      const distinctExternalIds = mapping.distinctExternalIds.size;
      const distinctPayloadHashes = mapping.distinctPayloadHashes.size;
      
      if (distinctExternalIds > 1 || distinctPayloadHashes > 1) {
        let violationType;
        if (distinctExternalIds > 1 && distinctPayloadHashes > 1) {
          violationType = 'BOTH_COLLISIONS';
        } else if (distinctExternalIds > 1) {
          violationType = 'DELIVERY_COLLISION';
        } else {
          violationType = 'CONTENT_COLLISION';
        }
        
        violations.push({
          causal_event_id: causalEventId,
          inbox_rows: mapping.inboxRows,
          distinct_external_ids: distinctExternalIds,
          distinct_payload_hashes: distinctPayloadHashes,
          violation_type: violationType,
          severity: (distinctExternalIds > 1 && distinctPayloadHashes > 1) ? 'critical' : 'high'
        });
      }
    }
    
    return violations.sort((a, b) => b.inbox_rows - a.inbox_rows);
  }

  // =============================================================================
  // 7) PROCESSING PIPELINE
  // =============================================================================
  
  async processExternalEventStrict(provider, externalEventId, rawPayload) {
    console.log(`🔄 Processing external event with strict identity: ${provider}:${externalEventId}`);
    
    try {
      // Step 1: Ingest with strict identity handling
      const ingestionResult = await this.insertWebhookEventStrict(provider, externalEventId, rawPayload);
      
      if (ingestionResult.status === 'quarantined') {
        console.log(`  🚫 Event quarantined - no processing`);
        return {
          status: 'quarantined',
          quarantineReason: ingestionResult.quarantineReason
        };
      }
      
      if (ingestionResult.isDuplicate) {
        console.log(`  ✅ Duplicate handled idempotently`);
        return {
          status: 'duplicate',
          inboxEventId: ingestionResult.inboxEventId
        };
      }
      
      // Step 2: Create causal event (only for new, valid events)
      const inboxEvent = this.webhookInbox.get(ingestionResult.inboxEventId);
      const causalEvent = await this.createCausalEventFromExternalStrict(inboxEvent);
      
      // Step 3: Update inbox event with causal mapping
      inboxEvent.causal_event_id = causalEvent.event_id;
      inboxEvent.status = 'processed';
      inboxEvent.processing_completed_at = new Date();
      
      this.processingMetrics.eventsProcessed++;
      
      console.log(`  ✅ External event processed with strict identity handling`);
      
      return {
        status: 'processed',
        inboxEventId: ingestionResult.inboxEventId,
        causalEventId: causalEvent.event_id
      };
      
    } catch (error) {
      console.log(`  ❌ Failed to process external event: ${error.message}`);
      throw error;
    }
  }

  async createCausalEventFromExternalStrict(inboxEvent) {
    console.log(`🔄 Creating causal event from external (strict): ${inboxEvent.id}`);
    
    // Generate deterministic causal event ID based on content identity only
    const contentIdentity = inboxEvent.canonical_payload_hash;
    const deterministicEventId = this.generateDeterministicEventId(contentIdentity);
    
    // Check if causal event already exists
    if (this.causalSpine.has(deterministicEventId)) {
      console.log(`  ✅ Causal event already exists: ${deterministicEventId}`);
      return this.causalSpine.get(deterministicEventId);
    }
    
    // Check causal mapping limits
    const mappingCheck = this.checkCausalMappingLimits(
      deterministicEventId,
      inboxEvent.provider,
      inboxEvent.external_event_id,
      inboxEvent.canonical_payload_hash
    );
    
    if (!mappingCheck.mappingAllowed) {
      console.log(`  🚫 Causal mapping violation: ${mappingCheck.reason}`);
      this.processingMetrics.causalMappingViolations++;
      throw new Error(`CAUSAL_MAPPING_VIOLATION: ${mappingCheck.reason}`);
    }
    
    const causalEvent = {
      event_id: deterministicEventId,
      event_type: 'EXTERNAL',
      agent: 'strict_identity_processor',
      determinism_key: `external-${inboxEvent.provider}-${contentIdentity}`,
      logical_clock: this.causalSpine.size + 1,
      decision_time: new Date(),
      processing_status: 'committed',
      causality_violation: false,
      payload: {
        original_inbox_event_id: inboxEvent.id,
        provider: inboxEvent.provider,
        external_event_id: inboxEvent.external_event_id,
        canonical_payload: inboxEvent.canonical_payload,
        payload_hash: inboxEvent.canonical_payload_hash
      },
      created_at: new Date()
    };
    
    this.causalSpine.set(causalEvent.event_id, causalEvent);
    
    console.log(`  ✅ Causal event created: ${causalEvent.event_id}`);
    return causalEvent;
  }

  generateDeterministicEventId(contentIdentity) {
    // Generate deterministic UUID based on content identity only
    const hash = crypto.createHash('sha256').update(contentIdentity).digest('hex');
    
    // Convert hash to UUID format
    const uuid = [
      hash.substring(0, 8),
      hash.substring(8, 12),
      hash.substring(12, 16),
      hash.substring(16, 20),
      hash.substring(20, 32)
    ].join('-');
    
    return uuid;
  }

  // =============================================================================
  // 8) METRICS AND VALIDATION
  // =============================================================================
  
  getMetrics() {
    return {
      ...this.processingMetrics,
      inboxSize: this.webhookInbox.size,
      causalSpineSize: this.causalSpine.size
    };
  }

  runSanityCheck() {
    const violations = this.causalMappingSanityCheck();
    
    console.log(`\n🔍 CAUSAL MAPPING SANITY CHECK:`);
    console.log(`  Total violations found: ${violations.length}`);
    
    violations.forEach(violation => {
      console.log(`  💥 ${violation.violation_type} (${violation.severity}):`);
      console.log(`     Causal Event: ${violation.causal_event_id}`);
      console.log(`     Inbox Rows: ${violation.inbox_rows}`);
      console.log(`     Distinct External IDs: ${violation.distinct_external_ids}`);
      console.log(`     Distinct Payload Hashes: ${violation.distinct_payload_hashes}`);
    });
    
    return violations;
  }

  reset() {
    this.webhookInbox.clear();
    this.causalSpine.clear();
    this.processingMetrics = {
      eventsReceived: 0,
      eventsQuarantined: 0,
      eventsProcessed: 0,
      duplicateCollisions: 0,
      deliveryCollisions: 0,
      contentCollisions: 0,
      causalMappingViolations: 0
    };
  }
}

module.exports = StrictIdentityProcessor;
