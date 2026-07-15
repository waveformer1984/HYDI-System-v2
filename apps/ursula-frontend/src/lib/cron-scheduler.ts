import { ReconciliationService } from './reconciliation-service';
import { hydiAutopilot, scanSources } from './revenue-engine/engine';

export interface ScheduledTask {
  id: string;
  name: string;
  schedule: string; // cron expression
  handler: () => Promise<void>;
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
}

export class CronScheduler {
  private tasks: Map<string, ScheduledTask> = new Map();
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private reconciliationService = new ReconciliationService();

  constructor() {
    this.setupDefaultTasks();
  }

  /**
   * Setup default scheduled tasks
   */
  private setupDefaultTasks() {
    // Hourly reconciliation
    this.addTask({
      id: 'hourly-reconciliation',
      name: 'Hourly Revenue Reconciliation',
      schedule: '0 * * * *', // Every hour at minute 0
      handler: async () => {
        await this.runHourlyReconciliation();
      },
      enabled: true
    });

    // Daily comprehensive reconciliation
    this.addTask({
      id: 'daily-reconciliation',
      name: 'Daily Comprehensive Reconciliation',
      schedule: '0 2 * * *', // Every day at 2 AM
      handler: async () => {
        await this.runDailyReconciliation();
      },
      enabled: true
    });

    // Health checks
    this.addTask({
      id: 'health-check',
      name: 'System Health Check',
      schedule: '*/30 * * * *', // Every 30 minutes
      handler: async () => {
        await this.runHealthCheck();
      },
      enabled: true
    });

    // Revenue scanner every 5 minutes (QStash equivalent cadence)
    this.addTask({
      id: 'revenue-source-scan',
      name: 'Revenue Source Scanner',
      schedule: '*/5 * * * *',
      handler: async () => {
        const result = await scanSources();
        console.log('[CRON] Revenue source scan result:', result);
      },
      enabled: true
    });

    // HYDI autopilot every 60 seconds
    this.addTask({
      id: 'hydi-autopilot',
      name: 'HYDI Revenue Autopilot',
      schedule: '* * * * *',
      handler: async () => {
        const summary = await hydiAutopilot();
        console.log('[CRON] HYDI autopilot summary:', summary);
      },
      enabled: true
    });
  }

  /**
   * Add a scheduled task
   */
  addTask(task: ScheduledTask) {
    this.tasks.set(task.id, task);
    
    if (task.enabled) {
      this.scheduleTask(task);
    }
  }

  /**
   * Schedule a task using setInterval (simplified cron)
   */
  private scheduleTask(task: ScheduledTask) {
    // For simplicity, using setInterval with calculated delays
    // In production, use a proper cron library like node-cron
    const delay = this.calculateDelay(task.schedule);
    
    if (delay > 0) {
      const interval = setInterval(async () => {
        try {
          console.log(`[CRON] Running task: ${task.name}`);
          task.lastRun = new Date();
          await task.handler();
          console.log(`[CRON] Completed task: ${task.name}`);
        } catch (error) {
          console.error(`[CRON] Task failed: ${task.name}`, error);
        }
      }, delay);
      
      this.intervals.set(task.id, interval);
      task.nextRun = new Date(Date.now() + delay);
    }
  }

  /**
   * Calculate delay from cron expression (simplified)
   */
  private calculateDelay(cronExpression: string): number {
    // Simplified cron parsing for common patterns
    // In production, use a proper cron parser
    
    if (cronExpression === '0 * * * *') {
      // Every hour - run in 1 hour
      return 60 * 60 * 1000;
    } else if (cronExpression === '0 2 * * *') {
      // Daily at 2 AM - calculate time until next 2 AM
      const now = new Date();
      const next2AM = new Date(now);
      next2AM.setHours(2, 0, 0, 0);
      
      if (next2AM <= now) {
        next2AM.setDate(next2AM.getDate() + 1);
      }
      
      return next2AM.getTime() - now.getTime();
    } else if (cronExpression === '*/30 * * * *') {
      // Every 30 minutes
      return 30 * 60 * 1000;
    } else if (cronExpression === '*/5 * * * *') {
      // Every 5 minutes
      return 5 * 60 * 1000;
    } else if (cronExpression === '* * * * *') {
      // Every 1 minute
      return 60 * 1000;
    }
    
    // Default: 1 hour
    return 60 * 60 * 1000;
  }

  /**
   * Run hourly reconciliation
   */
  private async runHourlyReconciliation() {
    try {
      console.log('[CRON] Starting hourly reconciliation');
      const result = await this.reconciliationService.runReconciliation(1); // Last 1 hour
      
      if (!result.discrepancy.isWithinThreshold) {
        console.error('[CRON] Hourly reconciliation discrepancy detected:', result.discrepancy);
        // TODO: Trigger alerts
      }
      
      console.log(`[CRON] Hourly reconciliation completed: ${result.discrepancy.percentage.toFixed(2)}% discrepancy`);
    } catch (error) {
      console.error('[CRON] Hourly reconciliation failed:', error);
    }
  }

  /**
   * Run daily comprehensive reconciliation
   */
  private async runDailyReconciliation() {
    try {
      console.log('[CRON] Starting daily comprehensive reconciliation');
      const result = await this.reconciliationService.runReconciliation(24); // Last 24 hours
      
      if (!result.discrepancy.isWithinThreshold) {
        console.error('[CRON] Daily reconciliation discrepancy detected:', result.discrepancy);
        // TODO: Trigger critical alerts
      }
      
      console.log(`[CRON] Daily reconciliation completed: ${result.discrepancy.percentage.toFixed(2)}% discrepancy`);
      
      // Log daily summary
      console.log('[CRON] Daily Summary:', {
        ledgerDebits: result.ledger.totalDebits,
        stripeRevenue: result.stripe.totalRevenue,
        transactionCounts: {
          ledger: result.ledger.transactions.length,
          stripe: result.stripe.transactions.length
        },
        alerts: result.alerts.length,
        recommendations: result.recommendations.length
      });
    } catch (error) {
      console.error('[CRON] Daily reconciliation failed:', error);
    }
  }

  /**
   * Run system health check
   */
  private async runHealthCheck() {
    try {
      console.log('[CRON] Starting system health check');
      const health = await this.reconciliationService.healthCheck();
      
      if (health.status !== 'healthy') {
        console.error('[CRON] System health check failed:', health);
        // TODO: Trigger health alerts
      }
      
      console.log(`[CRON] Health check completed: ${health.status}`);
    } catch (error) {
      console.error('[CRON] Health check failed:', error);
    }
  }

  /**
   * Enable a task
   */
  enableTask(taskId: string) {
    const task = this.tasks.get(taskId);
    if (task && !task.enabled) {
      task.enabled = true;
      this.scheduleTask(task);
      console.log(`[CRON] Enabled task: ${task.name}`);
    }
  }

  /**
   * Disable a task
   */
  disableTask(taskId: string) {
    const task = this.tasks.get(taskId);
    if (task && task.enabled) {
      task.enabled = false;
      const interval = this.intervals.get(taskId);
      if (interval) {
        clearInterval(interval);
        this.intervals.delete(taskId);
      }
      console.log(`[CRON] Disabled task: ${task.name}`);
    }
  }

  /**
   * Get task status
   */
  getTaskStatus() {
    const tasks = Array.from(this.tasks.values()).map(task => ({
      id: task.id,
      name: task.name,
      enabled: task.enabled,
      lastRun: task.lastRun,
      nextRun: task.nextRun,
      schedule: task.schedule
    }));

    return {
      tasks,
      totalTasks: tasks.length,
      enabledTasks: tasks.filter(t => t.enabled).length,
      disabledTasks: tasks.filter(t => !t.enabled).length
    };
  }

  /**
   * Start the scheduler
   */
  start() {
    console.log('[CRON] Starting scheduler');
    
    // Schedule all enabled tasks
    this.tasks.forEach(task => {
      if (task.enabled) {
        this.scheduleTask(task);
      }
    });
    
    console.log(`[CRON] Scheduler started with ${this.tasks.size} tasks`);
  }

  /**
   * Stop the scheduler
   */
  stop() {
    console.log('[CRON] Stopping scheduler');
    
    // Clear all intervals
    this.intervals.forEach(interval => {
      clearInterval(interval);
    });
    this.intervals.clear();
    
    console.log('[CRON] Scheduler stopped');
  }

  /**
   * Manual task trigger
   */
  async triggerTask(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    console.log(`[CRON] Manually triggering task: ${task.name}`);
    task.lastRun = new Date();
    await task.handler();
    console.log(`[CRON] Manual task completed: ${task.name}`);
  }
}

// Global scheduler instance
export const scheduler = new CronScheduler();
