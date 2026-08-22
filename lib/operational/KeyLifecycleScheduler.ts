/**
 * Key Lifecycle Scheduler
 *
 * Schedules recurring key lifecycle operations:
 *   - Expiration warnings
 *   - Rotation
 *   - Validation
 *   - Unused-key review
 *   - Stale-key cleanup
 *   - Inventory reconciliation
 *   - Secret scanning
 *
 * Scheduling survives process restarts via a durable schedule file at
 * .hydi-operational/key-schedule.json. On restart, the scheduler reloads
 * the schedule and resumes from where it left off.
 *
 * ARCHITECTURE: This does NOT introduce a second autonomy pipeline.
 * All scheduled operations pass through the KeyPolicyEngine via the
 * KeyManagementService. The scheduler only triggers WHEN operations
 * happen, not WHAT happens.
 */

import fs from 'fs';
import path from 'path';
import type { KeyManagementService } from './KeyManagementService';
import type { KeyHealthMonitor } from './KeyHealthMonitor';
import type { SecretScanner } from './SecretScanner';

/**
 * A scheduled key lifecycle task.
 */
interface ScheduledTask {
  id: string;
  type: ScheduledTaskType;
  intervalMs: number;
  lastRunAt: string | null;
  nextRunAt: string;
  enabled: boolean;
}

/**
 * Types of scheduled tasks.
 */
export type ScheduledTaskType =
  | 'expiration_check'
  | 'rotation_check'
  | 'validation_check'
  | 'unused_key_review'
  | 'stale_key_cleanup'
  | 'inventory_reconcile'
  | 'secret_scan';

/**
 * Result of a scheduled task run.
 */
interface TaskRunResult {
  taskId: string;
  taskType: ScheduledTaskType;
  success: boolean;
  durationMs: number;
  findings: number;
  error: string | null;
  timestamp: string;
}

/**
 * The key lifecycle scheduler.
 */
export class KeyLifecycleScheduler {
  private kms: KeyManagementService;
  private healthMonitor: KeyHealthMonitor | null;
  private scanner: SecretScanner | null;
  private scheduleFile: string;
  private tasks: Map<string, ScheduledTask> = new Map();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private history: TaskRunResult[] = [];
  private readonly maxHistory = 100;

  constructor(
    root: string,
    kms: KeyManagementService,
    healthMonitor?: KeyHealthMonitor,
    scanner?: SecretScanner,
  ) {
    this.kms = kms;
    this.healthMonitor = healthMonitor ?? null;
    this.scanner = scanner ?? null;

    const dataDir = path.resolve(root, '.hydi-operational');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.scheduleFile = path.resolve(dataDir, 'key-schedule.json');

    this.loadSchedule();
    this.initializeDefaults();
  }

  /**
   * Start the scheduler.
   */
  start(checkIntervalMs = 60000): void {
    if (this.running) return;
    this.running = true;

    this.timer = setInterval(() => {
      this.tick().catch(() => { /* best effort */ });
    }, checkIntervalMs);
  }

  /**
   * Stop the scheduler.
   */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.persistSchedule();
  }

  /**
   * Run a single tick — check for due tasks and execute them.
   */
  async tick(): Promise<TaskRunResult[]> {
    const now = Date.now();
    const results: TaskRunResult[] = [];

    for (const [taskId, task] of this.tasks) {
      if (!task.enabled) continue;

      const nextRunMs = new Date(task.nextRunAt).getTime();
      if (now < nextRunMs) continue;

      const result = await this.runTask(taskId);
      results.push(result);

      // Update next run time
      task.lastRunAt = new Date().toISOString();
      task.nextRunAt = new Date(now + task.intervalMs).toISOString();
      this.tasks.set(taskId, task);
    }

    this.persistSchedule();
    return results;
  }

  /**
   * Run a specific task by ID.
   */
  async runTask(taskId: string): Promise<TaskRunResult> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return {
        taskId,
        taskType: 'validation_check',
        success: false,
        durationMs: 0,
        findings: 0,
        error: 'Task not found',
        timestamp: new Date().toISOString(),
      };
    }

    const start = Date.now();
    try {
      let findings = 0;

      switch (task.type) {
        case 'expiration_check':
        case 'rotation_check':
        case 'unused_key_review':
        case 'stale_key_cleanup':
          if (this.healthMonitor) {
            const result = await this.healthMonitor.checkAll();
            findings = result.summary.withFindings;
          }
          break;

        case 'validation_check':
          // Validate all active keys
          const inventory = this.kms.getInventory();
          for (const key of inventory.keys) {
            if (key.lifecycleState === 'ACTIVE') {
              try {
                await this.kms.validate(key.id);
              } catch { /* best effort */ }
            }
          }
          break;

        case 'inventory_reconcile':
          await this.kms.discover();
          break;

        case 'secret_scan':
          if (this.scanner) {
            const scanResult = await this.scanner.scan();
            findings = scanResult.newFindingsCount;
            // Update health monitor with leak findings
            if (this.healthMonitor) {
              this.healthMonitor.updateLeakFindings(scanResult.findings.map(f => ({ fingerprint: f.fingerprint })));
            }
          }
          break;
      }

      const result: TaskRunResult = {
        taskId,
        taskType: task.type,
        success: true,
        durationMs: Date.now() - start,
        findings,
        error: null,
        timestamp: new Date().toISOString(),
      };

      this.addHistory(result);
      return result;
    } catch (error) {
      const result: TaskRunResult = {
        taskId,
        taskType: task.type,
        success: false,
        durationMs: Date.now() - start,
        findings: 0,
        error: error instanceof Error ? error.message : 'unknown',
        timestamp: new Date().toISOString(),
      };
      this.addHistory(result);
      return result;
    }
  }

  /**
   * Get the current schedule.
   */
  getSchedule(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Enable or disable a task.
   */
  setTaskEnabled(taskId: string, enabled: boolean): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.enabled = enabled;
      this.tasks.set(taskId, task);
      this.persistSchedule();
    }
  }

  /**
   * Get task run history.
   */
  getHistory(): TaskRunResult[] {
    return [...this.history];
  }

  /**
   * Check if the scheduler is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private initializeDefaults(): void {
    const defaults: { type: ScheduledTaskType; intervalMs: number }[] = [
      { type: 'expiration_check', intervalMs: 60 * 60 * 1000 },       // 1 hour
      { type: 'rotation_check', intervalMs: 60 * 60 * 1000 },          // 1 hour
      { type: 'validation_check', intervalMs: 6 * 60 * 60 * 1000 },    // 6 hours
      { type: 'unused_key_review', intervalMs: 24 * 60 * 60 * 1000 },  // 24 hours
      { type: 'stale_key_cleanup', intervalMs: 24 * 60 * 60 * 1000 },  // 24 hours
      { type: 'inventory_reconcile', intervalMs: 5 * 60 * 1000 },      // 5 minutes
      { type: 'secret_scan', intervalMs: 24 * 60 * 60 * 1000 },        // 24 hours
    ];

    for (const def of defaults) {
      const id = `default_${def.type}`;
      if (!this.tasks.has(id)) {
        const now = Date.now();
        this.tasks.set(id, {
          id,
          type: def.type,
          intervalMs: def.intervalMs,
          lastRunAt: null,
          nextRunAt: new Date(now + def.intervalMs).toISOString(),
          enabled: true,
        });
      }
    }
  }

  private addHistory(result: TaskRunResult): void {
    this.history.push(result);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  private persistSchedule(): void {
    try {
      const data = {
        tasks: Array.from(this.tasks.values()),
        persistedAt: new Date().toISOString(),
      };
      fs.writeFileSync(this.scheduleFile, JSON.stringify(data, null, 2));
    } catch { /* best effort */ }
  }

  private loadSchedule(): void {
    try {
      if (!fs.existsSync(this.scheduleFile)) return;
      const data = JSON.parse(fs.readFileSync(this.scheduleFile, 'utf8'));
      if (data.tasks && Array.isArray(data.tasks)) {
        for (const task of data.tasks) {
          this.tasks.set(task.id, task);
        }
      }
    } catch { /* file may not exist or be corrupt */ }
  }
}
