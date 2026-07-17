/**
 * Centralized health observability types for HYDI System v2.
 *
 * All health snapshots share the same top-level shape so callers can rely on a
 * single structured JSON object regardless of which collector produced it.
 */

export type HealthStatus = 'healthy' | 'degraded' | 'unavailable' | 'unknown';

export interface CpuHealth {
  usagePercent: number | null;
  loadAverage: number[];
  cores: number;
  speedMhz: number | null;
}

export interface MemoryHealth {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  processUsedBytes: number;
  usagePercent: number;
}

export interface DiskHealth {
  path: string;
  totalBytes: number;
  freeBytes: number;
  usagePercent: number;
}

export interface SystemHealth {
  cpu: CpuHealth;
  memory: MemoryHealth;
  disks: DiskHealth[];
  uptimeSeconds: number;
  nodeVersion: string;
  gitCommit: string;
  buildVersion: string;
  platform: string;
  hostname: string;
}

export interface GpuDevice {
  name: string;
  vendor?: string;
  vramBytes?: number;
  utilizationPercent?: number | null;
  temperatureC?: number | null;
}

export interface GpuHealth {
  status: HealthStatus;
  devices: GpuDevice[];
  error?: string;
}

export interface LoadedModel {
  name: string;
  size?: number;
  contextLength?: number;
  expiresAt?: string;
}

export interface OllamaHealth {
  status: HealthStatus;
  baseURL: string;
  reachable: boolean;
  version?: string;
  loadedModels: LoadedModel[];
  modelLoadTimeMs: number | null;
  averageInferenceLatencyMs: number | null;
  error?: string;
}

export interface DatabaseSubsystem {
  status: HealthStatus;
  latencyMs: number | null;
  message?: string;
  error?: string;
}

export interface DatabaseHealth {
  status: HealthStatus;
  supabase: DatabaseSubsystem;
  activeConversations: number | null;
  queueDepth: number | null;
  memoryEngine: DatabaseSubsystem;
  scheduler: DatabaseSubsystem;
  agentRuntime: DatabaseSubsystem;
  revenueEngine: DatabaseSubsystem;
}

export interface ExternalSubsystem {
  status: HealthStatus;
  latencyMs?: number | null;
  configured?: boolean;
  message?: string;
  error?: string;
}

export interface ExternalHealth {
  network: ExternalSubsystem;
  firebase: ExternalSubsystem;
  stripe: ExternalSubsystem;
}

export interface WorkerHealth {
  status: HealthStatus;
  total: number | null;
  healthy: number | null;
  busy: number | null;
  error: number | null;
  workers: { id: string; status: string }[];
  message?: string;
}

/**
 * The canonical health snapshot returned by every health endpoint and dashboard.
 */
export interface HealthSnapshot {
  id: string;
  timestamp: string;
  status: HealthStatus;
  version: string;
  system: SystemHealth;
  gpu: GpuHealth;
  ollama: OllamaHealth;
  database: DatabaseHealth;
  external: ExternalHealth;
  workers: WorkerHealth;
}

/**
 * A collector contributes a partial snapshot. HealthService merges all partials,
 * supplies defaults, and computes the aggregate status.
 */
export interface HealthCollector {
  name: string;
  collect(): Promise<Partial<HealthSnapshot>>;
}
