/**
 * HEIDI TYPES
 * Single source of truth for all Heidi-related interfaces
 */

export type SystemStatus = "RUNNING" | "DEGRADED" | "PAUSED" | "EMERGENCY";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface HeidiStatus {
  confidence: number;
  recent_failures: number;
  recent_successes: number;
  strategy_success_rate: Record<string, number>;
  system_status: SystemStatus;
  risk_level: RiskLevel;
  learning_blocked: boolean;
  last_intent_proposal?: string;
  last_intent_score?: number;
  constraint_violations: number;
  adaptive_threshold: number;
}

export interface IntentProposal {
  intent_id: string;
  description: string;
  strategy: string;
  risk_score: number;
  allowed: boolean;
  reason?: string;
  proposed_at: string;
  heidi_confidence: number;
}

export interface IntentValidation {
  score: number;
  risk_factors: string[];
  allowed: boolean;
  reason?: string;
  estimated_resources: {
    complexity: "LOW" | "MEDIUM" | "HIGH";
    duration_minutes: number;
    dependencies: string[];
  };
}

export interface IntentResult {
  allowed: boolean;
  risk_score: number;
  reason?: string;
  validation: IntentValidation;
}

export interface IntentSimulation {
  success_probability: number;
  potential_failures: string[];
  resource_usage: {
    cpu_estimate: number;
    memory_estimate: number;
    duration_estimate: number;
  };
}

export interface LearningSignal {
  signal_type: "success" | "failure" | "rejection" | "quarantine";
  strategy: string;
  intent_id?: string;
  failure_signature?: string;
  system_status: SystemStatus;
  timestamp: string;
  signal_strength: number;
}

export interface LearningInput {
  signals: LearningSignal[];
}

export interface LearningOutput {
  processed: number;
  blocked: number;
  heidi_updated: boolean;
}

export interface FilteredLearning {
  allowed_signals: LearningSignal[];
  blocked_signals: LearningSignal[];
  learning_blocked: boolean;
  block_reason?: string;
  compression_ratio: number;
}

export interface SandboxConstraints {
  max_risk_score: number;
  blocked_strategies: string[];
  required_approvals: number;
  quarantine_signatures: string[];
  system_status_requirements: string[];
}

export interface LearningConstraints {
  require_system_running: boolean;
  min_signal_strength: number;
  max_failure_variance: number;
  block_high_risk_strategies: boolean;
  require_stable_performance: boolean;
  learning_rate_modifier: number;
}

export interface HeidiHealthSummary {
  status: HeidiStatus;
  strategy_performance: {
    good: string[];
    bad: string[];
    improving: string[];
  };
  failure_patterns: {
    signatures: string[];
    types: string[];
    strategies: string[];
  };
  recent_intents: IntentProposal[];
  learning_blocked: boolean;
  can_propose: { allowed: boolean; reason?: string };
  health_score: number;
}
