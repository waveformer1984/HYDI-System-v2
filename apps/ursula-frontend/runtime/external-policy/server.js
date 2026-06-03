/**
 * EXTERNAL POLICY SERVICE
 * 
 * Separate service, separate deployment, separate failure domain
 */

import express from 'express';
import { createHash } from 'crypto';

class ExternalPolicyService {
  constructor() {
    this.app = express();
    this.port = process.env.POLICY_PORT || 8082;
    this.featureFlags = new Map();
    this.auditLog = [];
    this.immutableLogPath = './external-audit.json';
    
    this.initializePolicies();
    this.setupRoutes();
    this.startServer();
  }
  
  initializePolicies() {
    // Load from environment or external config
    this.featureFlags.set('allowFinancialActions', process.env.ALLOW_FINANCIAL === 'true');
    this.featureFlags.set('allowDataDeletion', process.env.ALLOW_DELETION === 'true');
    this.featureFlags.set('requireHumanApproval', process.env.REQUIRE_APPROVAL === 'true');
    this.featureFlags.set('systemEnabled', process.env.SYSTEM_ENABLED !== 'false');
    this.featureFlags.set('externalStop', false);
    
    // Load immutable log
    this.loadImmutableLog();
  }
  
  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });
    
    // Policy evaluation endpoint
    this.app.post('/evaluate', (req, res) => {
      try {
        const { proposal, requestId, runtimeId } = req.body;
        
        // Validate input
        if (!proposal || !requestId || !runtimeId) {
          return res.status(400).json({ 
            error: 'Missing required fields: proposal, requestId, runtimeId' 
          });
        }
        
        // Apply policy
        const policyResult = this.evaluatePolicy(proposal, requestId, runtimeId);
        
        // Add to immutable audit log
        this.addToAuditLog({
          timestamp: new Date().toISOString(),
          type: 'policy_evaluation',
          requestId,
          runtimeId,
          proposal,
          result: policyResult,
          source: 'external_policy'
        });
        
        res.json(policyResult);
        
      } catch (error) {
        console.error('Policy evaluation error:', error);
        res.status(500).json({ error: 'Policy evaluation failed' });
      }
    });
    
    // Feature flag management
    this.app.get('/flags', (req, res) => {
      res.json(Object.fromEntries(this.featureFlags));
    });
    
    this.app.post('/flags/:flag', (req, res) => {
      const { flag } = req.params;
      const { value } = req.body;
      
      if (this.featureFlags.has(flag)) {
        this.featureFlags.set(flag, value);
        
        this.addToAuditLog({
          timestamp: new Date().toISOString(),
          type: 'feature_flag_change',
          flag,
          value,
          changedBy: 'external_request',
          source: 'external_policy'
        });
        
        res.json({ success: true, flag, value });
      } else {
        res.status(404).json({ error: 'Unknown feature flag' });
      }
    });
    
    // External stop condition
    this.app.post('/stop', (req, res) => {
      const { stopped } = req.body;
      
      this.featureFlags.set('externalStop', stopped);
      
      this.addToAuditLog({
        timestamp: new Date().toISOString(),
        type: 'external_stop',
        stopped,
        changedBy: 'external_request',
        source: 'external_policy'
      });
      
      res.json({ externalStop: stopped });
    });
    
    // Audit log access
    this.app.get('/audit', (req, res) => {
      try {
        const logData = require(this.immutableLogPath);
        res.json(logData);
      } catch (error) {
        res.json({ entries: [] });
      }
    });
    
    // System status
    this.app.get('/status', (req, res) => {
      res.json({
        service: 'external_policy',
        port: this.port,
        flags: Object.fromEntries(this.featureFlags),
        auditLogSize: this.auditLog.length,
        uptime: process.uptime()
      });
    });
  }
  
  evaluatePolicy(proposal, requestId, runtimeId) {
    const result = {
      allow: false,
      reason: 'Default policy - blocked',
      requestId,
      runtimeId,
      timestamp: new Date().toISOString(),
      policyVersion: '1.0'
    };
    
    // Check system-wide enable flag
    if (!this.featureFlags.get('systemEnabled')) {
      result.reason = 'System is disabled by external policy';
      return result;
    }
    
    // Check external stop condition
    if (this.featureFlags.get('externalStop')) {
      result.reason = 'System is externally stopped';
      return result;
    }
    
    // Check feature flags for action types
    const actionType = proposal.actionType;
    
    if (actionType === 'financial' && !this.featureFlags.get('allowFinancialActions')) {
      result.reason = 'Financial actions are disabled by external policy';
      return result;
    }
    
    if (actionType === 'delete_record' && !this.featureFlags.get('allowDataDeletion')) {
      result.reason = 'Data deletion is disabled by external policy';
      return result;
    }
    
    // Check human approval requirement
    if (proposal.requiresHumanApproval && !this.featureFlags.get('requireHumanApproval')) {
      result.reason = 'Human approval is disabled by external policy';
      return result;
    }
    
    // External confidence threshold (stricter than internal)
    if (proposal.confidence < 0.9 && actionType !== 'conversational') {
      result.reason = 'Insufficient confidence for external policy';
      return result;
    }
    
    // All checks passed
    result.allow = true;
    result.reason = 'All external policy checks passed';
    
    return result;
  }
  
  loadImmutableLog() {
    try {
      const fs = require('fs');
      const logData = fs.readFileSync(this.immutableLogPath);
      const log = JSON.parse(logData);
      this.auditLog = log.entries || [];
    } catch (error) {
      // Create new log
      const fs = require('fs');
      fs.writeFileSync(this.immutableLogPath, JSON.stringify({
        version: '1.0',
        created: new Date().toISOString(),
        service: 'external_policy',
        entries: []
      }, null, 2));
      this.auditLog = [];
    }
  }
  
  addToAuditLog(entry) {
    try {
      const fs = require('fs');
      const logData = fs.readFileSync(this.immutableLogPath);
      const log = JSON.parse(logData);
      
      // Add entry with hash
      const entryWithHash = {
        ...entry,
        hash: this.hashEntry(entry),
        sequence: log.entries.length + 1
      };
      
      log.entries.push(entryWithHash);
      
      // Write back
      fs.writeFileSync(this.immutableLogPath, JSON.stringify(log, null, 2));
      this.auditLog = log.entries;
      
    } catch (error) {
      console.error('Failed to write to external audit log:', error);
    }
  }
  
  hashEntry(entry) {
    return createHash('sha256').update(JSON.stringify(entry)).digest('hex');
  }
  
  startServer() {
    this.app.listen(this.port, () => {
      console.log(`External Policy Service running on port ${this.port}`);
      console.log('Health check: http://localhost:' + this.port + '/health');
    });
  }
}

// Start service
const policyService = new ExternalPolicyService();

export default policyService;
