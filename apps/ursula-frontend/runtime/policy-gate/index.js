/**
 * POLICY GATE
 * 
 * External authority that sits above both runtimes
 */

import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, appendFileSync } from 'fs';

class PolicyGate {
  constructor() {
    this.featureFlags = new Map();
    this.auditLog = [];
    this.decisionRuntime = null;
    this.executionRuntime = null;
    this.immutableLogPath = './audit-log.json';
    
    this.initializeRuntimes();
    this.loadFeatureFlags();
    this.initializeImmutableLog();
  }
  
  initializeRuntimes() {
    // Start decision runtime (untrusted)
    this.decisionRuntime = new Worker(
      fileURLToPath(new URL('../decision-runtime/index.js', import.meta.url)),
      {
        eval: false,
        resourceLimits: {
          maxOldGenerationSize: 50,
          maxYoungGenerationSize: 50
        }
      }
    );
    
    // Start execution runtime (trusted)
    this.executionRuntime = new Worker(
      fileURLToPath(new URL('../execution-runtime/index.js', import.meta.url)),
      {
        eval: false,
        resourceLimits: {
          maxOldGenerationSize: 50,
          maxYoungGenerationSize: 50
        }
      }
    );
    
    // Handle messages from runtimes
    this.decisionRuntime.on('message', this.handleDecisionMessage.bind(this));
    this.executionRuntime.on('message', this.handleExecutionMessage.bind(this));
  }
  
  loadFeatureFlags() {
    // Load feature flags from environment or config
    this.featureFlags.set('allowFinancialActions', process.env.ALLOW_FINANCIAL === 'true');
    this.featureFlags.set('allowDataDeletion', process.env.ALLOW_DELETION === 'true');
    this.featureFlags.set('requireHumanApproval', process.env.REQUIRE_APPROVAL === 'true');
    this.featureFlags.set('systemEnabled', process.env.SYSTEM_ENABLED !== 'false');
  }
  
  initializeImmutableLog() {
    try {
      // Check if log exists
      readFileSync(this.immutableLogPath);
    } catch (error) {
      // Create new log with header
      writeFileSync(this.immutableLogPath, JSON.stringify({
        version: '1.0',
        created: new Date().toISOString(),
        entries: []
      }, null, 2));
    }
  }
  
  async handleDecisionMessage(msg) {
    const { type, requestId, result } = msg;
    
    if (type === 'result') {
      // Apply policy to decision result
      const policyResult = this.applyPolicy(result);
      
      // Add to immutable audit log
      this.addToAuditLog({
        timestamp: new Date().toISOString(),
        type: 'decision',
        requestId,
        original: result,
        policy: policyResult,
        runtime: 'decision'
      });
      
      // Forward to execution runtime if allowed
      if (policyResult.allow) {
        this.executionRuntime.postMessage({
          type: 'execute',
          proposal: result.proposal,
          context: policyResult.context
        });
      } else {
        // Block execution
        this.executionRuntime.postMessage({
          type: 'result',
          result: {
            success: false,
            error: 'Policy blocked execution',
            policy: policyResult.reason
          }
        });
      }
    }
  }
  
  async handleExecutionMessage(msg) {
    const { type, result } = msg;
    
    if (type === 'result') {
      // Log execution result
      this.addToAuditLog({
        timestamp: new Date().toISOString(),
        type: 'execution',
        result,
        runtime: 'execution'
      });
      
      // Send back to decision runtime
      this.decisionRuntime.postMessage({
        type: 'execution_complete',
        requestId: result.executionId,
        result
      });
    }
  }
  
  applyPolicy(decisionResult) {
    const policyResult = {
      allow: false,
      reason: 'Default policy - blocked',
      context: {}
    };
    
    // Check system-wide enable flag
    if (!this.featureFlags.get('systemEnabled')) {
      policyResult.reason = 'System is disabled';
      return policyResult;
    }
    
    // Check feature flags
    const actionType = decisionResult.proposal?.actionType;
    
    if (actionType === 'financial' && !this.featureFlags.get('allowFinancialActions')) {
      policyResult.reason = 'Financial actions are disabled';
      return policyResult;
    }
    
    if (actionType === 'delete_record' && !this.featureFlags.get('allowDataDeletion')) {
      policyResult.reason = 'Data deletion is disabled';
      return policyResult;
    }
    
    // Check human approval requirement
    if (decisionResult.proposal?.requiresHumanApproval && !this.featureFlags.get('requireHumanApproval')) {
      policyResult.reason = 'Human approval is disabled';
      return policyResult;
    }
    
    // Check confidence threshold
    if (decisionResult.confidence < 0.8 && actionType !== 'conversational') {
      policyResult.reason = 'Insufficient confidence for action type';
      return policyResult;
    }
    
    // Check if execution is allowed
    if (!decisionResult.options.execute) {
      policyResult.reason = 'Execution not approved by safety layer';
      return policyResult;
    }
    
    // All checks passed
    policyResult.allow = true;
    policyResult.reason = 'All policy checks passed';
    policyResult.context = {
      policyApplied: true,
      featureFlags: Object.fromEntries(this.featureFlags),
      timestamp: new Date().toISOString()
    };
    
    return policyResult;
  }
  
  addToAuditLog(entry) {
    try {
      const logData = readFileSync(this.immutableLogPath);
      const log = JSON.parse(logData);
      log.entries.push(entry);
      
      // Write back with new entry
      writeFileSync(this.immutableLogPath, JSON.stringify(log, null, 2));
    } catch (error) {
      console.error('Failed to write to immutable audit log:', error);
    }
  }
  
  async processRequest(input, context = {}) {
    // Route through decision runtime first
    const decisionMessage = {
      type: 'process',
      requestId: `policy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      input,
      context
    };
    
    this.decisionRuntime.postMessage(decisionMessage);
    
    // Wait for execution completion (simplified)
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ status: 'timeout' });
      }, 30000); // 30 second timeout
      
      const handler = (msg) => {
        if (msg.type === 'execution_complete') {
          clearTimeout(timeout);
          resolve({
            status: 'completed',
            decision: msg.result,
            execution: msg.result
          });
        }
      };
      
      this.decisionRuntime.on('message', handler);
    });
  }
  
  setFeatureFlag(flag, value) {
    this.featureFlags.set(flag, value);
    
    // Log flag change
    this.addToAuditLog({
      timestamp: new Date().toISOString(),
      type: 'feature_flag_change',
      flag,
      value,
      changedBy: 'policy_gate'
    });
  }
  
  setExternalStopCondition(stopped) {
    // Send stop to both runtimes
    this.decisionRuntime.postMessage({ type: 'stop', stopped });
    this.executionRuntime.postMessage({ type: 'stop', stopped });
    
    // Log external stop
    this.addToAuditLog({
      timestamp: new Date().toISOString(),
      type: 'external_stop',
      stopped,
      changedBy: 'external_controller'
    });
  }
  
  getStatus() {
    return {
      decisionRuntime: this.decisionRuntime ? 'running' : 'stopped',
      executionRuntime: this.executionRuntime ? 'running' : 'stopped',
      featureFlags: Object.fromEntries(this.featureFlags),
      auditLogSize: this.auditLog.length,
      externalStopCondition: this.featureFlags.get('externalStop') || false
    };
  }
  
  getAuditLog() {
    try {
      const logData = readFileSync(this.immutableLogPath);
      return JSON.parse(logData);
    } catch (error) {
      return { entries: [] };
    }
  }
}

// Create and start policy gate
const policyGate = new PolicyGate();

// Export for external control
export default policyGate;
