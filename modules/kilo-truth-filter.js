// KILO Truth Filter Gate - Verifies CASCADE state before generating repairs
// Must confirm: event fingerprint exists, anomaly still active, not already resolved

const eventBusLock = require('./event-bus-lock');
const { enforceContract, checkPermission } = require('./system-contract-guard-v2');

class KiloTruthFilter {
  constructor() {
    this.cascadeStateCache = new Map();
    this.cacheTimeout = 30000; // 30 seconds
    this.repairAttempts = new Map(); // Track repair attempts per fingerprint
    this.maxRepairsPerFingerprint = 3;
    
    // Register KILO with contract guard
    enforceContract('KILO', 'KILO', [
      'subscribe_to_events',
      'query_cascade_state',
      'generate_repair_manifest',
      'log_audit_entry'
    ]);
    
    // Register with event bus
    this.eventInterface = eventBusLock.createEventOnlyInterface('KILO', 'KILO');
    this.eventInterface.registerModule = eventBusLock.registerModule.bind(eventBusLock);
    this.eventInterface.registerModule('KILO', 'KILO', [
      'cascade_classified_event'
    ]);
    
    // Subscribe to CASCADE events
    this.eventInterface.subscribe('cascade_classified_event', this.handleCascadeEvent.bind(this));
    
    console.log('[KILO TRUTH FILTER] Initialized - Will verify CASCADE state before repairs');
  }

  // Handle incoming CASCADE events
  async handleCascadeEvent(eventData) {
    // Cache the event state
    this.cascadeStateCache.set(eventData.fingerprint, {
      ...eventData,
      receivedAt: new Date().toISOString(),
      status: 'active'
    });
    
    // Clean old cache entries
    this.cleanCache();
    
    console.log(`[KILO TRUTH FILTER] Received CASCADE event: ${eventData.classification} (${eventData.fingerprint.substring(0, 16)}...)`);
  }

  // Truth filter verification before generating repair
  async verifyBeforeRepair(fingerprint, repairType) {
    console.log(`[KILO TRUTH FILTER] Verifying repair conditions for ${fingerprint.substring(0, 16)}...`);
    
    // 1. Check if fingerprint exists in CASCADE state
    const cascadeState = this.cascadeStateCache.get(fingerprint);
    if (!cascadeState) {
      const error = `REPAIR_ABORTED: Fingerprint ${fingerprint} not found in CASCADE state`;
      console.error(`[KILO TRUTH FILTER] ${error}`);
      throw new Error(error);
    }
    
    // 2. Check if anomaly is still active
    if (cascadeState.status !== 'active') {
      const error = `REPAIR_ABORTED: Anomaly no longer active (status: ${cascadeState.status})`;
      console.error(`[KILO TRUTH FILTER] ${error}`);
      throw new Error(error);
    }
    
    // 3. Check if already resolved
    if (cascadeState.resolved) {
      const error = `REPAIR_ABORTED: Anomaly already resolved at ${cascadeState.resolvedAt}`;
      console.error(`[KILO TRUTH FILTER] ${error}`);
      throw new Error(error);
    }
    
    // 4. Check if already quarantined
    if (cascadeState.quarantined) {
      const error = `REPAIR_ABORTED: Anomaly quarantined at ${cascadeState.quarantinedAt}`;
      console.error(`[KILO TRUTH FILTER] ${error}`);
      throw new Error(error);
    }
    
    // 5. Check repair attempt limit
    const repairCount = this.repairAttempts.get(fingerprint) || 0;
    if (repairCount >= this.maxRepairsPerFingerprint) {
      const error = `REPAIR_ABORTED: Maximum repair attempts (${this.maxRepairsPerFingerprint}) exceeded`;
      console.error(`[KILO TRUTH FILTER] ${error}`);
      throw new Error(error);
    }
    
    // 6. Query current CASCADE global state
    const globalState = await this.queryCascadeGlobalState();
    if (!globalState.system_healthy) {
      const error = `REPAIR_ABORTED: CASCADE system unhealthy (${globalState.system_health})`;
      console.error(`[KILO TRUTH FILTER] ${error}`);
      throw new Error(error);
    }
    
    // All checks passed
    console.log(`[KILO TRUTH FILTER] Verification passed - Proceeding with repair generation`);
    return true;
  }

  // Query CASCADE global state
  async queryCascadeGlobalState() {
    // In a real implementation, this would make an HTTP request to CASCADE
    // For now, we'll simulate it
    
    try {
      // This would be: const response = await fetch('http://localhost:3005/cascade/status');
      // const globalState = await response.json();
      
      // Simulated response
      const globalState = {
        system_healthy: true,
        system_health: 'healthy',
        event_throughput: 10.5,
        error_ratio: 0.05,
        quarantine_size: 2,
        last_updated: new Date().toISOString()
      };
      
      return globalState;
    } catch (error) {
      console.error('[KILO TRUTH FILTER] Failed to query CASCADE state:', error);
      throw new Error('REPAIR_ABORTED: Cannot verify CASCADE state');
    }
  }

  // Generate repair manifest with truth verification
  async generateRepairManifest(fingerprint, repairType, context = {}) {
    // Check permission first
    checkPermission('KILO', 'generate_repair_manifest', { fingerprint, repairType });
    
    // Verify before generating
    await this.verifyBeforeRepair(fingerprint, repairType);
    
    // Get the CASCADE event data
    const cascadeEvent = this.cascadeStateCache.get(fingerprint);
    if (!cascadeEvent) {
      throw new Error('Cannot generate repair: Event data not found');
    }
    
    // Increment repair attempt counter
    const currentAttempts = (this.repairAttempts.get(fingerprint) || 0) + 1;
    this.repairAttempts.set(fingerprint, currentAttempts);
    
    // Generate repair manifest based on classification
    const manifest = this.createManifestForClassification(
      cascadeEvent.classification,
      cascadeEvent.payload,
      repairType,
      context
    );
    
    // Add metadata
    manifest.metadata = {
      generated_at: new Date().toISOString(),
      cascade_fingerprint: fingerprint,
      cascade_event_id: cascadeEvent.event_id || 'unknown',
      repair_attempt: currentAttempts,
      verified_by_truth_filter: true
    };
    
    // Log audit entry
    this.logAuditEntry('repair_manifest_generated', {
      manifest_id: manifest.manifest_id,
      fingerprint: fingerprint,
      classification: cascadeEvent.classification
    });
    
    console.log(`[KILO TRUTH FILTER] Repair manifest generated: ${manifest.manifest_id}`);
    
    return manifest;
  }

  // Create manifest based on classification
  createManifestForClassification(classification, payload, repairType, context) {
    const baseManifest = {
      manifest_id: `manifest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      issue_type: classification,
      affected_module: payload.module || payload.service || 'unknown',
      generated_by: 'KILO',
      repair_type: repairType
    };
    
    switch (classification) {
      case 'INFRA_FAILURE':
        return {
          ...baseManifest,
          root_cause_hypothesis: `Module ${baseManifest.affected_module} is missing or inaccessible`,
          verification_steps: [
            'Check if module exists in node_modules',
            'Verify package.json dependencies',
            'Check file system permissions',
            'Validate import paths'
          ],
          recommended_fix_steps: [
            'Run npm install to restore missing dependencies',
            'Verify environment variables are set',
            'Restart the affected service',
            'Validate module resolution'
          ],
          risk_level: 'medium',
          rollback_option: true,
          confidence: 0.85
        };
        
      case 'DEPLOYMENT_MISMATCH':
        return {
          ...baseManifest,
          root_cause_hypothesis: 'Environment configuration differs from deployment expectations',
          verification_steps: [
            'Compare .env files across environments',
            'Check configuration schema versions',
            'Validate required environment variables',
            'Review deployment logs'
          ],
          recommended_fix_steps: [
            'Sync environment variables with target',
            'Update configuration schema',
            'Redeploy with correct config',
            'Validate configuration loading'
          ],
          risk_level: 'low',
          rollback_option: true,
          confidence: 0.9
        };
        
      case 'STREAM_BREAK':
        return {
          ...baseManifest,
          root_cause_hypothesis: 'WebSocket or stream connection lost unexpectedly',
          verification_steps: [
            'Check network connectivity',
            'Verify WebSocket server status',
            'Review client connection logs',
            'Check for network interruptions'
          ],
          recommended_fix_steps: [
            'Attempt reconnection with exponential backoff',
            'Implement connection health monitoring',
            'Add automatic retry logic',
            'Consider connection pooling'
          ],
          risk_level: 'low',
          rollback_option: false,
          confidence: 0.8
        };
        
      default:
        return {
          ...baseManifest,
          root_cause_hypothesis: 'Unknown anomaly detected',
          verification_steps: [
            'Review system logs',
            'Check error patterns',
            'Analyze recent changes',
            'Consult system documentation'
          ],
          recommended_fix_steps: [
            'Investigate root cause manually',
            'Document findings',
            'Create specific fix procedure',
            'Monitor for recurrence'
          ],
          risk_level: 'high',
          rollback_option: true,
          confidence: 0.5
        };
    }
  }

  // Log audit entry (append-only)
  logAuditEntry(action, data) {
    checkPermission('KILO', 'log_audit_entry', { action });
    
    const auditEntry = {
      timestamp: new Date().toISOString(),
      action: action,
      data: data,
      module: 'KILO',
      sequence_id: this.getNextSequenceId()
    };
    
    // In a real implementation, this would write to append-only storage
    console.log('[KILO AUDIT]', JSON.stringify(auditEntry));
    
    // Emit audit event
    this.eventInterface.emit('kilo_audit_event', auditEntry);
  }

  // Get next sequence ID for audit
  getNextSequenceId() {
    if (!this._sequenceId) this._sequenceId = 0;
    return ++this._sequenceId;
  }

  // Mark event as resolved
  markEventResolved(fingerprint, resolution) {
    const state = this.cascadeStateCache.get(fingerprint);
    if (state) {
      state.status = 'resolved';
      state.resolved = true;
      state.resolvedAt = new Date().toISOString();
      state.resolution = resolution;
      
      console.log(`[KILO TRUTH FILTER] Event marked as resolved: ${fingerprint.substring(0, 16)}...`);
    }
  }

  // Mark event as quarantined
  markEventQuarantined(fingerprint, reason) {
    const state = this.cascadeStateCache.get(fingerprint);
    if (state) {
      state.status = 'quarantined';
      state.quarantined = true;
      state.quarantinedAt = new Date().toISOString();
      state.quarantineReason = reason;
      
      console.log(`[KILO TRUTH FILTER] Event marked as quarantined: ${fingerprint.substring(0, 16)}...`);
    }
  }

  // Clean old cache entries
  cleanCache() {
    const now = Date.now();
    const toDelete = [];
    
    this.cascadeStateCache.forEach((state, fingerprint) => {
      const age = now - new Date(state.receivedAt).getTime();
      if (age > this.cacheTimeout) {
        toDelete.push(fingerprint);
      }
    });
    
    toDelete.forEach(fingerprint => {
      this.cascadeStateCache.delete(fingerprint);
    });
    
    if (toDelete.length > 0) {
      console.log(`[KILO TRUTH FILTER] Cleaned ${toDelete.length} old cache entries`);
    }
  }

  // Get truth filter statistics
  getStats() {
    return {
      cached_events: this.cascadeStateCache.size,
      repair_attempts: Object.fromEntries(this.repairAttempts),
      cache_timeout: this.cacheTimeout,
      max_repairs_per_fingerprint: this.maxRepairsPerFingerprint
    };
  }
}

// Create singleton instance
const kiloTruthFilter = new KiloTruthFilter();

// Export the truth filter
module.exports = kiloTruthFilter;
