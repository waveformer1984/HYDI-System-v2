import type { HealthSnapshot, HealthStatus } from './types';

const STATUS_RANK: Record<HealthStatus, number> = {
  unknown: 0,
  healthy: 1,
  degraded: 2,
  unavailable: 3,
};

/**
 * Compare two health statuses and return the more severe one.
 */
export function mergeStatus(a: HealthStatus, b: HealthStatus): HealthStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

/**
 * Convert a rank back to a HealthStatus string.
 */
export function rankToStatus(rank: number): HealthStatus {
  const entry = (Object.entries(STATUS_RANK) as [HealthStatus, number][]).find(
    ([, r]) => r === rank
  );
  return entry?.[0] ?? 'unknown';
}

/**
 * Build a minimal default snapshot so every field is guaranteed present even
 * when a collector fails completely.
 */
export function createDefaultSnapshot(): HealthSnapshot {
  const now = new Date().toISOString();

  return {
    id: 'unknown',
    timestamp: now,
    status: 'unknown',
    version: 'unknown',
    system: {
      cpu: {
        usagePercent: null,
        loadAverage: [],
        cores: 0,
        speedMhz: null,
      },
      memory: {
        totalBytes: 0,
        freeBytes: 0,
        usedBytes: 0,
        processUsedBytes: 0,
        usagePercent: 0,
      },
      disks: [],
      uptimeSeconds: 0,
      nodeVersion: process.version,
      gitCommit: 'unknown',
      buildVersion: 'unknown',
      platform: process.platform,
      hostname: 'unknown',
    },
    gpu: {
      status: 'unknown',
      devices: [],
    },
    ollama: {
      status: 'unknown',
      baseURL: 'http://localhost:11434',
      reachable: false,
      loadedModels: [],
      modelLoadTimeMs: null,
      averageInferenceLatencyMs: null,
    },
    database: {
      status: 'unknown',
      supabase: { status: 'unknown', latencyMs: null },
      activeConversations: null,
      queueDepth: null,
      memoryEngine: { status: 'unknown', latencyMs: null },
      scheduler: { status: 'unknown', latencyMs: null },
      agentRuntime: { status: 'unknown', latencyMs: null },
      revenueEngine: { status: 'unknown', latencyMs: null },
    },
    external: {
      network: { status: 'unknown', latencyMs: null },
      firebase: { status: 'unknown', configured: false },
      stripe: { status: 'unknown', configured: false },
    },
    workers: {
      status: 'unknown',
      total: null,
      healthy: null,
      busy: null,
      error: null,
      workers: [],
    },
  };
}

/**
 * Deeply merge a partial snapshot over a default snapshot. Only replaces fields
 * that are explicitly present and non-null where appropriate.
 */
export function mergeSnapshot(
  base: HealthSnapshot,
  partial: Partial<HealthSnapshot>
): HealthSnapshot {
  return {
    ...base,
    ...partial,
    system: partial.system ? { ...base.system, ...partial.system } : base.system,
    gpu: partial.gpu ? { ...base.gpu, ...partial.gpu } : base.gpu,
    ollama: partial.ollama ? { ...base.ollama, ...partial.ollama } : base.ollama,
    database: partial.database ? { ...base.database, ...partial.database } : base.database,
    external: partial.external ? { ...base.external, ...partial.external } : base.external,
    workers: partial.workers ? { ...base.workers, ...partial.workers } : base.workers,
  };
}
