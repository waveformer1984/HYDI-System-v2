import { randomUUID } from 'crypto';
import type {
  Escalation,
  RecoveryResult,
  WatchdogCheckContext,
  WatchdogConfig,
  WatchdogDependencies,
  WatchdogFinding,
  WatchdogRule,
} from './types';

export class WatchdogService {
  private deps: WatchdogDependencies;
  private config: Required<WatchdogConfig>;
  private rules: WatchdogRule[] = [];
  private findings: WatchdogFinding[] = [];
  private escalations: Escalation[] = [];
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(deps: WatchdogDependencies, config: WatchdogConfig = {}) {
    this.deps = deps;
    this.config = {
      intervalMs: config.intervalMs ?? 30000,
      maxRecoveryAttempts: config.maxRecoveryAttempts ?? 3,
      failureRateThreshold: config.failureRateThreshold ?? 0.5,
      cpuThreshold: config.cpuThreshold ?? 95,
      memoryThreshold: config.memoryThreshold ?? 95,
      diskThreshold: config.diskThreshold ?? 95,
    };

    this.rules = this.buildDefaultRules();
  }

  start(): this {
    if (this.running) return this;
    this.running = true;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.config.intervalMs);
    return this;
  }

  stop(): this {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this;
  }

  isRunning(): boolean {
    return this.running;
  }

  getFindings(): WatchdogFinding[] {
    return [...this.findings];
  }

  getEscalations(): Escalation[] {
    return [...this.escalations];
  }

  getStatus(): {
    running: boolean;
    rules: number;
    findings: number;
    escalations: number;
    intervalMs: number;
  } {
    return {
      running: this.running,
      rules: this.rules.length,
      findings: this.findings.length,
      escalations: this.escalations.length,
      intervalMs: this.config.intervalMs,
    };
  }

  addRule(rule: WatchdogRule): this {
    this.rules.push(rule);
    return this;
  }

  private async tick(): Promise<void> {
    try {
      const snapshot = await this.deps.healthService.collect();
      const metrics = this.deps.metricsService.query();
      const failureRate = this.deps.metricsService.getFailureRate();
      const jobs = await this.deps.jobQueue.get({ status: 'failed', limit: 100 });

      const ctx: WatchdogCheckContext = {
        snapshot,
        metrics,
        jobs,
        failureRate,
        previousFindings: this.findings,
      };

      for (const rule of this.rules) {
        if (rule.check(ctx)) {
          await this.handleFinding(rule, ctx);
        } else {
          this.clearFindingsForRule(rule.id);
        }
      }
    } catch (error) {
      console.error(
        '[Watchdog] Tick failed:',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  private async handleFinding(rule: WatchdogRule, ctx: WatchdogCheckContext): Promise<void> {
    const existing = this.findings.find((f) => f.rule === rule.id);
    const finding: WatchdogFinding = existing ?? {
      id: randomUUID(),
      rule: rule.id,
      severity: rule.severity,
      message: rule.diagnose(ctx),
      timestamp: new Date().toISOString(),
      attempts: 0,
    };

    if (!existing) {
      this.findings.push(finding);
    }

    finding.attempts += 1;
    finding.timestamp = new Date().toISOString();
    finding.message = rule.diagnose(ctx);

    await this.deps.eventBus.publish('watchdog:finding', finding, { priority: rule.severity === 'critical' ? 'high' : 'normal' });

    if (finding.attempts <= this.config.maxRecoveryAttempts) {
      const result = await rule.recover(ctx);
      await this.deps.eventBus.publish('watchdog:recovery', { finding, result }, { priority: 'normal' });

      if (result.success) {
        this.clearFindingsForRule(rule.id);
        return;
      }
    }

    if (finding.attempts > this.config.maxRecoveryAttempts) {
      const escalation: Escalation = {
        finding,
        reason: `Recovery failed after ${finding.attempts} attempts`,
        timestamp: new Date().toISOString(),
      };
      this.escalations.push(escalation);
      await this.deps.eventBus.publish('watchdog:escalate', escalation, { priority: 'high' });
    }
  }

  private clearFindingsForRule(ruleId: string): void {
    this.findings = this.findings.filter((f) => f.rule !== ruleId);
  }

  private buildDefaultRules(): WatchdogRule[] {
    const config = this.config;

    return [
      {
        id: 'ollama-unavailable',
        name: 'Ollama unavailable',
        severity: 'critical',
        check: (ctx) => ctx.snapshot.ollama.status === 'unavailable',
        diagnose: () => 'Ollama endpoint is unreachable; local inference is blocked.',
        recover: async () => {
          // No safe automatic restart path; signal intent and wait for next tick.
          return { success: false, action: 'probe', message: 'Ollama still unreachable' };
        },
      },
      {
        id: 'database-unavailable',
        name: 'Database unavailable',
        severity: 'critical',
        check: (ctx) => ctx.snapshot.database.status === 'unavailable',
        diagnose: () => 'Supabase/Postgres is unreachable.',
        recover: async () => ({ success: false, action: 'probe', message: 'Database still unreachable' }),
      },
      {
        id: 'high-failure-rate',
        name: 'High inference failure rate',
        severity: 'critical',
        check: (ctx) => ctx.failureRate >= config.failureRateThreshold && ctx.metrics.length >= 10,
        diagnose: (ctx) => `Inference failure rate ${(ctx.failureRate * 100).toFixed(1)}% exceeds threshold ${(config.failureRateThreshold * 100).toFixed(1)}%.`,
        recover: async () => ({ success: false, action: 'alert', message: 'Circuit breaker may need manual review' }),
      },
      {
        id: 'high-memory',
        name: 'High memory usage',
        severity: 'warning',
        check: (ctx) => ctx.snapshot.system.memory.usagePercent >= config.memoryThreshold,
        diagnose: (ctx) => `Memory usage ${ctx.snapshot.system.memory.usagePercent.toFixed(1)}% exceeds threshold ${config.memoryThreshold}%.`,
        recover: async () => ({ success: false, action: 'alert', message: 'Memory pressure detected' }),
      },
      {
        id: 'high-disk',
        name: 'High disk usage',
        severity: 'warning',
        check: (ctx) => ctx.snapshot.system.disks.some((d) => d.usagePercent >= config.diskThreshold),
        diagnose: (ctx) => `Disk usage above ${config.diskThreshold}% on one or more mounts.`,
        recover: async () => ({ success: false, action: 'alert', message: 'Disk pressure detected' }),
      },
      {
        id: 'dlq-jobs',
        name: 'Dead-letter queue jobs',
        severity: 'warning',
        check: (ctx) => ctx.jobs.length > 0,
        diagnose: (ctx) => `${ctx.jobs.length} failed job(s) in DLQ.`,
        recover: async (ctx) => {
          let retried = 0;
          for (const job of ctx.jobs.slice(0, 10)) {
            const ok = await this.deps.jobQueue.retry(job.id);
            if (ok) retried++;
          }
          return { success: retried > 0, action: 'retry-dlq', message: `Retried ${retried}/${ctx.jobs.length} DLQ jobs` };
        },
      },
    ];
  }
}
