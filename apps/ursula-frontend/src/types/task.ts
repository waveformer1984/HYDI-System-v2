import type { CanonicalTaskStatus, StorageTaskStatus } from '@/lib/task-status';

export interface UDPTaskCore {
  task_id: string;
  owner_user_id?: string;
  user_id?: string;
  source: "ursula" | "heidi" | "manual";
  system: "revenue_pipeline" | "music_ai" | "robotics" | "forgefinder" | "general";
  type: "build" | "fix" | "test" | "deploy" | "research" | "validate";

  title: string;
  description: string;

  inputs: Record<string, any>;
  outputs_expected: Record<string, any>;

  dependencies: string[];

  priority: number;
  urgency: number;

  revenue_impact: {
    stage: "blocked" | "partial" | "ready";
    value: number; // 0-100
  };

  status: CanonicalTaskStatus | StorageTaskStatus | "claimed" | "retrying" | "complete";

  retry_count: number;
  created_at: string;
  updated_at: string;

  // URSULA INTEGRATION FIELDS
  ursula_execution_id?: string;
  ursula_ledger_entry_id?: string;
  ursula_payment_intent_id?: string;
  ursula_execution_state?: string;
  ursula_cost?: number;
  billing_status?: "pending" | "paid" | "failed" | "refunded";

  // ATOMIC GOVERNANCE FIELDS
  state_version: number;

  // ERROR HANDLING FIELD
  error?: string;

  // RESULT FIELD
  result?: any;
}

export interface TaskResult {
  task_id: string;
  status: "complete" | "failed" | "completed" | "failed_retryable" | "failed_terminal";
  execution_time: number;
  result: any;
  error?: string;
  system_impact: string;
}
