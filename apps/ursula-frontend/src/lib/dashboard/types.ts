export interface SystemMetric {
  name: string;
  value: number | string;
  unit?: string;
  status: 'ok' | 'warning' | 'critical' | 'unknown';
  timestamp: string;
}

export interface SystemHealth {
  cpu: SystemMetric;
  memory: SystemMetric;
  disk: SystemMetric;
  uptime: SystemMetric;
  temperatures?: SystemMetric[];
  services: ServiceStatus[];
}

export interface ServiceStatus {
  name: string;
  healthy: boolean;
  status: string;
  url?: string;
  lastSeen: string;
}

export interface BusEvent {
  id: string;
  type: string;
  payload: unknown;
  timestamp: string;
  traceId?: string;
  causationId?: string;
  source?: string;
}

export interface EventFabricState {
  events: BusEvent[];
  subscriptions: string[];
  replayActive: boolean;
  totalEvents: number;
}

export interface AgentRuntime {
  name: string;
  healthy: boolean;
  state: 'idle' | 'running' | 'error' | 'offline';
  tasks: number;
  lastHeartbeat: string;
}

export interface AIModel {
  id: string;
  provider: string;
  loaded: boolean;
  latencyMs?: number;
  tokensUsed?: number;
  active: boolean;
}

export interface MemoryState {
  episodic: number;
  semantic: number;
  vector: number;
  retrievalLatencyMs?: number;
}

export interface Task {
  id: string;
  name: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'critical';
  progress: number;
  assignedAgent?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface NetworkNode {
  name: string;
  address: string;
  port?: number;
  healthy: boolean;
  type: 'tailscale' | 'local' | 'bridge' | 'external';
}

export interface RevenueSummary {
  revenueStream: string;
  gross: number;
  fees: number;
  net: number;
  availableForPayout: number;
  pendingPayout: number;
  paidOut: number;
  heldForDisputes: number;
  lastUpdated: string;
}

export interface Notification {
  id: string;
  level: 'info' | 'warning' | 'alert' | 'critical';
  message: string;
  source: string;
  timestamp: string;
  acknowledged: boolean;
}

export interface DashboardState {
  connected: boolean;
  lastUpdate: string;
  mode: 'test' | 'live';
  systemHealth: SystemHealth;
  eventFabric: EventFabricState;
  agents: AgentRuntime[];
  models: AIModel[];
  memory: MemoryState;
  tasks: Task[];
  network: NetworkNode[];
  revenue: RevenueSummary[];
  notifications: Notification[];
  logs: string[];
}
