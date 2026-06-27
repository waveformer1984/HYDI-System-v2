/**
 * FAILURE REPLAY - REFLECTION ON PAST BAD DECISIONS
 * Lets Heidi "reflect" on past bad decisions without pretending to be AGI
 */

import { HeidiState, HeidiHistory } from './heidi-state';

export interface ReplayResult {
  original_intent: any;
  original_simulation: any;
  original_allowed: boolean;
  current_simulation: {
    score: number;
    would_allow: boolean;
    constraint_changes: string[];
  };
  learning_effectiveness: number;
}

/**
 * Replay failures to see how constraints have evolved
 */
export function replayFailures(history: HeidiHistory[]): ReplayResult[] {
  return history
    .filter(h => h.allowed === false)
    .map(h => {
      // Simulate the same intent with current constraints
      const currentScore = simulateWithCurrentConstraints(h.intent);
      
      const constraintChanges = analyzeConstraintChanges(h.simulation, currentScore);
      
      return {
        original_intent: h.intent,
        original_simulation: h.simulation,
        original_allowed: h.allowed,
        current_simulation: {
          score: currentScore.score,
          would_allow: currentScore.score >= HeidiState.constraints.risk_threshold,
          constraint_changes: constraintChanges
        },
        learning_effectiveness: calculateLearningEffectiveness(h.simulation.score, currentScore.score)
      };
    });
}

/**
 * Simulate intent with current constraints
 */
function simulateWithCurrentConstraints(intent: any): { score: number } {
  let score = 1.0;
  
  // Apply current constraints
  if (intent.cpu_required && intent.cpu_required > HeidiState.constraints.max_cpu) {
    score -= 0.4;
  }
  
  if (intent.time_required && intent.time_required > HeidiState.constraints.max_time) {
    score -= 0.3;
  }
  
  if (intent.heidi_confidence < HeidiState.constraints.min_confidence) {
    score -= 0.2;
  }
  
  return {
    score: Math.max(0, Math.min(1, score))
  };
}

/**
 * Analyze what constraints changed between original and current
 */
function analyzeConstraintChanges(originalSim: any, currentSim: { score: number }): string[] {
  const changes: string[] = [];
  
  if (currentSim.score > originalSim.score) {
    changes.push("Constraints loosened - higher score");
  } else if (currentSim.score < originalSim.score) {
    changes.push("Constraints tightened - lower score");
  }
  
  // Check specific constraint changes
  const recentFailures = HeidiState.getRecentFailures(10);
  if (recentFailures.some(f => f.type === "timeout")) {
    changes.push("Time constraints tightened due to timeouts");
  }
  
  if (recentFailures.some(f => f.type === "overload")) {
    changes.push("CPU constraints tightened due to overloads");
  }
  
  return changes;
}

/**
 * Calculate how effective learning has been
 */
function calculateLearningEffectiveness(originalScore: number, currentScore: number): number {
  // If the original was bad (low score) and current is better, learning is effective
  if (originalScore < 0.5 && currentScore > originalScore) {
    return Math.min(1.0, (currentScore - originalScore) * 2);
  }
  
  // If both are similar, learning is neutral
  return 0.5;
}

/**
 * Get learning insights from replay
 */
export function getLearningInsights(): {
  total_failures: number;
  constraints_tightened: number;
  constraints_loosened: number;
  learning_effectiveness: number;
  recommendations: string[];
} {
  const history = HeidiState.history;
  const replays = replayFailures(history);
  
  const constraintsTightened = replays.filter(r => 
    r.current_simulation.score < r.original_simulation.score
  ).length;
  
  const constraintsLoosened = replays.filter(r => 
    r.current_simulation.score > r.original_simulation.score
  ).length;
  
  const avgEffectiveness = replays.length > 0 ? 
    replays.reduce((sum, r) => sum + r.learning_effectiveness, 0) / replays.length : 0;
  
  const recommendations: string[] = [];
  
  if (constraintsTightened > constraintsLoosened) {
    recommendations.push("System is becoming more conservative - consider if constraints are too tight");
  }
  
  if (avgEffectiveness < 0.3) {
    recommendations.push("Learning effectiveness is low - consider adjusting learning rate");
  }
  
  if (replays.length > 50) {
    recommendations.push("High failure rate - consider fundamental constraint review");
  }
  
  return {
    total_failures: replays.length,
    constraints_tightened: constraintsTightened,
    constraints_loosened: constraintsLoosened,
    learning_effectiveness: avgEffectiveness,
    recommendations
  };
}
