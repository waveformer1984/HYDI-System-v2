// ProtoForge Prime Directive - Integrity First Rule
// System Rule: The Forge shall never prioritize revenue over integrity
// If system_integrity_score drops below 0.70, Kilo is restricted to safety_recovery_artifacts only

const { EventEmitter } = require('events');

class ProtoForgePrimeDirective extends EventEmitter {
  constructor() {
    super();
    
    // Prime Directive thresholds
    this.INTEGRITY_THRESHOLD = 0.70; // Critical integrity threshold
    this.SAFETY_RECOVERY_MODE = 'safety_recovery_artifacts_only';
    
    // System state tracking
    this.currentIntegrityScore = 1.0;
    this.kiloRestrictionActive = false;
    this.revenueArtifactsBlocked = 0;
    this.safetyArtifactsAllowed = 0;
    
    // Artifact classification
    this.artifactTypes = {
      // Revenue artifacts (blocked when integrity < 0.70)
      revenue_artifacts: [
        'service',
        'automation', 
        'tool',
        'content'
      ],
      
      // Safety recovery artifacts (always allowed)
      safety_recovery_artifacts: [
        'system_diagnostic',
        'integrity_restoration',
        'emergency_patch',
        'data_recovery',
        'security_fix',
        'rollback_procedure',
        'backup_restoration',
        'monitoring_alert'
      ]
    };
    
    this.initializePrimeHandlers();
  }

  initializePrimeHandlers() {
    // Listen for integrity score changes
    this.on('integrity_score_updated', (integrityEvent) => {
      this.evaluateIntegrityThreshold(integrityEvent);
    });
    
    // Listen for artifact execution requests
    this.on('artifact_execution_requested', (artifactEvent) => {
      this.enforcePrimeDirective(artifactEvent);
    });
  }

  /**
   * Evaluate integrity threshold and enforce Prime Directive
   */
  evaluateIntegrityThreshold(integrityEvent) {
    const previousScore = this.currentIntegrityScore;
    const newScore = integrityEvent.integrity_score;
    
    this.currentIntegrityScore = newScore;
    
    console.log(`[PRIME DIRECTIVE] Integrity score: ${previousScore} -> ${newScore}`);
    
    // Check if threshold crossed
    if (previousScore >= this.INTEGRITY_THRESHOLD && newScore < this.INTEGRITY_THRESHOLD) {
      this.activateKiloRestriction(newScore);
    } else if (previousScore < this.INTEGRITY_THRESHOLD && newScore >= this.INTEGRITY_THRESHOLD) {
      this.deactivateKiloRestriction(newScore);
    }
    
    // Emit status change
    this.emit('prime_directive_status', {
      integrity_score: newScore,
      kilo_restriction_active: this.kiloRestrictionActive,
      threshold: this.INTEGRITY_THRESHOLD,
      compliance_status: newScore >= this.INTEGRITY_THRESHOLD ? 'COMPLIANT' : 'RESTRICTED'
    });
  }

  /**
   * Activate Kilo restriction when integrity drops below threshold
   */
  activateKiloRestriction(integrityScore) {
    this.kiloRestrictionActive = true;
    
    const restrictionEvent = {
      type: 'kilo_restriction_activated',
      event_id: `restriction_${Date.now()}`,
      timestamp: new Date().toISOString(),
      payload: {
        reason: `System integrity score (${integrityScore}) below threshold (${this.INTEGRITY_THRESHOLD})`,
        prime_directive: 'INTEGRITY_FIRST',
        restriction_mode: this.SAFETY_RECOVERY_MODE,
        blocked_artifact_types: this.artifactTypes.revenue_artifacts,
        allowed_artifact_types: this.artifactTypes.safety_recovery_artifacts,
        message: 'The Forge shall never prioritize revenue over integrity',
        automatic_restoration: false,
        manual_intervention_required: true
      }
    };
    
    this.emit('kilo_restriction_activated', restrictionEvent);
    console.error(`[PRIME DIRECTIVE] KILO RESTRICTION ACTIVATED - Integrity below ${this.INTEGRITY_THRESHOLD}`);
  }

  /**
   * Deactivate Kilo restriction when integrity recovers
   */
  deactivateKiloRestriction(integrityScore) {
    this.kiloRestrictionActive = false;
    
    const restorationEvent = {
      type: 'kilo_restriction_deactivated',
      event_id: `restoration_${Date.now()}`,
      timestamp: new Date().toISOString(),
      payload: {
        reason: `System integrity score (${integrityScore}) restored above threshold (${this.INTEGRITY_THRESHOLD})`,
        prime_directive: 'INTEGRITY_FIRST',
        restriction_mode: 'normal_operations',
        restored_artifact_types: this.artifactTypes.revenue_artifacts,
        message: 'System integrity restored - normal operations resumed',
        automatic_restoration: true
      }
    };
    
    this.emit('kilo_restriction_deactivated', restorationEvent);
    console.log(`[PRIME DIRECTIVE] KILO RESTRICTION DEACTIVATED - Integrity restored to ${integrityScore}`);
  }

  /**
   * Enforce Prime Directive on artifact execution
   */
  enforcePrimeDirective(artifactEvent) {
    const artifactType = artifactEvent.artifact_type;
    const isRevenueArtifact = this.artifactTypes.revenue_artifacts.includes(artifactType);
    const isSafetyArtifact = this.artifactTypes.safety_recovery_artifacts.includes(artifactType);
    
    // Enforce restriction if active and artifact is revenue type
    if (this.kiloRestrictionActive && isRevenueArtifact) {
      this.revenueArtifactsBlocked++;
      
      const blockedEvent = {
        type: 'artifact_execution_blocked',
        event_id: `blocked_${Date.now()}`,
        timestamp: new Date().toISOString(),
        payload: {
          original_event: artifactEvent,
          blocking_reason: 'PRIME_DIRECTIVE_VIOLATION',
          integrity_score: this.currentIntegrityScore,
          threshold: this.INTEGRITY_THRESHOLD,
          artifact_type: artifactType,
          artifact_class: 'revenue_artifact',
          message: 'The Forge shall never prioritize revenue over integrity',
          allowed_alternatives: this.artifactTypes.safety_recovery_artifacts,
          restriction_active: true
        }
      };
      
      this.emit('artifact_execution_blocked', blockedEvent);
      console.error(`[PRIME DIRECTIVE] BLOCKED revenue artifact: ${artifactType} (integrity: ${this.currentIntegrityScore})`);
      
      return {
        status: 'blocked',
        reason: 'PRIME_DIRECTIVE_VIOLATION',
        integrity_score: this.currentIntegrityScore,
        message: 'Revenue artifacts blocked until system integrity is restored'
      };
    }
    
    // Allow safety recovery artifacts
    if (isSafetyArtifact) {
      this.safetyArtifactsAllowed++;
      
      const allowedEvent = {
        type: 'artifact_execution_allowed',
        event_id: `allowed_${Date.now()}`,
        timestamp: new Date().toISOString(),
        payload: {
          original_event: artifactEvent,
          allowance_reason: 'SAFETY_RECOVERY_ARTIFACT',
          integrity_score: this.currentIntegrityScore,
          artifact_type: artifactType,
          artifact_class: 'safety_recovery_artifact',
          prime_directive_compliance: true,
          restriction_active: this.kiloRestrictionActive
        }
      };
      
      this.emit('artifact_execution_allowed', allowedEvent);
      console.log(`[PRIME DIRECTIVE] ALLOWED safety artifact: ${artifactType}`);
      
      return {
        status: 'allowed',
        reason: 'SAFETY_RECOVERY_ARTIFACT',
        integrity_score: this.currentIntegrityScore,
        message: 'Safety recovery artifact execution approved'
      };
    }
    
    // Allow normal operations when integrity is good
    if (!this.kiloRestrictionActive) {
      console.log(`[PRIME DIRECTIVE] ALLOWED normal artifact: ${artifactType} (integrity: ${this.currentIntegrityScore})`);
      return {
        status: 'allowed',
        reason: 'NORMAL_OPERATIONS',
        integrity_score: this.currentIntegrityScore
      };
    }
    
    // Unknown artifact type - block for safety
    console.warn(`[PRIME DIRECTIVE] BLOCKED unknown artifact type: ${artifactType}`);
    return {
      status: 'blocked',
      reason: 'UNKNOWN_ARTIFACT_TYPE',
      integrity_score: this.currentIntegrityScore
    };
  }

  /**
   * Get Prime Directive status
   */
  getPrimeDirectiveStatus() {
    return {
      prime_directive: 'INTEGRITY_FIRST',
      integrity_score: this.currentIntegrityScore,
      integrity_threshold: this.INTEGRITY_THRESHOLD,
      kilo_restriction_active: this.kiloRestrictionActive,
      compliance_status: this.currentIntegrityScore >= this.INTEGRITY_THRESHOLD ? 'COMPLIANT' : 'RESTRICTED',
      revenue_artifacts_blocked: this.revenueArtifactsBlocked,
      safety_artifacts_allowed: this.safetyArtifactsAllowed,
      artifact_restrictions: {
        blocked_types: this.kiloRestrictionActive ? this.artifactTypes.revenue_artifacts : [],
        allowed_types: this.artifactTypes.safety_recovery_artifacts
      },
      system_rule: 'The Forge shall never prioritize revenue over integrity',
      last_updated: new Date().toISOString()
    };
  }

  /**
   * Manual integrity score update (for testing)
   */
  updateIntegrityScore(score) {
    const integrityEvent = {
      type: 'integrity_score_updated',
      event_id: `manual_${Date.now()}`,
      timestamp: new Date().toISOString(),
      integrity_score: score
    };
    
    this.emit('integrity_score_updated', integrityEvent);
  }

  /**
   * Manual artifact execution test
   */
  testArtifactExecution(artifactType) {
    const artifactEvent = {
      event_id: `test_${Date.now()}`,
      artifact_type: artifactType,
      timestamp: new Date().toISOString()
    };
    
    return this.enforcePrimeDirective(artifactEvent);
  }

  /**
   * Get artifact classification
   */
  classifyArtifact(artifactType) {
    if (this.artifactTypes.revenue_artifacts.includes(artifactType)) {
      return 'revenue_artifact';
    } else if (this.artifactTypes.safety_recovery_artifacts.includes(artifactType)) {
      return 'safety_recovery_artifact';
    } else {
      return 'unknown_artifact';
    }
  }
}

// Export singleton instance
const protoforgePrimeDirective = new ProtoForgePrimeDirective();
module.exports = protoforgePrimeDirective;
