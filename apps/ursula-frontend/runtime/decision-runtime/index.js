/**
 * DECISION RUNTIME (UNTRUSTED)
 * 
 * Only proposes actions, never executes
 */

import { createHash } from 'crypto';

class DecisionRuntime {
  constructor() {
    this.requestId = 0;
  this.proposals = new Map();
  this.sandbox = new Map();
  }

  async processRequest(input, context = {}) {
    const requestId = this.generateRequestId();
    
    // Import classifier from parent process
    const { classifyIntent } = await import('../../services/intent-classifier.js');
    const classification = classifyIntent(input);
    
    // Import sandbox executor
    const { SandboxExecutor } = await import('../../services/sandbox-execution.js');
    const sandbox = new SandboxExecutor();
    
    // Import degradation engine
    const { DegradationEngine } = await import('../../services/degradation-layer.js');
    const degradation = new DegradationEngine();
    
    // Create action proposal
    const proposal = await this.createProposal(input, classification, context);
    
    // Determine execution options (never execute here)
    const options = degradation.determineExecutionOptions(
      proposal.actionType,
      classification.confidence,
      proposal.riskLevel,
      context
    );
    
    // Generate simulation if requested
    let simulation = null;
    if (options.simulate) {
      simulation = await sandbox.simulateAction(proposal, input, context);
    }
    
    const result = {
      requestId,
      timestamp: new Date().toISOString(),
      input,
      classification,
      proposal,
      options,
      simulation,
      recommendation: this.generateRecommendation(options),
      auditTrail: this.createAuditTrail(input, classification, proposal, options)
    };
    
    // Store for audit
    this.proposals.set(requestId, result);
    
    return result;
  }
  
  async createProposal(input, classification, context) {
    // Extract intent and create structured proposal
    const detectedIntents = classification.meta?.detectedIntents || [];
    const primaryIntent = detectedIntents[0] || 'conversation';
    
    const actionType = this.mapIntentToActionType(primaryIntent);
    
    return {
      actionType,
      intent: primaryIntent,
      confidence: classification.confidence,
      riskLevel: this.assessRiskLevel(actionType, classification),
      input: input,
      context,
      requiresHumanApproval: this.requiresHumanApproval(actionType, classification),
      estimatedImpact: this.estimateImpact(actionType)
    };
  }
  
  mapIntentToActionType(intent) {
    const actionMap = {
      'financial': 'financial',
      'technical': 'technical', 
      'operational': 'operational',
      'conversation': 'conversational'
    };
    
    return actionMap[intent] || 'conversational';
  }
  
  assessRiskLevel(actionType, classification) {
    // Risk assessment based on action type and classification status
    if (classification.status === 'invalid_input') return 'critical';
    if (classification.status === 'ambiguous') return 'medium';
    if (classification.status === 'uncertain') return 'medium';
    if (classification.status === 'error') return 'critical';
    
    const riskMap = {
      'financial': 'high',
      'technical': 'medium',
      'operational': 'low',
      'conversational': 'low'
    };
    
    return riskMap[actionType] || 'medium';
  }
  
  requiresHumanApproval(actionType, classification) {
    if (actionType === 'financial') return true;
    if (classification.confidence < 0.7) return true;
    if (classification.status !== 'success') return true;
    return false;
  }
  
  estimateImpact(actionType) {
    const impactMap = {
      'financial': 'Financial transaction impact',
      'technical': 'System modification impact',
      'operational': 'Operational process impact',
      'conversational': 'Informational impact'
    };
    
    return impactMap[actionType] || 'Unknown impact';
  }
  
  generateRecommendation(options) {
    if (options.execute) {
      return 'Action approved for execution';
    } else if (options.simulate) {
      return 'Action simulated for review';
    } else if (options.requireConfirmation) {
      return 'Action requires human confirmation';
    } else {
      return 'Action blocked - insufficient safety criteria';
    }
  }
  
  createAuditTrail(input, classification, proposal, options) {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      inputHash: this.hashInput(input),
      classification: {
        status: classification.status,
        confidence: classification.confidence,
        detectedIntents: classification.meta?.detectedIntents || []
      },
      proposal: {
        actionType: proposal.actionType,
        riskLevel: proposal.riskLevel,
        requiresApproval: proposal.requiresHumanApproval
      },
      decision: {
        execute: options.execute,
        simulate: options.simulate,
        requireConfirmation: options.requireConfirmation,
        degradeTo: options.degradeTo
      }
    };
    
    return auditEntry;
  }
  
  hashInput(input) {
    return createHash('sha256').update(input).digest('hex');
  }
  
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  getProposal(requestId) {
    return this.proposals.get(requestId);
  }
  
  getAllProposals() {
    return Array.from(this.proposals.values());
  }
}

// Export for external use
const runtime = new DecisionRuntime();

// Handle messages from execution runtime
process.on('message', async (msg) => {
  const { type, data, requestId } = msg;
  
  if (type === 'process') {
    const result = await runtime.processRequest(data.input, data.context);
    process.send({ type: 'result', requestId, result });
  } else if (type === 'get') {
    const proposal = runtime.getProposal(requestId);
    process.send({ type: 'proposal', requestId, proposal });
  }
});

export default runtime;
