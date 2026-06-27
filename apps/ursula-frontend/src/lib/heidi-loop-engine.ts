/**
 * HEIDI LOOP ENGINE - CENTRAL ORCHESTRATOR
 * ONE place for all loop logic
 * No more scattered IKEA furniture without instructions
 */

import { HeidiState, HeidiHistory } from './heidi-state';

export interface IntentInput {
  description: string;
  strategy: string;
  heidi_confidence: number;
  cpu_required?: number;
  time_required?: number;
  risk_level?: "LOW" | "MEDIUM" | "HIGH";
  complexity?: "LOW" | "MEDIUM" | "HIGH";
}

export interface SimulationResult {
  score: number;
  risk_factors: string[];
  resource_usage: {
    cpu_estimate: number;
    time_estimate: number;
    complexity: "LOW" | "MEDIUM" | "HIGH";
  };
  decision_reason: string;
}

export interface LoopResult {
  intent: IntentInput;
  simulation: SimulationResult;
  allowed: boolean;
  timestamp: string;
  decision_reason: string;
}

/**
 * PURELY STATE-DRIVEN simulation - confidence MUST directly shape output
 */
function simulate(intent: IntentInput): SimulationResult {
  const state = HeidiState;
  const risk_factors: string[] = [];

  // CONFIDENCE IS THE PRIMARY DRIVER - NO STATIC BASE SCORE
  let score = intent.heidi_confidence;

  // Apply risk penalties - but confidence remains the foundation
  if (intent.risk_level === "HIGH") {
    score *= state.constraints.high_risk_multiplier;
    risk_factors.push("HIGH risk level");
  } else if (intent.risk_level === "LOW") {
    score *= state.constraints.low_risk_multiplier;
  }

  // CPU constraint check - PURELY STATE DRIVEN
  if (intent.cpu_required && intent.cpu_required > state.constraints.max_cpu) {
    score -= state.constraints.cpu_penalty;
    risk_factors.push(`CPU ${intent.cpu_required} exceeds limit ${state.constraints.max_cpu}`);
  }

  // Time constraint check - PURELY STATE DRIVEN
  if (intent.time_required && intent.time_required > state.constraints.max_time) {
    score -= state.constraints.time_penalty;
    risk_factors.push(`Time ${intent.time_required} exceeds limit ${state.constraints.max_time}`);
  }

  // Complexity constraint check - PURELY STATE DRIVEN
  if (intent.complexity && intent.complexity === "HIGH") {
    if (state.constraints.max_complexity === "MEDIUM") {
      score -= state.constraints.complexity_penalty_medium;
      risk_factors.push("HIGH complexity exceeds MEDIUM limit");
    } else if (state.constraints.max_complexity === "LOW") {
      score -= state.constraints.complexity_penalty_low;
      risk_factors.push("HIGH complexity exceeds LOW limit");
    }
  }

  // Minimum confidence check - PURELY STATE DRIVEN
  if (intent.heidi_confidence < state.constraints.min_confidence) {
    score -= state.constraints.confidence_penalty;
    risk_factors.push(`Confidence ${intent.heidi_confidence} below minimum ${state.constraints.min_confidence}`);
  }

  // Ensure score is bounded by state
  score = Math.max(0, Math.min(1, score));

  // Generate resource estimates - PURELY STATE DRIVEN
  const resource_usage = {
    cpu_estimate: intent.cpu_required || state.constraints.default_cpu,
    time_estimate: intent.time_required || state.constraints.default_time,
    complexity: intent.complexity || state.constraints.default_complexity
  };

  // Generate decision reason - PURELY STATE DRIVEN
  const decision_reason = score >= state.constraints.risk_threshold
    ? `Score ${(score * 100).toFixed(1)}% meets threshold ${(state.constraints.risk_threshold * 100).toFixed(1)}%`
    : `Score ${(score * 100).toFixed(1)}% below threshold ${(state.constraints.risk_threshold * 100).toFixed(1)}%`;

  return {
    score,
    risk_factors,
    resource_usage,
    decision_reason
  };
}

/**
 * Main loop orchestrator - ONE place for all logic
 */
export function runHeidiLoop(intent: IntentInput): LoopResult {
  const simulation = simulate(intent);
  const allowed = simulation.score >= HeidiState.constraints.risk_threshold;

  const result: LoopResult = {
    intent,
    simulation,
    allowed,
    timestamp: new Date().toISOString(),
    decision_reason: simulation.decision_reason
  };

  // Add to history - single source of truth
  HeidiState.addToHistory({
    intent,
    simulation,
    allowed,
    timestamp: result.timestamp,
    decision_reason: result.decision_reason
  });

  return result;
}

/**
 * Learning update - failures physically reshape future decisions
 */
export function learnFromFailure(failure: {
  type: "timeout" | "overload" | "resource_limit" | "security_violation" | "policy_breach";
  intent_id: string;
  severity: number;
  context: any;
}): void {
  // Add to failure history
  HeidiState.addFailure({
    type: failure.type,
    intent_id: failure.intent_id,
    severity: failure.severity,
    timestamp: new Date().toISOString(),
    context: failure.context
  });

  // Update constraints based on failure type - PURELY STATE DRIVEN
  switch (failure.type) {
    case "timeout":
      HeidiState.constraints.max_time *= HeidiState.constraints.timeout_learning_rate;
      break;
    case "overload":
      HeidiState.constraints.max_cpu *= HeidiState.constraints.overload_learning_rate;
      break;
    case "resource_limit":
      HeidiState.constraints.max_cpu *= HeidiState.constraints.resource_limit_learning_rate;
      break;
    case "security_violation":
      HeidiState.constraints.risk_threshold *= HeidiState.constraints.security_violation_learning_rate;
      break;
    case "policy_breach":
      HeidiState.constraints.min_confidence += HeidiState.constraints.policy_breach_learning_rate;
      break;
  }

  // Apply learning rate to prevent over-correction
  const learningFactor = 1 - (HeidiState.learning_rate * failure.severity);

  if (failure.type === "timeout") {
    HeidiState.constraints.max_time = Math.max(500, HeidiState.constraints.max_time * learningFactor);
  }

  if (failure.type === "overload") {
    HeidiState.constraints.max_cpu = Math.max(0.3, HeidiState.constraints.max_cpu * learningFactor);
  }
}

/**
 * Get current system state
 */
export function getSystemState() {
  return HeidiState.getState();
}

/**
 * Reset system (for testing)
 */
export function resetSystem() {
  HeidiState.reset();
}
