/**
 * CROSS-LAYER CONTRADICTION DETECTOR
 * 
 * Checks if chain of reasoning remains internally consistent across layers
 */

import { createHash } from 'crypto';

class CrossLayerDetector {
  constructor() {
    this.stateHistory = new Map();
    this.contradictionLog = [];
    this.detectorLogPath = './detector-state.json';
    this.detectionThresholds = {
      temporalInconsistencyMs: 5000,
      semanticDriftThreshold: 0.3,
      authorityChainBreakThreshold: 2,
      stateVersionConflictThreshold: 1
    };
    
    this.initializeDetector();
  }
  
  initializeDetector() {
    // Load existing state history
    this.loadStateHistory();
  }
  
  // Main contradiction detection method
  detectContradictions(decision, verification, execution, requestId) {
    const contradictions = [];
    const detection = {
      requestId,
      timestamp: new Date().toISOString(),
      hasContradictions: false,
      severity: 'none',
      contradictions: []
    };
    
    // 1. Temporal consistency check
    const temporalCheck = this.checkTemporalConsistency(decision, verification, execution);
    if (!temporalCheck.consistent) {
      contradictions.push({
        type: 'temporal_inconsistency',
        severity: 'medium',
        details: temporalCheck.details
      });
    }
    
    // 2. Semantic consistency check
    const semanticCheck = this.checkSemanticConsistency(decision, verification, execution);
    if (!semanticCheck.consistent) {
      contradictions.push({
        type: 'semantic_inconsistency',
        severity: 'high',
        details: semanticCheck.details
      });
    }
    
    // 3. Authority chain check
    const authorityCheck = this.checkAuthorityChain(decision, verification, execution);
    if (!authorityCheck.valid) {
      contradictions.push({
        type: 'authority_chain_break',
        severity: 'critical',
        details: authorityCheck.details
      });
    }
    
    // 4. State version consistency check
    const versionCheck = this.checkStateVersionConsistency(decision, verification, execution);
    if (!versionCheck.consistent) {
      contradictions.push({
        type: 'state_version_conflict',
        severity: 'high',
        details: versionCheck.details
      });
    }
    
    // 5. Valid-but-wrong schema attack check
    const schemaAttackCheck = this.checkValidButWrongSchemaAttack(decision, verification, execution);
    if (schemaAttackCheck.isAttack) {
      contradictions.push({
        type: 'valid_but_wrong_schema',
        severity: 'critical',
        details: schemaAttackCheck.details
      });
    }
    
    // 6. Partial trust corruption check
    const trustCheck = this.checkPartialTrustCorruption(decision, verification, execution);
    if (!trustCheck.trustworthy) {
      contradictions.push({
        type: 'partial_trust_corruption',
        severity: 'high',
        details: trustCheck.details
      });
    }
    
    // 7. Policy drift check
    const policyCheck = this.checkPolicyDrift(decision, verification, execution);
    if (!policyCheck.stable) {
      contradictions.push({
        type: 'policy_drift',
        severity: 'medium',
        details: policyCheck.details
      });
    }
    
    // 8. Split-brain execution check
    const splitBrainCheck = this.checkSplitBrainExecution(decision, verification, execution);
    if (splitBrainCheck.isSplitBrain) {
      contradictions.push({
        type: 'split_brain_execution',
        severity: 'critical',
        details: splitBrainCheck.details
      });
    }
    
    // Determine overall severity
    if (contradictions.length > 0) {
      detection.hasContradictions = true;
      detection.severity = contradictions.some(c => c.severity === 'critical') ? 'critical' :
                        contradictions.some(c => c.severity === 'high') ? 'high' : 'medium';
      detection.contradictions = contradictions;
    }
    
    // Store detection result
    this.storeDetection(detection);
    
    return detection;
  }
  
  checkTemporalConsistency(decision, verification, execution) {
    const timestamps = {
      decision: new Date(decision.timestamp || 0),
      verification: new Date(verification.timestamp || 0),
      execution: new Date(execution.timestamp || 0)
    };
    
    const gaps = {
      decisionToVerification: timestamps.verification - timestamps.decision,
      verificationToExecution: timestamps.execution - timestamps.verification,
      decisionToExecution: timestamps.execution - timestamps.decision
    };
    
    const issues = [];
    
    // Check for negative gaps (time travel)
    if (gaps.decisionToVerification < 0) {
      issues.push(`Verification timestamp precedes decision: ${gaps.decisionToVerification}ms`);
    }
    
    if (gaps.verificationToExecution < 0) {
      issues.push(`Execution timestamp precedes verification: ${gaps.verificationToExecution}ms`);
    }
    
    if (gaps.decisionToExecution < 0) {
      issues.push(`Execution timestamp precedes decision: ${gaps.decisionToExecution}ms`);
    }
    
    // Check for excessive gaps
    if (gaps.decisionToVerification > this.detectionThresholds.temporalInconsistencyMs) {
      issues.push(`Decision to verification gap too large: ${gaps.decisionToVerification}ms`);
    }
    
    if (gaps.verificationToExecution > this.detectionThresholds.temporalInconsistencyMs) {
      issues.push(`Verification to execution gap too large: ${gaps.verificationToExecution}ms`);
    }
    
    return {
      consistent: issues.length === 0,
      details: issues
    };
  }
  
  checkSemanticConsistency(decision, verification, execution) {
    const inconsistencies = [];
    
    // Check decision intent vs verification schema
    if (decision.proposal && verification.canonical) {
      const decisionIntent = this.extractIntent(decision.proposal);
      const verificationSchema = verification.canonical._schema;
      
      const intentSchemaMap = {
        'financial': ['transfer_funds'],
        'communication': ['send_message'],
        'data_management': ['delete_record'],
        'information': ['general_query']
      };
      
      const expectedSchemas = intentSchemaMap[decisionIntent] || [];
      
      if (!expectedSchemas.includes(verificationSchema)) {
        inconsistencies.push(`Decision intent "${decisionIntent}" does not match verification schema "${verificationSchema}"`);
      }
    }
    
    // Check verification vs execution semantic consistency
    if (verification.canonical && execution.result) {
      const schema = verification.canonical._schema;
      const resultSuccess = execution.result.success;
      
      // Check for dangerous execution that shouldn't succeed
      const dangerousSuccessPatterns = {
        'delete_record': resultSuccess,
        'transfer_funds': resultSuccess && execution.result.amount > 100000
      };
      
      if (dangerousSuccessPatterns[schema]) {
        inconsistencies.push(`Dangerous execution succeeded for schema "${schema}"`);
      }
    }
    
    // Calculate semantic drift
    const driftScore = this.calculateSemanticDrift(decision, verification, execution);
    if (driftScore > this.detectionThresholds.semanticDriftThreshold) {
      inconsistencies.push(`Semantic drift detected: ${driftScore.toFixed(3)}`);
    }
    
    return {
      consistent: inconsistencies.length === 0,
      details: inconsistencies
    };
  }
  
  checkAuthorityChain(decision, verification, execution) {
    const chain = [];
    const breaks = [];
    
    // Check decision authority
    if (!decision.boundaryId) {
      breaks.push('Decision lacks boundary authorization');
    }
    
    // Check verification authority
    if (!verification.boundaryId) {
      breaks.push('Verification lacks boundary authorization');
    }
    
    // Check execution authority
    if (!execution.boundaryId) {
      breaks.push('Execution lacks boundary authorization');
    }
    
    // Check boundary ID consistency
    if (decision.boundaryId && verification.boundaryId && execution.boundaryId) {
      if (decision.boundaryId !== verification.boundaryId) {
        breaks.push('Decision and verification have different boundary IDs');
      }
      
      if (verification.boundaryId !== execution.boundaryId) {
        breaks.push('Verification and execution have different boundary IDs');
      }
    }
    
    return {
      valid: breaks.length === 0,
      details: breaks
    };
  }
  
  checkStateVersionConsistency(decision, verification, execution) {
    const versions = {
      decision: decision.version || 'unknown',
      verification: verification.version || 'unknown',
      execution: execution.version || 'unknown'
    };
    
    const conflicts = [];
    
    // Check for version mismatches
    if (versions.decision !== versions.verification) {
      conflicts.push(`Decision version (${versions.decision}) != Verification version (${versions.verification})`);
    }
    
    if (versions.verification !== versions.execution) {
      conflicts.push(`Verification version (${versions.verification}) != Execution version (${versions.execution})`);
    }
    
    // Check for version anomalies
    const uniqueVersions = new Set(Object.values(versions));
    if (uniqueVersions.size > this.detectionThresholds.stateVersionConflictThreshold) {
      conflicts.push(`Too many different versions: ${Array.from(uniqueVersions).join(', ')}`);
    }
    
    return {
      consistent: conflicts.length === 0,
      details: conflicts
    };
  }
  
  checkValidButWrongSchemaAttack(decision, verification, execution) {
    const attackIndicators = [];
    
    // Check for structurally valid but semantically wrong proposals
    if (verification.valid && execution.result && execution.result.success) {
      const schema = verification.canonical._schema;
      
      // Check for suspicious combinations
      const suspiciousPatterns = [
        {
          pattern: 'delete_record',
          suspicious: execution.result.deletedCount > 1,
          description: 'Multiple records deleted in single execution'
        },
        {
          pattern: 'transfer_funds',
          suspicious: execution.result.amount === 999999.99,
          description: 'Maximum amount transfer (possible testing)'
        },
        {
          pattern: 'send_message',
          suspicious: execution.result.content.includes('eval('),
          description: 'Code injection in message content'
        }
      ];
      
      for (const pattern of suspiciousPatterns) {
        if (pattern.pattern === schema && pattern.suspicious) {
          attackIndicators.push({
            type: pattern.pattern,
            description: pattern.description,
            evidence: execution.result
          });
        }
      }
    }
    
    // Check for timing patterns
    if (decision.timestamp && execution.timestamp) {
      const executionTime = new Date(execution.timestamp) - new Date(decision.timestamp);
      if (executionTime < 100) { // Less than 100ms
        attackIndicators.push({
          type: 'suspicious_timing',
          description: 'Execution too fast for proper verification',
          evidence: `${executionTime}ms execution time`
        });
      }
    }
    
    return {
      isAttack: attackIndicators.length > 0,
      details: attackIndicators
    };
  }
  
  checkPartialTrustCorruption(decision, verification, execution) {
    const trustIssues = [];
    
    // Check for partial trust corruption in decision layer
    if (decision.proposal) {
      // Check for suspicious confidence values
      if (decision.confidence > 0.99 && decision.proposal.actionType === 'financial') {
        trustIssues.push({
          layer: 'decision',
          issue: 'Overconfident financial decision',
          evidence: `Confidence: ${decision.confidence}`
        });
      }
      
      // Check for missing risk indicators
      if (decision.proposal.actionType === 'financial' && !decision.proposal.riskAssessment) {
        trustIssues.push({
          layer: 'decision',
          issue: 'Financial decision without risk assessment',
          evidence: 'Missing riskAssessment field'
        });
      }
    }
    
    // Check for partial trust corruption in verification layer
    if (verification.valid && verification.errors) {
      if (verification.errors.length === 0 && verification.warnings.length === 0) {
        // Too clean - suspicious
        trustIssues.push({
          layer: 'verification',
          issue: 'Suspiciously clean verification',
          evidence: 'No errors or warnings for complex proposal'
        });
      }
    }
    
    // Check for partial trust corruption in execution layer
    if (execution.result && execution.result.success) {
      if (!execution.result.auditTrail) {
        trustIssues.push({
          layer: 'execution',
          issue: 'Successful execution without audit trail',
          evidence: 'Missing auditTrail field'
        });
      }
    }
    
    return {
      trustworthy: trustIssues.length === 0,
      details: trustIssues
    };
  }
  
  checkPolicyDrift(decision, verification, execution) {
    const driftIndicators = [];
    
    // Check for policy drift in decision layer
    if (decision.proposal) {
      const expectedRiskLevel = this.getExpectedRiskLevel(decision.proposal.actionType);
      if (decision.proposal.riskLevel !== expectedRiskLevel) {
        driftIndicators.push({
          layer: 'decision',
          issue: 'Risk level drift',
          expected: expectedRiskLevel,
          actual: decision.proposal.riskLevel
        });
      }
    }
    
    // Check for policy drift in verification layer
    if (verification.metadata && verification.metadata.policyVersion) {
      const currentPolicyVersion = '1.0';
      if (verification.metadata.policyVersion !== currentPolicyVersion) {
        driftIndicators.push({
          layer: 'verification',
          issue: 'Policy version drift',
          expected: currentPolicyVersion,
          actual: verification.metadata.policyVersion
        });
      }
    }
    
    return {
      stable: driftIndicators.length === 0,
      details: driftIndicators
    };
  }
  
  checkSplitBrainExecution(decision, verification, execution) {
    const splitBrainIndicators = [];
    
    // Check for state version disagreement
    const decisionState = decision.stateVersion || 'unknown';
    const verificationState = verification.stateVersion || 'unknown';
    const executionState = execution.stateVersion || 'unknown';
    
    if (decisionState !== verificationState || verificationState !== executionState) {
      splitBrainIndicators.push({
        type: 'state_version_disagreement',
        decision: decisionState,
        verification: verificationState,
        execution: executionState
      });
    }
    
    // Check for contradictory success/failure states
    const decisionSuccess = decision.success !== false;
    const verificationSuccess = verification.valid;
    const executionSuccess = execution.result?.success !== false;
    
    const successStates = [decisionSuccess, verificationSuccess, executionSuccess];
    const falseStates = successStates.filter(s => !s).length;
    
    if (falseStates > 0 && falseStates < successStates.length) {
      splitBrainIndicators.push({
        type: 'partial_failure',
        successStates,
        failureStates: falseStates
      });
    }
    
    return {
      isSplitBrain: splitBrainIndicators.length > 0,
      details: splitBrainIndicators
    };
  }
  
  // Helper methods
  extractIntent(proposal) {
    if (proposal.actionType === 'transfer_funds') return 'financial';
    if (proposal.actionType === 'send_message') return 'communication';
    if (proposal.actionType === 'delete_record') return 'data_management';
    if (proposal.actionType === 'general_query') return 'information';
    return 'unknown';
  }
  
  getExpectedRiskLevel(actionType) {
    const riskMap = {
      'transfer_funds': 'high',
      'delete_record': 'high',
      'send_message': 'medium',
      'general_query': 'low'
    };
    return riskMap[actionType] || 'medium';
  }
  
  calculateSemanticDrift(decision, verification, execution) {
    let driftScore = 0;
    
    // Calculate drift based on confidence changes
    if (decision.confidence && verification.metadata?.confidence) {
      const confidenceDiff = Math.abs(decision.confidence - verification.metadata.confidence);
      driftScore += confidenceDiff * 0.3;
    }
    
    // Calculate drift based on risk level changes
    if (decision.proposal?.riskLevel && verification.metadata?.riskLevel) {
      const riskDiff = decision.proposal.riskLevel === verification.metadata.riskLevel ? 0 : 0.5;
      driftScore += riskDiff * 0.4;
    }
    
    // Calculate drift based on execution outcome
    if (execution.result) {
      const expectedSuccess = decision.proposal?.expectedSuccess !== false;
      const actualSuccess = execution.result.success;
      
      if (expectedSuccess !== actualSuccess) {
        driftScore += 0.3;
      }
    }
    
    return driftScore;
  }
  
  storeDetection(detection) {
    this.stateHistory.set(detection.requestId, detection);
    this.contradictionLog.push(detection);
    
    // Keep history manageable
    if (this.stateHistory.size > 1000) {
      const firstKey = this.stateHistory.keys().next().value;
      this.stateHistory.delete(firstKey);
    }
    
    if (this.contradictionLog.length > 1000) {
      this.contradictionLog = this.contradictionLog.slice(-1000);
    }
    
    // Save to file
    this.saveDetectorState();
  }
  
  loadStateHistory() {
    try {
      const fs = require('fs');
      if (fs.existsSync(this.detectorLogPath)) {
        const data = fs.readFileSync(this.detectorLogPath, 'utf8');
        const log = JSON.parse(data);
        
        this.stateHistory = new Map(log.stateHistory || []);
        this.contradictionLog = log.contradictionLog || [];
      }
    } catch (error) {
      console.error('Failed to load detector state:', error);
    }
  }
  
  saveDetectorState() {
    try {
      const fs = require('fs');
      const state = {
        stateHistory: Object.fromEntries(this.stateHistory),
        contradictionLog: this.contradictionLog,
        timestamp: new Date().toISOString(),
        version: '1.0'
      };
      
      fs.writeFileSync(this.detectorLogPath, JSON.stringify(state, null, 2));
    } catch (error) {
      console.error('Failed to save detector state:', error);
    }
  }
  
  getDetectionHistory() {
    return Array.from(this.stateHistory.values());
  }
  
  getContradictionLog() {
    return [...this.contradictionLog];
  }
  
  getDetectorStatus() {
    const recentDetections = this.getDetectionHistory().slice(-100);
    const contradictions = recentDetections.filter(d => d.hasContradictions);
    
    return {
      totalDetections: recentDetections.length,
      contradictions: contradictions.length,
      contradictionRate: contradictions.length / recentDetections.length,
      lastContradiction: this.contradictionLog.length > 0 ? 
        this.contradictionLog[this.contradictionLog.length - 1] : null,
      thresholds: this.detectionThresholds
    };
  }
}

export default CrossLayerDetector;
