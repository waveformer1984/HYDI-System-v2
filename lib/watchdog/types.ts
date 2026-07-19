import type { BusEvent } from '../event-bus';
import type { HealthSnapshot } from '../health';
import type { InferenceMetric } from '../metrics';
import type { Job } from '../jobs';

export interface WatchdogCheckContext {
  snapshot: HealthSnapshot;
  metrics: InferenceMetric[];
  jobs: Job[];
  failureRate: number;
  previousFindings: WatchdogFinding[];
}

export interface WatchdogFinding {
  id: string;
  rule: string;
  severity: 'warning' | 'critical';
  message: string;
  timestamp: string;
  attempts: number;
}

export interface RecoveryResult {
  success: boolean;
  action: string;
  message?: string;
}

export interface Escalation {
  finding: WatchdogFinding;
  reason: string;
  timestamp: string;
}

export interface WatchdogRule {
  id: string;
  name: string;
  severity: 'warning' | 'critical';
  check(ctx: WatchdogCheckContext): boolean;
  diagnose(ctx: WatchdogCheckContext): string;
  recover(ctx: WatchdogCheckContext): Promise<RecoveryResult> | RecoveryResult;
}

export interface WatchdogDependencies {
  healthService: { collect(): Promise<HealthSnapshot> };
  metricsService: { query(): any[]; getFailureRate(provider?: string, model?: string): number };
  jobQueue: { get(query?: any): Promise<Job[]>; retry(jobId: string): Promise<boolean> };
  eventBus: { publish(type: string, payload: any, options?: any): Promise<BusEvent> };
}

export interface WatchdogConfig {
  intervalMs?: number;
  maxRecoveryAttempts?: number;
  failureRateThreshold?: number;
  cpuThreshold?: number;
  memoryThreshold?: number;
  diskThreshold?: number;
}
