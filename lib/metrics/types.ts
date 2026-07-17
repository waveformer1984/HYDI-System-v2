/**
 * Central metrics pipeline types.
 *
 * These types are intentionally plain JSON so metrics can be persisted locally
 * (JSONL/SQLite) or exported to Supabase without transformation.
 */

export interface InferenceMetric {
  id: string;
  timestamp: string;
  requestId: string;
  conversationId?: string;
  provider: string;
  selectedModel: string;
  promptLength: number;
  responseLength: number;
  latencyMs: number;
  loadDurationMs?: number | null;
  evalDurationMs?: number | null;
  memoryLookupDurationMs?: number | null;
  actionExecutionDurationMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  errors?: string[];
  warnings?: string[];
  retryCount: number;
  fallbackReason?: string | null;
  queueWaitTimeMs?: number | null;
  cpuPercent?: number | null;
  ramUsedBytes?: number | null;
  gpuUtilization?: number | null;
}

export interface MetricQuery {
  startTime?: string;
  endTime?: string;
  provider?: string;
  model?: string;
  conversationId?: string;
  status?: 'success' | 'failure';
  limit?: number;
}

export interface DailySummary {
  date: string;
  count: number;
  successCount: number;
  failureCount: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  failureRate: number;
  topProvider: string;
  topModel: string;
}

export interface MetricAggregation {
  count: number;
  successCount: number;
  failureCount: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  failureRate: number;
  providerUsage: Record<string, number>;
  modelUsage: Record<string, number>;
  dailySummaries: DailySummary[];
}

export interface MetricsStore {
  write(metric: InferenceMetric): Promise<void> | void;
  read(query?: MetricQuery): InferenceMetric[];
  clear(): void;
}

export interface MetricsExportResult {
  exported: number;
  destination: string;
  error?: string;
}
