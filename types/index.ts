export interface SessionState {
  session_id: string
  tone: 'neutral' | 'focused' | 'degraded' | 'recovery'
  active_model: 'local' | 'api'
  last_action_status: 'success' | 'failure' | 'pending'
}

export interface ModelStatus {
  consecutiveFailures: number
  circuitBreakerActive: boolean
  circuitBreakerCooldown: number
}

export interface SystemStatus {
  model_status: ModelStatus
  memory_connected: boolean
  allowed_actions: string[]
}

export interface ActionLog {
  type: string
  status: 'completed' | 'failed' | 'pending'
  created_at: string
  result?: unknown
  error?: string
}

export interface ActionItem {
  type: string
  payload?: Record<string, unknown>
}
