/**
 * HEIDI STATE - SINGLE SOURCE OF TRUTH
 * Central state object that all modules reference
 * No more "pretending to remember things"
 */

export interface HeidiConstraints {
  max_cpu: number;
  max_time: number;
  risk_threshold: number;
  min_confidence: number;
  max_complexity: "LOW" | "MEDIUM" | "HIGH";

  // Penalties and multipliers (no more magic numbers)
  high_risk_multiplier: number;
  low_risk_multiplier: number;
  cpu_penalty: number;
  time_penalty: number;
  complexity_penalty_medium: number;
  complexity_penalty_low: number;
  confidence_penalty: number;

  // Default values
  default_cpu: number;
  default_time: number;
  default_complexity: "LOW" | "MEDIUM" | "HIGH";

  // Learning rates
  timeout_learning_rate: number;
  overload_learning_rate: number;
  resource_limit_learning_rate: number;
  security_violation_learning_rate: number;
  policy_breach_learning_rate: number;
}

export interface HeidiHistory {
  intent: any;
  simulation: any;
  allowed: boolean;
  timestamp: string;
  decision_reason: string;
}

export interface HeidiFailure {
  type: "timeout" | "overload" | "resource_limit" | "security_violation" | "policy_breach";
  intent_id: string;
  severity: number;
  timestamp: string;
  context: any;
}

export const HeidiState = {
  constraints: {
    max_cpu: 0.8,
    max_time: 2000,
    risk_threshold: 0.6,
    min_confidence: 0.3,
    max_complexity: "MEDIUM" as "LOW" | "MEDIUM" | "HIGH",

    // Penalties and multipliers (no more magic numbers)
    high_risk_multiplier: 0.7,
    low_risk_multiplier: 1.1,
    cpu_penalty: 0.4,
    time_penalty: 0.3,
    complexity_penalty_medium: 0.3,
    complexity_penalty_low: 0.5,
    confidence_penalty: 0.2,

    // Default values
    default_cpu: 0.5,
    default_time: 1000,
    default_complexity: "MEDIUM" as "LOW" | "MEDIUM" | "HIGH",

    // Learning rates
    timeout_learning_rate: 0.95,
    overload_learning_rate: 0.9,
    resource_limit_learning_rate: 0.85,
    security_violation_learning_rate: 0.9,
    policy_breach_learning_rate: 0.1
  },

  learning_rate: 0.1,

  history: [] as HeidiHistory[],

  failures: [] as HeidiFailure[],

  // State management methods
  updateConstraints(updates: Partial<HeidiConstraints>): void {
    this.constraints = { ...this.constraints, ...updates };
  },

  addToHistory(entry: HeidiHistory): void {
    this.history.push(entry);
    // Keep history manageable
    if (this.history.length > 1000) {
      this.history = this.history.slice(-1000);
    }
  },

  addFailure(failure: HeidiFailure): void {
    this.failures.push(failure);
    // Keep failure history manageable
    if (this.failures.length > 500) {
      this.failures = this.failures.slice(-500);
    }
  },

  getRecentFailures(count: number = 10): HeidiFailure[] {
    return this.failures.slice(-count);
  },

  getFailurePattern(type: string): number {
    return this.failures.filter(f => f.type === type).length;
  },

  reset(): void {
    this.history = [];
    this.failures = [];
    // Keep constraints as they are - they represent learned behavior
  },

  getState(): {
    constraints: HeidiConstraints;
    learning_rate: number;
    history_count: number;
    failure_count: number;
    recent_failures: HeidiFailure[];
  } {
    return {
      constraints: { ...this.constraints },
      learning_rate: this.learning_rate,
      history_count: this.history.length,
      failure_count: this.failures.length,
      recent_failures: this.getRecentFailures(5)
    };
  }
};
