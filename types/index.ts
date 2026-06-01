export interface SessionState {
  session_id: string;
  tone: 'neutral' | 'focused' | 'degraded' | 'recovery';
  active_model: 'local' | 'api';
  last_action_status: 'success' | 'failure' | 'pending';
}

export interface ModelStatus {
  consecutiveFailures: number;
  circuitBreakerActive: boolean;
  circuitBreakerCooldown: number;
}

export interface SystemStatus {
  model_status: ModelStatus;
  memory_connected: boolean;
  allowed_actions: string[];
}

export interface ActionLog {
  type: string;
  status: 'pending' | 'completed' | 'failed';
  created_at: string;
  payload?: Record<string, unknown>;
}

export interface ActionItem {
  idempotency_key: string;
  task_name: string;
  payload: Record<string, unknown>;
}
