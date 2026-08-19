/**
 * HEIDI Self-Health Monitor
 *
 * Monitors HEIDI's own operational health, separate from the components
 * it manages. Detects:
 *   - event-loop stalls (observation cycle not running)
 *   - memory growth (potential leak)
 *   - excessive recovery latency
 *   - repeated exceptions
 *   - failed persistence writes
 *   - stale observation cycles
 *   - stuck recovery actions
 *   - inability to execute capabilities
 *   - loss of own dependencies
 *
 * If HEIDI cannot safely operate, it enters an explicit degraded state
 * and preserves enough evidence for recovery/debugging.
 */

import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { SelfHealthState, ComponentState, HealthEvidence } from './types';
import type { SystemStateModel } from './SystemStateModel';
import type { OperationalMemory } from './OperationalMemory';

export class SelfHealthMonitor {
  private root: string;
  private stateModel: SystemStateModel;
  private operationalMemory: OperationalMemory | null;

  private lastObservationTime: number = Date.now();
  private memoryBaselineMb: number = 0;
  private memorySamples: Array<{ time: number; mb: number }> = [];
  private exceptionCounts = new Map<string, number>();
  private recoveryStartTimes = new Map<string, number>();
  private capabilityFailureCount: number = 0;
  private degradedMode: boolean = false;
  private degradedReason: string | null = null;
  private lastCheckTime: number = 0;
  private lastRecoveryLatencyMs: number = 0;

  // Thresholds
  private static readonly STALE_OBSERVATION_THRESHOLD_MS = 300000; // 5 min
  private static readonly MEMORY_GROWTH_THRESHOLD_MB = 100; // 100MB growth = warn
  private static readonly STUCK_RECOVERY_THRESHOLD_MS = 120000; // 2 min
  private static readonly REPEATED_EXCEPTION_THRESHOLD = 10;
  private static readonly CAPABILITY_FAILURE_THRESHOLD = 5;

  constructor(
    root: string,
    stateModel: SystemStateModel,
    operationalMemory?: OperationalMemory,
  ) {
    this.root = root;
    this.stateModel = stateModel;
    this.operationalMemory = operationalMemory ?? null;
    this.memoryBaselineMb = process.memoryUsage().rss / (1024 * 1024);
  }

  /**
   * Record that an observation cycle completed.
   * Call this at the end of each observe→detect→diagnose loop iteration.
   */
  recordObservationCycle(): void {
    this.lastObservationTime = Date.now();
  }

  /**
   * Record the start of a recovery action.
   */
  recordRecoveryStart(component: string): void {
    this.recoveryStartTimes.set(component, Date.now());
  }

  /**
   * Record the completion of a recovery action.
   */
  recordRecoveryComplete(component: string): void {
    const start = this.recoveryStartTimes.get(component);
    if (start) {
      this.lastRecoveryLatencyMs = Date.now() - start;
      this.recoveryStartTimes.delete(component);
    }
  }

  /**
   * Record a repeated exception.
   */
  recordException(errorKey: string): void {
    const count = (this.exceptionCounts.get(errorKey) ?? 0) + 1;
    this.exceptionCounts.set(errorKey, count);
  }

  /**
   * Record a capability authorization failure.
   */
  recordCapabilityFailure(): void {
    this.capabilityFailureCount++;
  }

  /**
   * Enter intentional degraded mode.
   */
  enterDegradedMode(reason: string): void {
    this.degradedMode = true;
    this.degradedReason = reason;
    this.stateModel.logEvent({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'degraded_mode_entered',
      component: 'heidi-self',
      cause: reason,
      action: 'enter_degraded_mode',
      actionResult: 'skipped',
      detail: { reason },
    });
  }

  /**
   * Exit degraded mode.
   */
  exitDegradedMode(): void {
    if (!this.degradedMode) return;
    this.degradedMode = false;
    this.degradedReason = null;
    this.stateModel.logEvent({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'degraded_mode_exited',
      component: 'heidi-self',
      action: 'exit_degraded_mode',
      actionResult: 'success',
    });
  }

  /**
   * Check if the operational event journal is writable.
   */
  private checkPersistenceWritable(): boolean {
    try {
      const dir = path.resolve(this.root, '.hydi-operational');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const testFile = path.join(dir, '.write-test');
      fs.writeFileSync(testFile, String(Date.now()), 'utf8');
      fs.unlinkSync(testFile);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if HEIDI's own dependencies are healthy.
   * HEIDI depends on: the state model being functional, the operational
   * memory being writable, and the process being alive (which it is if
   * this code is running).
   */
  private checkOwnDependencies(): boolean {
    // If we can write to the operational event log, our persistence is healthy
    return this.checkPersistenceWritable();
  }

  /**
   * Calculate memory growth rate (bytes/second).
   */
  private calculateMemoryGrowthRate(): number {
    if (this.memorySamples.length < 2) return 0;
    const first = this.memorySamples[0];
    const last = this.memorySamples[this.memorySamples.length - 1];
    const timeDiffSec = (last.time - first.time) / 1000;
    if (timeDiffSec === 0) return 0;
    const memDiffBytes = (last.mb - first.mb) * 1024 * 1024;
    return memDiffBytes / timeDiffSec;
  }

  /**
   * Count stuck recoveries (recovery actions that have been active too long).
   */
  private countStuckRecoveries(): number {
    const now = Date.now();
    let stuck = 0;
    for (const [component, startTime] of this.recoveryStartTimes) {
      if (now - startTime > SelfHealthMonitor.STUCK_RECOVERY_THRESHOLD_MS) {
        stuck++;
      }
    }
    return stuck;
  }

  /**
   * Count repeated exceptions exceeding threshold.
   */
  private countRepeatedExceptions(): number {
    let count = 0;
    for (const [, c] of this.exceptionCounts) {
      if (c >= SelfHealthMonitor.REPEATED_EXCEPTION_THRESHOLD) {
        count++;
      }
    }
    return count;
  }

  /**
   * Determine HEIDI's own state from the collected metrics.
   */
  private determineState(metrics: {
    lastObservationAge: number;
    memoryGrowthMb: number;
    stuckRecoveries: number;
    repeatedExceptions: number;
    capabilityFailures: number;
    persistenceWritable: boolean;
    ownDependenciesHealthy: boolean;
  }): ComponentState {
    // If persistence is broken, HEIDI can't record evidence — that's FAILED
    if (!metrics.persistenceWritable) return 'FAILED';
    if (!metrics.ownDependenciesHealthy) return 'FAILED';

    // If observation is stale, HEIDI's loop is stalled
    if (metrics.lastObservationAge > SelfHealthMonitor.STALE_OBSERVATION_THRESHOLD_MS / 1000) {
      return 'DEGRADED';
    }

    // If recoveries are stuck, HEIDI is in a bad state
    if (metrics.stuckRecoveries > 0) return 'DEGRADED';

    // If memory is growing rapidly, warn
    if (metrics.memoryGrowthMb > SelfHealthMonitor.MEMORY_GROWTH_THRESHOLD_MB) {
      return 'DEGRADED';
    }

    // If repeated exceptions are high, warn
    if (metrics.repeatedExceptions > 0) return 'DEGRADED';

    // If capability failures are high, warn
    if (metrics.capabilityFailures >= SelfHealthMonitor.CAPABILITY_FAILURE_THRESHOLD) {
      return 'DEGRADED';
    }

    return 'HEALTHY';
  }

  /**
   * Perform a self-health check and return the current state.
   */
  check(): SelfHealthState {
    const now = Date.now();
    const memMb = process.memoryUsage().rss / (1024 * 1024);

    // Sample memory
    this.memorySamples.push({ time: now, mb: memMb });
    if (this.memorySamples.length > 20) {
      this.memorySamples.shift();
    }

    const lastObservationAge = Math.floor((now - this.lastObservationTime) / 1000);
    const memoryGrowthMb = memMb - this.memoryBaselineMb;
    const memoryGrowthRate = this.calculateMemoryGrowthRate();
    const stuckRecoveries = this.countStuckRecoveries();
    const repeatedExceptions = this.countRepeatedExceptions();
    const persistenceWritable = this.checkPersistenceWritable();
    const ownDependenciesHealthy = this.checkOwnDependencies();
    const cpuPercent = typeof process.cpuUsage === 'function' ? this.estimateCpu() : 0;

    const state = this.determineState({
      lastObservationAge,
      memoryGrowthMb,
      stuckRecoveries,
      repeatedExceptions,
      capabilityFailures: this.capabilityFailureCount,
      persistenceWritable,
      ownDependenciesHealthy,
    });

    const selfHealth: SelfHealthState = {
      timestamp: new Date().toISOString(),
      heidiAlive: true, // if this code is running, HEIDI is alive
      loopHealthy: lastObservationAge < SelfHealthMonitor.STALE_OBSERVATION_THRESHOLD_MS / 1000,
      lastObservationAge,
      memoryUsageMb: Math.round(memMb * 100) / 100,
      memoryGrowthRate: Math.round(memoryGrowthRate),
      cpuPercent,
      recoveryLatencyMs: this.lastRecoveryLatencyMs,
      repeatedExceptions,
      persistenceWritable,
      stuckRecoveries,
      capabilityFailures: this.capabilityFailureCount,
      ownDependenciesHealthy,
      state,
      degradedMode: this.degradedMode,
      degradedReason: this.degradedReason ?? undefined,
    };

    this.lastCheckTime = now;

    // Log self-health check event
    this.stateModel.logEvent({
      id: randomUUID(),
      timestamp: selfHealth.timestamp,
      type: 'self_health_check',
      component: 'heidi-self',
      newState: state,
      action: 'self_health_check',
      actionResult: state === 'HEALTHY' ? 'success' : 'failure',
      detail: {
        memoryUsageMb: selfHealth.memoryUsageMb,
        lastObservationAge,
        stuckRecoveries,
        persistenceWritable,
        degradedMode: selfHealth.degradedMode,
      },
    });

    return selfHealth;
  }

  /**
   * Estimate CPU usage (rough approximation).
   */
  private estimateCpu(): number {
    try {
      const usage = process.cpuUsage();
      const totalMicros = usage.user + usage.system;
      const uptimeSec = process.uptime();
      if (uptimeSec === 0) return 0;
      // Approximate: CPU microseconds / uptime microseconds * 100
      return Math.min(100, Math.round((totalMicros / (uptimeSec * 1000000)) * 100));
    } catch {
      return 0;
    }
  }

  /**
   * Get the last self-health state without running a full check.
   */
  isDegraded(): boolean {
    return this.degradedMode;
  }

  /**
   * Reset exception and failure counters (e.g. after recovery).
   */
  resetCounters(): void {
    this.exceptionCounts.clear();
    this.capabilityFailureCount = 0;
  }
}
