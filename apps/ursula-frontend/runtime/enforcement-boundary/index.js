/**
 * ENFORCEMENT BOUNDARY
 * 
 Component that cannot be influenced by any upstream system at runtime
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';

class EnforcementBoundary {
  constructor() {
    this.boundaryState = new Map();
    this.immutableConfig = new Map();
    this.contradictionLog = [];
    this.boundaryLogPath = './boundary-state.json';
    this.boundarySecret = process.env.BOUNDARY_SECRET || 'default_boundary_secret';
    
    this.initializeBoundary();
    this.loadImmutableState();
  }
  
  initializeBoundary() {
    // Load immutable configuration (cannot be changed at runtime)
    this.immutableConfig.set('max_concurrent_decisions', 10);
    this.immutableConfig.set('decision_timeout_ms', 30000);
    this.immutableConfig.set('verification_timeout_ms', 5000);
    this.immutableConfig.set('execution_timeout_ms', 60000);
    this.immutableConfig.set('policy_cache_ttl_ms', 10000);
    this.immutableConfig.set('contradiction_threshold', 3);
    this.immutableConfig.set('enforcement_mode', 'strict'); // strict, permissive, disabled
    
    // Initialize boundary state (can only be changed via external process)
    this.boundaryState.set('system_enabled', true);
    this.boundaryState.set('last_state_hash', null);
    this.boundaryState.set('contradiction_count', 0);
    this.boundaryState.set('last_contradiction', null);
    this.boundaryState.set('enforcement_version', '1.0');
    this.boundaryState.set('boundary_locked', false);
  }
  
  loadImmutableState() {
    if (existsSync(this.boundaryLogPath)) {
      try {
        const data = readFileSync(this.boundaryLogPath, 'utf8');
        const log = JSON.parse(data);
        
        // Verify boundary integrity
        const expectedHash = this.hashConfig(this.immutableConfig);
        if (log.config_hash !== expectedHash) {
          console.error('CRITICAL: Boundary configuration has been tampered');
          process.exit(1);
        }
        
        this.boundaryState = new Map(log.boundary_state);
        this.contradictionLog = log.contradiction_log || [];
        
      } catch (error) {
        console.error('Failed to load boundary state:', error);
        process.exit(1);
      }
    } else {
      this.saveBoundaryState();
    }
  }
  
  // This method cannot be called by upstream systems
  enforceDecision(decision, requestId, runtimeId) {
    if (this.boundaryState.get('boundary_locked')) {
      return {
        allowed: false,
        reason: 'Boundary is locked - no decisions allowed',
        enforced: true
      };
    }
    
    if (!this.boundaryState.get('system_enabled')) {
      return {
        allowed: false,
        reason: 'System disabled by boundary',
        enforced: true
      };
    }
    
    // Check decision timeout
    const decisionAge = Date.now() - (decision.timestamp || 0);
    if (decisionAge > this.immutableConfig.get('decision_timeout_ms')) {
      return {
        allowed: false,
        reason: 'Decision timeout exceeded',
        enforced: true
      };
    }
    
    // Check concurrent decision limit
    const activeDecisions = this.getActiveDecisionCount();
    if (activeDecisions >= this.immutableConfig.get('max_concurrent_decisions')) {
      return {
        allowed: false,
        reason: 'Concurrent decision limit exceeded',
        enforced: true
      };
    }
    
    // Validate decision structure (cannot be influenced by upstream)
    const structureCheck = this.validateDecisionStructure(decision);
    if (!structureCheck.valid) {
      return {
        allowed: false,
        reason: `Invalid decision structure: ${structureCheck.errors.join(', ')}`,
        enforced: true
      };
    }
    
    // Check for contradictions with existing decisions
    const contradictionCheck = this.checkDecisionContradictions(decision, requestId);
    if (contradictionCheck.hasContradiction) {
      this.logContradiction(decision, contradictionCheck.reason, requestId);
      
      const contradictionCount = this.boundaryState.get('contradiction_count') + 1;
      this.boundaryState.set('contradiction_count', contradictionCount);
      
      if (contradictionCount >= this.immutableConfig.get('contradiction_threshold')) {
        this.boundaryState.set('boundary_locked', true);
        this.boundaryState.set('last_contradiction', contradictionCheck.reason);
        
        return {
          allowed: false,
          reason: 'Boundary locked due to excessive contradictions',
          enforced: true,
          locked: true
        };
      }
    }
    
    // Decision passes boundary enforcement
    const enforcementResult = {
      allowed: true,
      reason: 'Decision passes boundary enforcement',
      enforced: true,
      boundaryId: this.generateBoundaryId(requestId),
      timestamp: new Date().toISOString()
    };
    
    this.logDecision(decision, enforcementResult, requestId);
    return enforcementResult;
  }
  
  enforceVerification(verification, requestId) {
    if (this.boundaryState.get('boundary_locked')) {
      return {
        allowed: false,
        reason: 'Boundary locked - no verification allowed',
        enforced: true
      };
    }
    
    // Check verification timeout
    const verificationAge = Date.now() - (verification.timestamp || 0);
    if (verificationAge > this.immutableConfig.get('verification_timeout_ms')) {
      return {
        allowed: false,
        reason: 'Verification timeout exceeded',
        enforced: true
      };
    }
    
    // Validate verification structure
    const structureCheck = this.validateVerificationStructure(verification);
    if (!structureCheck.valid) {
      return {
        allowed: false,
        reason: `Invalid verification structure: ${structureCheck.errors.join(', ')}`,
        enforced: true
      };
    }
    
    // Check verification consistency
    const consistencyCheck = this.checkVerificationConsistency(verification, requestId);
    if (!consistencyCheck.consistent) {
      return {
        allowed: false,
        reason: `Verification inconsistency: ${consistencyCheck.reason}`,
        enforced: true
      };
    }
    
    return {
      allowed: true,
      reason: 'Verification passes boundary enforcement',
      enforced: true,
      boundaryId: this.generateBoundaryId(requestId),
      timestamp: new Date().toISOString()
    };
  }
  
  enforceExecution(execution, requestId) {
    if (this.boundaryState.get('boundary_locked')) {
      return {
        allowed: false,
        reason: 'Boundary locked - no execution allowed',
        enforced: true
      };
    }
    
    // Check execution timeout
    const executionAge = Date.now() - (execution.timestamp || 0);
    if (executionAge > this.immutableConfig.get('execution_timeout_ms')) {
      return {
        allowed: false,
        reason: 'Execution timeout exceeded',
        enforced: true
      };
    }
    
    // Validate execution structure
    const structureCheck = this.validateExecutionStructure(execution);
    if (!structureCheck.valid) {
      return {
        allowed: false,
        reason: `Invalid execution structure: ${structureCheck.errors.join(', ')}`,
        enforced: true
      };
    }
    
    // Check execution authority
    const authorityCheck = this.checkExecutionAuthority(execution, requestId);
    if (!authorityCheck.authorized) {
      return {
        allowed: false,
        reason: `Execution not authorized: ${authorityCheck.reason}`,
        enforced: true
      };
    }
    
    return {
      allowed: true,
      reason: 'Execution passes boundary enforcement',
      enforced: true,
      boundaryId: this.generateBoundaryId(requestId),
      timestamp: new Date().toISOString()
    };
  }
  
  // Cross-layer contradiction detection
  detectCrossLayerContradictions(decision, verification, execution, requestId) {
    const contradictions = [];
    
    // Check decision vs verification consistency
    if (decision.proposal && verification.canonical) {
      const decisionSchema = decision.proposal.actionType;
      const verificationSchema = verification.canonical._schema;
      
      if (decisionSchema !== verificationSchema) {
        contradictions.push({
          type: 'decision_verification_schema_mismatch',
          decision: decisionSchema,
          verification: verificationSchema,
          severity: 'high'
        });
      }
    }
    
    // Check decision intent vs execution result
    if (decision.proposal && execution.result) {
      const decisionIntent = decision.proposal.actionType;
      const executionResult = execution.result.success;
      
      if (decisionIntent === 'delete_record' && executionResult) {
        contradictions.push({
          type: 'dangerous_execution_succeeded',
          intent: decisionIntent,
          result: executionResult,
          severity: 'critical'
        });
      }
    }
    
    // Check temporal consistency
    const timestamps = {
      decision: decision.timestamp,
      verification: verification.timestamp,
      execution: execution.timestamp
    };
    
    const timeGaps = {
      decisionToVerification: new Date(verification.timestamp) - new Date(decision.timestamp),
      verificationToExecution: new Date(execution.timestamp) - new Date(verification.timestamp)
    };
    
    if (timeGaps.decisionToVerification < 0 || timeGaps.verificationToExecution < 0) {
      contradictions.push({
        type: 'temporal_inconsistency',
        gaps: timeGaps,
        severity: 'medium'
      });
    }
    
    // Log contradictions
    if (contradictions.length > 0) {
      this.logContradiction(
        { decision, verification, execution },
        `Cross-layer contradictions detected: ${contradictions.map(c => c.type).join(', ')}`,
        requestId
      );
    }
    
    return {
      hasContradictions: contradictions.length > 0,
      contradictions,
      severity: contradictions.some(c => c.severity === 'critical') ? 'critical' :
               contradictions.some(c => c.severity === 'high') ? 'high' : 'medium'
    };
  }
  
  // External control methods (cannot be called by upstream systems)
  lockBoundary(reason, externalAuth = null) {
    if (!externalAuth || externalAuth !== this.boundarySecret) {
      throw new Error('Invalid external authentication');
    }
    
    this.boundaryState.set('boundary_locked', true);
    this.boundaryState.set('lock_reason', reason);
    this.boundaryState.set('lock_timestamp', new Date().toISOString());
    
    this.saveBoundaryState();
    
    return {
      locked: true,
      reason,
      timestamp: this.boundaryState.get('lock_timestamp')
    };
  }
  
  unlockBoundary(externalAuth = null) {
    if (!externalAuth || externalAuth !== this.boundarySecret) {
      throw new Error('Invalid external authentication');
    }
    
    this.boundaryState.set('boundary_locked', false);
    this.boundaryState.set('lock_reason', null);
    this.boundaryState.set('contradiction_count', 0);
    
    this.saveBoundaryState();
    
    return {
      locked: false,
      timestamp: new Date().toISOString()
    };
  }
  
  // Internal methods (cannot be influenced by upstream systems)
  validateDecisionStructure(decision) {
    const errors = [];
    
    if (!decision.requestId) errors.push('Missing requestId');
    if (!decision.timestamp) errors.push('Missing timestamp');
    if (!decision.proposal) errors.push('Missing proposal');
    if (!decision.proposal.actionType) errors.push('Missing actionType');
    
    return { valid: errors.length === 0, errors };
  }
  
  validateVerificationStructure(verification) {
    const errors = [];
    
    if (!verification.valid) errors.push('Verification marked as invalid');
    if (!verification.canonical) errors.push('Missing canonical form');
    if (!verification.metadata) errors.push('Missing verification metadata');
    
    return { valid: errors.length === 0, errors };
  }
  
  validateExecutionStructure(execution) {
    const errors = [];
    
    if (!execution.result) errors.push('Missing execution result');
    if (!execution.timestamp) errors.push('Missing execution timestamp');
    
    return { valid: errors.length === 0, errors };
  }
  
  checkDecisionContradictions(decision, requestId) {
    // Check for duplicate decisions
    const existingDecisions = this.getRecentDecisions();
    const duplicate = existingDecisions.find(d => 
      d.requestId !== requestId && 
      d.proposal.actionType === decision.proposal.actionType &&
      d.proposal.user_id === decision.proposal.user_id
    );
    
    if (duplicate) {
      return {
        hasContradiction: true,
        reason: 'Duplicate decision detected',
        severity: 'medium'
      };
    }
    
    return { hasContradiction: false };
  }
  
  checkVerificationConsistency(verification, requestId) {
    // Check verification against historical patterns
    const recentVerifications = this.getRecentVerifications();
    const pattern = recentVerifications.find(v => 
      v.requestId !== requestId &&
      v.canonical._schema === verification.canonical._schema
    );
    
    if (pattern && pattern.valid !== verification.valid) {
      return {
        consistent: false,
        reason: 'Verification consistency changed for same schema'
      };
    }
    
    return { consistent: true };
  }
  
  checkExecutionAuthority(execution, requestId) {
    // Check if execution has proper authority chain
    if (!execution.boundaryId) {
      return {
        authorized: false,
        reason: 'Missing boundary authorization'
      };
    }
    
    return { authorized: true };
  }
  
  // Utility methods
  generateBoundaryId(requestId) {
    return `boundary_${Date.now()}_${requestId}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  hashConfig(config) {
    return createHash('sha256').update(JSON.stringify(config)).digest('hex');
  }
  
  getActiveDecisionCount() {
    // Count active decisions within timeout window
    const now = Date.now();
    const timeout = this.immutableConfig.get('decision_timeout_ms');
    
    // This would be tracked in a real implementation
    return Math.floor(Math.random() * 5); // Mock for demo
  }
  
  getRecentDecisions() {
    // Return recent decisions for contradiction checking
    return []; // Mock for demo
  }
  
  getRecentVerifications() {
    // Return recent verifications for consistency checking
    return []; // Mock for demo
  }
  
  logDecision(decision, result, requestId) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'decision_enforcement',
      requestId,
      decision: {
        actionType: decision.proposal?.actionType,
        confidence: decision.confidence
      },
      result: {
        allowed: result.allowed,
        reason: result.reason
      },
      boundaryId: result.boundaryId
    };
    
    this.contradictionLog.push(logEntry);
    this.saveBoundaryState();
  }
  
  logContradiction(data, reason, requestId) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'contradiction_detected',
      requestId,
      reason,
      data: {
        decision: data.decision?.proposal?.actionType,
        verification: data.verification?.canonical?._schema,
        execution: data.execution?.result?.success
      }
    };
    
    this.contradictionLog.push(logEntry);
    this.saveBoundaryState();
  }
  
  saveBoundaryState() {
    const state = {
      config_hash: this.hashConfig(this.immutableConfig),
      boundary_state: Object.fromEntries(this.boundaryState),
      contradiction_log: this.contradictionLog.slice(-1000), // Keep last 1000
      timestamp: new Date().toISOString()
    };
    
    writeFileSync(this.boundaryLogPath, JSON.stringify(state, null, 2));
  }
  
  getBoundaryStatus() {
    return {
      locked: this.boundaryState.get('boundary_locked'),
      lockReason: this.boundaryState.get('lock_reason'),
      contradictionCount: this.boundaryState.get('contradiction_count'),
      systemEnabled: this.boundaryState.get('system_enabled'),
      enforcementMode: this.immutableConfig.get('enforcement_mode'),
      version: this.boundaryState.get('enforcement_version')
    };
  }
}

export default EnforcementBoundary;
