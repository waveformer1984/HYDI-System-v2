/**
 * EXECUTION GATE
 * 
 * Prevents uncertain systems from taking irreversible actions
 */

import { SystemResponse, ResponseStatus } from './response-types.js';

export interface ExecutionDecision {
  allow: boolean;
  reason: string;
  requiresConfirmation: boolean;
  confidenceThreshold: number;
  suggestedDelay?: number; // milliseconds
}

export interface ExecutionContext {
  hasSideEffects: boolean;
  isReversible: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  requiresHumanApproval?: boolean;
}

export function shouldExecute(
  response: SystemResponse,
  context: ExecutionContext
): ExecutionDecision {

  // Hard rules - no negotiation
  if (response.status === "invalid_input") {
    return {
      allow: false,
      reason: "Invalid input cannot be processed",
      requiresConfirmation: false,
      confidenceThreshold: 0.0
    };
  }

  if (response.status === "ambiguous") {
    return {
      allow: false,
      reason: "Ambiguous intent detected - human clarification required",
      requiresConfirmation: true,
      confidenceThreshold: response.confidence,
      suggestedDelay: 0 // Block until clarified
    };
  }

  if (response.status === "uncertain") {
    // For uncertain, allow only low-risk operations
    if (context.riskLevel === 'high' || context.hasSideEffects) {
      return {
        allow: false,
        reason: "Uncertain classification detected for high-risk operation",
        requiresConfirmation: true,
        confidenceThreshold: response.confidence,
        suggestedDelay: 5000 // 5 second pause for human review
      };
    }
  }

  // Success status - check confidence thresholds
  const confidenceThresholds = {
    low: 0.6,
    medium: 0.75,
    high: 0.85
  };

  const requiredConfidence = confidenceThresholds[context.riskLevel];

  if (response.confidence < requiredConfidence) {
    return {
      allow: false,
      reason: `Insufficient confidence (${response.confidence}) for ${context.riskLevel}-risk operation`,
      requiresConfirmation: true,
      confidenceThreshold: requiredConfidence,
      suggestedDelay: context.riskLevel === 'high' ? 10000 : 3000
    };
  }

  // Passed all checks
  return {
    allow: true,
    reason: "All safety checks passed",
    requiresConfirmation: context.riskLevel === 'high' || (context.requiresHumanApproval ?? false),
    confidenceThreshold: requiredConfidence
  };
}

export function forceHumanInLoop(response: SystemResponse): boolean {
  // Conditions that always require human intervention
  return (
    response.status === "ambiguous" ||
    response.status === "error" ||
    (response.status === "uncertain" && response.confidence < 0.5)
  );
}

export function createExecutionContext(operation: {
  hasSideEffects?: boolean;
  isReversible?: boolean;
  riskLevel?: 'low' | 'medium' | 'high';
  requiresHumanApproval?: boolean;
}): ExecutionContext {
  return {
    hasSideEffects: operation.hasSideEffects ?? false,
    isReversible: operation.isReversible ?? true,
    riskLevel: operation.riskLevel ?? 'medium',
    requiresHumanApproval: operation.requiresHumanApproval ?? false
  };
}
