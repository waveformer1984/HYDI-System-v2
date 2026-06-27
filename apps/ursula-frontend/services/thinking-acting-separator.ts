/**
 * THINKING VS ACTING SEPARATOR
 * 
 * Ensures decisions are locked before actions begin
 */

import { SystemResponse } from './response-types.js';
import { ExecutionDecision, ExecutionContext, shouldExecute } from './execution-gate.js';

export interface ThinkingPhase {
  status: 'thinking';
  response: SystemResponse;
  timestamp: Date;
  locked: boolean;
}

export interface ActingPhase {
  status: 'acting';
  decision: ExecutionDecision;
  context: ExecutionContext;
  startTime: Date;
  requiresConfirmation: boolean;
}

export interface ExecutionPipeline {
  thinking: ThinkingPhase;
  acting?: ActingPhase;
  completed?: boolean;
  error?: string;
}

export function createExecutionPipeline(
  response: SystemResponse,
  context: ExecutionContext
): ExecutionPipeline {
  
  // Lock the thinking phase - no changes allowed after this point
  const thinking: ThinkingPhase = {
    status: 'thinking',
    response,
    timestamp: new Date(),
    locked: true
  };

  // Make execution decision based on locked thinking
  const decision = shouldExecute(response, context);

  // Prepare acting phase
  const acting: ActingPhase = {
    status: 'acting',
    decision,
    context,
    startTime: new Date(),
    requiresConfirmation: decision.requiresConfirmation
  };

  return {
    thinking,
    acting,
    completed: false
  };
}

export function canStartExecution(pipeline: ExecutionPipeline): boolean {
  if (!pipeline.acting) return false;
  if (pipeline.completed) return false;
  if (pipeline.error) return false;
  
  // Must have confirmation if required
  if (pipeline.acting.requiresConfirmation) {
    return false; // Waiting for human approval
  }

  return pipeline.acting.decision.allow;
}

export function executeWithGuard<T>(
  pipeline: ExecutionPipeline,
  action: () => Promise<T>
): Promise<{ result?: T; error?: string }> {
  
  if (!canStartExecution(pipeline)) {
    return Promise.resolve({
      error: `Execution blocked: ${pipeline.acting?.decision.reason || 'Unknown reason'}`
    });
  }

  // Execute the action
  return action()
    .then(result => {
      pipeline.completed = true;
      return { result };
    })
    .catch(error => {
      pipeline.error = error instanceof Error ? error.message : String(error);
      return { error: pipeline.error };
    });
}

export function requiresHumanConfirmation(pipeline: ExecutionPipeline): boolean {
  return pipeline.acting?.requiresConfirmation ?? false;
}

export function getExecutionSummary(pipeline: ExecutionPipeline): {
  thinkingStatus: string;
  decisionStatus: string;
  canExecute: boolean;
  needsHuman: boolean;
} {
  return {
    thinkingStatus: pipeline.thinking.response.status,
    decisionStatus: pipeline.acting?.decision.allow ? 'allowed' : 'blocked',
    canExecute: canStartExecution(pipeline),
    needsHuman: requiresHumanConfirmation(pipeline)
  };
}
