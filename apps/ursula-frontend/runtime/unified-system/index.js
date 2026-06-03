/**
 * UNIFIED SYSTEM
 * 
 * Collapsed from multiple layers to three meaningful trust boundaries
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';

class UnifiedSystem {
  constructor() {
    this.decisionBoundary = new Map();
    this.executionGate = new Map();
    this.policySource = new Map();
    
    this.truthContract = {
      executable: false,
      metadata: {},
      auditLog: []
    };
    
    this.initializeSystem();
  }
  
  initializeSystem() {
    // Single truth contract: action is either executable or not
    this.truthContract = {
      executable: false,
      metadata: {},
      auditLog: []
    };
    
    // Initialize policy source (external authority)
    this.policySource.set('systemEnabled', true);
    this.policySource.set('maxFinancialAmount', 10000);
    this.policySource.set('requireHumanApproval', true);
    this.policySource.set('allowedActions', ['transfer_funds', 'send_message', 'general_query']);
    
    console.log('=== UNIFIED SYSTEM INITIALIZED ===');
    console.log('Trust boundaries: Decision -> Execution -> Policy');
    console.log('Truth contract: Single invariant - executable or not');
  }
  
  // DECISION BOUNDARY (produces intent, must be imperfect)
  async processIntent(input, context = {}) {
    const decision = {
      id: this.generateId('decision'),
      timestamp: new Date().toISOString(),
      input: input,
      context,
      intent: this.classifyIntent(input),
      confidence: this.calculateConfidence(input),
      riskAssessment: this.assessRisk(input, context),
      metadata: {
        source: 'decision_boundary',
        version: '1.0'
      }
    };
    
    // Store decision for audit
    this.addToAuditLog('decision', decision);
    
    return decision;
  }
  
  // EXECUTION GATE (does the thing, must be boring and strict)
  async executeAction(decision, userContext = {}) {
    // Single invariant: action is either executable or not
    const execution = {
      id: this.generateId('execution'),
      timestamp: new Date().toISOString(),
      decisionId: decision.id,
      executable: false,
      result: null,
      error: null,
      metadata: {
        source: 'execution_gate',
        version: '1.0'
      }
    };
    
    // Check if action is in allowed list
    if (!this.policySource.get('allowedActions').includes(decision.intent.actionType)) {
      execution.error = `Action type not allowed: ${decision.intent.actionType}`;
      this.addToAuditLog('execution', execution);
      return execution;
    }
    
    // Check system enabled
    if (!this.policySource.get('systemEnabled')) {
      execution.error = 'System disabled by policy';
      this.addToAuditLog('execution', execution);
      return execution;
    }
    
    // Check human approval requirement
    if (this.policySource.get('requireHumanApproval') && !userContext.humanApproved) {
      execution.error = 'Human approval required';
      this.addToAuditLog('execution', execution);
      return execution;
    }
    
    // Check financial limits
    if (decision.intent.actionType === 'transfer_funds') {
      const amount = decision.intent.amount || 0;
      if (amount > this.policySource.get('maxFinancialAmount')) {
        execution.error = `Amount exceeds policy limit: ${amount} > ${this.policySource.get('maxFinancialAmount')}`;
        this.addToAuditLog('execution', execution);
        return execution;
      }
    }
    
    // Validate required fields (strict, no heuristics)
    const validationResult = this.validateExecution(decision.intent);
    if (!validationResult.valid) {
      execution.error = `Invalid execution: ${validationResult.errors.join(', ')}`;
      this.addToAuditLog('execution', execution);
      return execution;
    }
    
    // Execute the action (boring and strict)
    try {
      execution.result = await this.performExecution(decision.intent);
      execution.executable = true;
      
      this.addToAuditLog('execution', execution);
      
    } catch (error) {
      execution.error = `Execution failed: ${error.message}`;
      execution.executable = false;
      
      this.addToAuditLog('execution', execution);
    }
    
    return execution;
  }
  
  // POLICY SOURCE (defines allowed reality, ultimate authority)
  setPolicy(key, value, authority = 'system') {
    if (authority !== 'system' && authority !== 'external') {
      throw new Error('Only system or external authority can set policy');
    }
    
    this.policySource.set(key, value);
    
    const policyChange = {
      timestamp: new Date().toISOString(),
      key,
      value,
      authority,
      source: 'policy_source'
    };
    
    this.addToAuditLog('policy', policyChange);
    
    console.log(`Policy updated: ${key} = ${value} (by ${authority})`);
  }
  
  // Single truth contract verification
  verifySystemConsistency() {
    const issues = [];
    
    // Check that all components agree on the same truth
    const recentDecisions = this.getRecentDecisions(10);
    const recentExecutions = this.getRecentExecutions(10);
    
    // Check decision-execution consistency
    for (const decision of recentDecisions) {
      const execution = recentExecutions.find(e => e.decisionId === decision.id);
      
      if (execution) {
        // Check if execution matches decision intent
        if (execution.executable && decision.intent.actionType !== execution.result?.actionType) {
          issues.push(`Execution action type mismatch: ${decision.intent.actionType} != ${execution.result?.actionType}`);
        }
        
        // Check if execution respects policy
        if (execution.executable && execution.result?.amount > this.policySource.get('maxFinancialAmount')) {
          issues.push(`Execution violated policy: amount ${execution.result?.amount} > ${this.policySource.get('maxFinancialAmount')}`);
        }
      }
    }
    
    return {
      consistent: issues.length === 0,
      issues,
      timestamp: new Date().toISOString()
    };
  }
  
  // Blast radius control (containment when things go wrong)
  async executeWithContainment(decision, userContext) {
    const containment = {
      decisionId: decision.id,
      timestamp: new Date().toISOString(),
      blastRadius: 'contained',
      result: null,
      containment: {
        isolated: false,
        sandboxed: false,
        logged: true
      }
    };
    
    try {
      // Execute with containment
      containment.containment.isolated = true;
      containment.result = await this.executeAction(decision, userContext);
      
      if (containment.result.executable) {
        // Execution succeeded, check if it should be contained
        const shouldContain = this.shouldContainResult(containment.result);
        
        if (shouldContain) {
          containment.containment.sandboxed = true;
          // In real implementation, this would run in a sandbox
          containment.result = this.createSandboxResult(containment.result);
        }
      }
      
    } catch (error) {
      containment.result = {
        error: error.message,
        contained: true
      };
    }
    
    this.addToAuditLog('containment', containment);
    
    return containment;
  }
  
  // Core methods
  classifyIntent(input) {
    // Simple intent classification (can be enhanced)
    const lower = input.toLowerCase();
    
    if (lower.includes('transfer') || lower.includes('send') || lower.includes('money')) {
      return {
        actionType: 'transfer_funds',
        confidence: 0.8,
        description: 'Financial action detected'
      };
    }
    
    if (lower.includes('delete') || lower.includes('remove')) {
      return {
        actionType: 'delete_record',
        confidence: 0.7,
        description: 'Data modification action detected'
      };
    }
    
    return {
      actionType: 'general_query',
      confidence: 0.6,
      description: 'General query'
    };
  }
  
  calculateConfidence(input) {
    // Simple confidence calculation (can be enhanced)
    const length = input.length;
    const hasKeywords = ['revenue', 'money', 'transfer', 'delete', 'send'].some(kw => 
      input.toLowerCase().includes(kw)
    );
    
    let confidence = 0.5; // Base confidence
    
    if (length > 10) confidence += 0.2;
    if (length > 50) confidence += 0.1;
    if (hasKeywords) confidence += 0.2;
    
    return Math.min(confidence, 0.9);
  }
  
  assessRisk(input, context) {
    // Simple risk assessment (can be enhanced)
    const riskFactors = {
      financial: 0.8,
      dataModification: 0.7,
      communication: 0.3,
      information: 0.1
    };
    
    const intent = this.classifyIntent(input);
    return riskFactors[intent.actionType] || 0.5;
  }
  
  validateExecution(intent) {
    const errors = [];
    const schema = {
      transfer_funds: ['amount', 'destination', 'signature'],
      send_message: ['content', 'channel'],
      delete_record: ['recordId', 'sourceVerified'],
      general_query: ['query']
    };
    
    const requiredFields = schema[intent.actionType] || [];
    
    for (const field of requiredFields) {
      if (!(field in intent)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  async performExecution(intent) {
    // Boring, strict execution
    switch (intent.actionType) {
      case 'transfer_funds':
        return {
          actionType: 'transfer_funds',
          success: true,
          result: {
            transactionId: this.generateId('txn'),
            amount: intent.amount,
            destination: intent.destination,
            timestamp: new Date().toISOString()
          }
        };
        
      case 'send_message':
        return {
          actionType: 'send_message',
          success: true,
          result: {
            messageId: this.generateId('msg'),
            content: intent.content,
            channel: intent.channel,
            timestamp: new Date().toISOString()
          }
        };
        
      case 'delete_record':
        return {
          actionType: 'delete_record',
          success: true,
          result: {
            deletionId: this.generateId('del'),
            recordId: intent.recordId,
            sourceVerified: intent.sourceVerified,
            timestamp: new Date().toISOString()
          }
        };
        
      case 'general_query':
        return {
          actionType: 'general_query',
          success: true,
          result: {
            queryId: this.generateId('query'),
            response: `Processed: ${intent.query}`,
            timestamp: new Date().toISOString()
          }
        };
        
      default:
        throw new Error(`Unknown action type: ${intent.actionType}`);
    }
  }
  
  shouldContainResult(result) {
    // Containment logic - when should we sandbox the result
    if (!result.success) return false;
    
    switch (result.actionType) {
      case 'transfer_funds':
        return result.amount > this.policySource.get('maxFinancialAmount') * 0.5;
      case 'delete_record':
        return true; // Always contain data modifications
      default:
        return false;
    }
  }
  
  createSandboxResult(realResult) {
    return {
      ...realResult,
      sandboxed: true,
      timestamp: new Date().toISOString(),
      note: 'This is a sandboxed result for containment'
    };
  }
  
  // Utility methods
  generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  addToAuditLog(type, entry) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      type,
      entry
    };
    
    this.truthContract.auditLog.push(logEntry);
    
    // Keep audit log manageable
    if (this.truthContract.auditLog.length > 1000) {
      this.truthContract.auditLog = this.truthContract.auditLog.slice(-1000);
    }
    
    // Save to disk
    this.saveAuditLog();
  }
  
  saveAuditLog() {
    try {
      const auditData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        contract: this.truthContract,
        auditLog: this.truthContract.auditLog
      };
      
      writeFileSync('./unified-audit.json', JSON.stringify(auditData, null, 2));
    } catch (error) {
      console.error('Failed to save audit log:', error);
    }
  }
  
  getRecentDecisions(count) {
    // In real implementation, this would query the audit log
    return [];
  }
  
  getRecentExecutions(count) {
    // In real implementation, this would query the audit log
    return [];
  }
  
  getSystemStatus() {
    return {
      decisionBoundary: {
        activeDecisions: this.decisionBoundary.size,
        recentDecisions: this.getRecentDecisions(10).length
      },
      executionGate: {
        recentExecutions: this.getRecentExecutions(10).length,
        successRate: this.calculateSuccessRate()
      },
      policySource: {
        policies: Object.fromEntries(this.policySource),
        lastUpdate: this.getLastPolicyUpdate()
      },
      truthContract: {
        auditLogSize: this.truthContract.auditLog.length,
        lastEntry: this.truthContract.auditLog.length > 0 ? 
          this.truthContract.auditLog[this.truthContract.auditLog.length - 1].timestamp : null
      }
    };
  }
  
  calculateSuccessRate() {
    // Calculate success rate from recent executions
    const recentExecutions = this.getRecentExecutions(50);
    const successful = recentExecutions.filter(e => e.result?.success).length;
    return recentExecutions.length > 0 ? successful / recentExecutions.length : 0;
  }
  
  getLastPolicyUpdate() {
    const policyLog = this.truthContract.auditLog.filter(e => e.type === 'policy');
    return policyLog.length > 0 ? policyLog[policyLog.length - 1].timestamp : null;
  }
}

// Create unified system
const system = new UnifiedSystem();

// Export for external use
export default system;

// CLI interface
if (process.argv[2] === 'status') {
  console.log(JSON.stringify(system.getSystemStatus(), null, 2));
}

if (process.argv[2] === 'verify') {
  const verification = system.verifySystemConsistency();
  console.log(JSON.stringify(verification, null, 2));
}

if (process.argv[2] === 'test') {
  // Test the unified system
  system.processIntent("transfer $100 to account123").then(decision => {
    console.log('Decision:', decision);
    
    const userContext = { humanApproved: false };
    
    return system.executeAction(decision, userContext);
  }).then(execution => {
    console.log('Execution:', execution);
  }).catch(error => {
    console.error('Error:', error);
  });
}
