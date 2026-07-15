/**
 * EXECUTION RUNTIME (TRUSTED)
 * 
 * Dumb on purpose - only executes validated actions
 */

import { createHash } from 'crypto';

class ExecutionRuntime {
  constructor() {
    this.approvedSchemas = new Map();
    this.executionLog = [];
    this.externalStopCondition = false;
    
    // Initialize approved schemas
    this.initializeSchemas();
  }
  
  initializeSchemas() {
    // Define approved action schemas
    this.approvedSchemas.set('transfer_funds', {
      name: 'transfer_funds',
      required: ['user_id', 'amount', 'destination', 'signature'],
      optional: ['description', 'reference'],
      validation: {
        user_id: 'string',
        amount: 'number',
        destination: 'string',
        signature: 'string'
      }
    });
    
    this.approvedSchemas.set('send_message', {
      name: 'send_message',
      required: ['channel', 'content', 'signature'],
      optional: ['priority', 'metadata'],
      validation: {
        channel: 'string',
        content: 'string',
        signature: 'string'
      }
    });
    
    this.approvedSchemas.set('delete_record', {
      name: 'delete_record',
      required: ['record_id', 'source_verified'],
      optional: ['reason', 'approver'],
      validation: {
        record_id: 'string',
        source_verified: 'boolean'
      }
    });
    
    this.approvedSchemas.set('general_query', {
      name: 'general_query',
      required: ['query'],
      optional: ['context'],
      validation: {
        query: 'string'
      }
    });
  }
  
  async executeAction(proposal, context = {}) {
    // Check external stop condition first
    if (this.externalStopCondition) {
      return {
        success: false,
        error: 'System is externally stopped',
        stopped: true
      };
    }
    
    // Validate against approved schemas
    const schema = this.approvedSchemas.get(proposal.actionType);
    if (!schema) {
      return {
        success: false,
        error: `Unknown action type: ${proposal.actionType}`,
        rejected: true
      };
    }
    
    // Validate required fields
    const validationResult = this.validateAgainstSchema(proposal, schema);
    if (!validationResult.valid) {
      return {
        success: false,
        error: `Schema validation failed: ${validationResult.errors.join(', ')}`,
        rejected: true
      };
    }
    
    // Execute the action (simplified for demo)
    const result = await this.performExecution(proposal, context);
    
    // Log execution
    const logEntry = this.createExecutionLog(proposal, result);
    this.executionLog.push(logEntry);
    
    return result;
  }
  
  validateAgainstSchema(proposal, schema) {
    const errors = [];
    
    // Check required fields
    for (const field of schema.required) {
      if (!proposal[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    }
    
    // Type validation (simplified)
    for (const [field, expectedType] of Object.entries(schema.validation)) {
      if (proposal[field] && typeof proposal[field] !== expectedType) {
        errors.push(`Field ${field} must be ${expectedType}, got ${typeof proposal[field]}`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  async performExecution(proposal, context) {
    // This is where actual execution happens
    // For demo purposes, we'll simulate different actions
    
    switch (proposal.actionType) {
      case 'transfer_funds':
        return this.simulateTransfer(proposal);
      case 'send_message':
        return this.simulateMessage(proposal);
      case 'delete_record':
        return this.simulateDelete(proposal);
      case 'general_query':
        return this.simulateQuery(proposal);
      default:
        return {
          success: false,
          error: 'Unknown execution path',
          result: null
        };
    }
  }
  
  simulateTransfer(proposal) {
    // Simulate fund transfer
    return {
      success: true,
      result: {
        transactionId: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        status: 'completed',
        amount: proposal.amount,
        from: 'system_account',
        to: proposal.destination,
        timestamp: new Date().toISOString(),
        simulated: false // This would be false in real execution
      }
    };
  }
  
  simulateMessage(proposal) {
    return {
      success: true,
      result: {
        messageId: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        status: 'sent',
        channel: proposal.channel,
        content: proposal.content,
        timestamp: new Date().toISOString(),
        simulated: false
      }
    };
  }
  
  simulateDelete(proposal) {
    return {
      success: true,
      result: {
        deletionId: `del_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        status: 'deleted',
        recordId: proposal.record_id,
        timestamp: new Date().toISOString(),
        simulated: false
      }
    };
  }
  
  simulateQuery(proposal) {
    return {
      success: true,
      result: {
        queryId: `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        response: `Processed: ${proposal.query}`,
        timestamp: new Date().toISOString(),
        simulated: false
      }
    };
  }
  
  createExecutionLog(proposal, result) {
    return {
      timestamp: new Date().toISOString(),
      proposalHash: this.hashProposal(proposal),
      actionType: proposal.actionType,
      executionId: result.result?.transactionId || result.result?.messageId || result.result?.deletionId || result.result?.queryId,
      success: result.success,
      error: result.error || null,
      stopped: result.stopped || false
    };
  }
  
  hashProposal(proposal) {
    return createHash('sha256').update(JSON.stringify(proposal)).digest('hex');
  }
  
  // External control methods
  setExternalStopCondition(stopped) {
    this.externalStopCondition = stopped;
  }
  
  getExecutionLog() {
    return [...this.executionLog];
  }
  
  getApprovedSchemas() {
    const schemas = {};
    for (const [key, value] of this.approvedSchemas) {
      schemas[key] = {
        name: value.name,
        required: value.required,
        optional: value.optional
      };
    }
    return schemas;
  }
}

// Export for external use
const runtime = new ExecutionRuntime();

// Handle messages from decision runtime
process.on('message', async (msg) => {
  const { type, data } = msg;
  
  if (type === 'execute') {
    const result = await runtime.executeAction(data.proposal, data.context);
    process.send({ type: 'result', result });
  } else if (type === 'stop') {
    runtime.setExternalStopCondition(data.stopped);
    process.send({ type: 'stopped', stopped: data.stopped });
  } else if (type === 'status') {
    process.send({ 
      type: 'status', 
      stopped: runtime.externalStopCondition,
      logCount: runtime.executionLog.length,
      schemas: runtime.getApprovedSchemas()
    });
  }
});

export default runtime;
