/**
 * EVENTUAL CONSISTENCY SCHEDULER - Scheduled truth enforcement
 * Prevent slow drift between systems with periodic reconciliation
 */

export interface ConsistencyCheck {
  id: string;
  taskId: string;
  checkType: 'hourly' | 'daily' | 'weekly';
  lastChecked: string;
  status: 'pending' | 'passed' | 'failed' | 'escalated';
  discrepancies: string[];
}

export interface ReconciliationJob {
  id: string;
  type: 'hourly' | 'daily' | 'weekly';
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  tasksChecked: number;
  issuesFound: number;
  escalationsCreated: number;
}

export class EventualConsistencyScheduler {
  private hourlyJob: NodeJS.Timeout | null = null;
  private dailyJob: NodeJS.Timeout | null = null;
  private weeklyJob: NodeJS.Timeout | null = null;

  /**
   * Start all scheduled consistency jobs
   */
  start(): void {
    console.log('[CONSISTENCY] Starting scheduled consistency jobs');
    
    // Hourly reconciliation (quick check)
    this.hourlyJob = setInterval(async () => {
      await this.runHourlyReconciliation();
    }, 60 * 60 * 1000); // Every hour

    // Daily deep audit
    this.dailyJob = setInterval(async () => {
      await this.runDailyAudit();
    }, 24 * 60 * 60 * 1000); // Every 24 hours

    // Weekly comprehensive review
    this.weeklyJob = setInterval(async () => {
      await this.runWeeklyReview();
    }, 7 * 24 * 60 * 60 * 1000); // Every 7 days

    // Run initial checks
    setTimeout(() => this.runHourlyReconciliation(), 5000); // Start after 5 seconds
  }

  /**
   * Stop all scheduled jobs
   */
  stop(): void {
    if (this.hourlyJob) {
      clearInterval(this.hourlyJob);
      this.hourlyJob = null;
    }
    if (this.dailyJob) {
      clearInterval(this.dailyJob);
      this.dailyJob = null;
    }
    if (this.weeklyJob) {
      clearInterval(this.weeklyJob);
      this.weeklyJob = null;
    }
    console.log('[CONSISTENCY] Scheduled jobs stopped');
  }

  /**
   * Hourly reconciliation - quick check of recent tasks
   */
  private async runHourlyReconciliation(): Promise<ReconciliationJob> {
    const jobId = `hourly-${Date.now()}`;
    const startTime = new Date().toISOString();
    
    console.log(`[CONSISTENCY] Starting hourly reconciliation: ${jobId}`);

    const job: ReconciliationJob = {
      id: jobId,
      type: 'hourly',
      status: 'running',
      startedAt: startTime,
      tasksChecked: 0,
      issuesFound: 0,
      escalationsCreated: 0,
    };

    try {
      // Get tasks from last 2 hours
      const recentTasks = await this.getRecentTasks(2 * 60 * 60 * 1000); // 2 hours
      job.tasksChecked = recentTasks.length;

      // Quick consistency check for each task
      for (const task of recentTasks) {
        const issues = await this.quickConsistencyCheck(task);
        
        if (issues.length > 0) {
          job.issuesFound += issues.length;
          
          // Escalate if critical
          const criticalIssues = issues.filter(i => i.severity === 'critical');
          if (criticalIssues.length > 0) {
            await this.createEscalation(task.taskId, criticalIssues);
            job.escalationsCreated += criticalIssues.length;
          }
        }
      }

      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      
      console.log(`[CONSISTENCY] Hourly reconciliation completed: ${job.tasksChecked} tasks, ${job.issuesFound} issues, ${job.escalationsCreated} escalations`);
      
      return job;

    } catch (error) {
      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      console.error(`[CONSISTENCY] Hourly reconciliation failed:`, error);
      return job;
    }
  }

  /**
   * Daily deep audit - comprehensive check of all recent tasks
   */
  private async runDailyAudit(): Promise<ReconciliationJob> {
    const jobId = `daily-${Date.now()}`;
    const startTime = new Date().toISOString();
    
    console.log(`[CONSISTENCY] Starting daily audit: ${jobId}`);

    const job: ReconciliationJob = {
      id: jobId,
      type: 'daily',
      status: 'running',
      startedAt: startTime,
      tasksChecked: 0,
      issuesFound: 0,
      escalationsCreated: 0,
    };

    try {
      // Get tasks from last 24 hours
      const dailyTasks = await this.getRecentTasks(24 * 60 * 60 * 1000); // 24 hours
      job.tasksChecked = dailyTasks.length;

      // Deep consistency check for each task
      for (const task of dailyTasks) {
        const issues = await this.deepConsistencyCheck(task);
        
        if (issues.length > 0) {
          job.issuesFound += issues.length;
          
          // Escalate all issues found in daily audit
          await this.createEscalation(task.taskId, issues);
          job.escalationsCreated += 1; // One escalation per task
        }
      }

      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      
      console.log(`[CONSISTENCY] Daily audit completed: ${job.tasksChecked} tasks, ${job.issuesFound} issues, ${job.escalationsCreated} escalations`);
      
      return job;

    } catch (error) {
      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      console.error(`[CONSISTENCY] Daily audit failed:`, error);
      return job;
    }
  }

  /**
   * Weekly comprehensive review - full system health check
   */
  private async runWeeklyReview(): Promise<ReconciliationJob> {
    const jobId = `weekly-${Date.now()}`;
    const startTime = new Date().toISOString();
    
    console.log(`[CONSISTENCY] Starting weekly review: ${jobId}`);

    const job: ReconciliationJob = {
      id: jobId,
      type: 'weekly',
      status: 'running',
      startedAt: startTime,
      tasksChecked: 0,
      issuesFound: 0,
      escalationsCreated: 0,
    };

    try {
      // Get all tasks from last week
      const weeklyTasks = await this.getRecentTasks(7 * 24 * 60 * 60 * 1000); // 7 days
      job.tasksChecked = weeklyTasks.length;

      // Comprehensive analysis
      const systemMetrics = await this.analyzeSystemHealth(weeklyTasks);
      
      // Create weekly report
      await this.generateWeeklyReport(jobId, systemMetrics);
      
      // Escalate any systemic issues
      if (systemMetrics.criticalIssues > 0) {
        await this.createSystemEscalation('weekly_review', systemMetrics);
        job.escalationsCreated += 1;
      }

      job.issuesFound = systemMetrics.totalIssues;
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      
      console.log(`[CONSISTENCY] Weekly review completed: ${job.tasksChecked} tasks, ${job.issuesFound} issues, ${job.escalationsCreated} escalations`);
      
      return job;

    } catch (error) {
      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      console.error(`[CONSISTENCY] Weekly review failed:`, error);
      return job;
    }
  }

  /**
   * Quick consistency check (hourly)
   */
  private async quickConsistencyCheck(task: any): Promise<Array<{type: string, severity: string, description: string}>> {
    const issues = [];

    // Check basic consistency
    if (task.billing_status === 'paid' && !task.ursula_payment_intent_id) {
      issues.push({
        type: 'missing_payment_id',
        severity: 'critical',
        description: 'Task marked as paid but missing payment intent ID',
      });
    }

    if (task.status === 'completed' && !task.ursula_execution_id) {
      issues.push({
        type: 'missing_execution_id',
        severity: 'critical',
        description: 'Task marked as completed but missing execution ID',
      });
    }

    return issues;
  }

  /**
   * Deep consistency check (daily)
   */
  private async deepConsistencyCheck(task: any): Promise<Array<{type: string, severity: string, description: string}>> {
    const issues = await this.quickConsistencyCheck(task);

    // Add deeper checks
    try {
      // Verify payment intent actually exists in Stripe
      if (task.ursula_payment_intent_id) {
        const paymentExists = await this.verifyPaymentIntent(task.ursula_payment_intent_id);
        if (!paymentExists) {
          issues.push({
            type: 'invalid_payment_intent',
            severity: 'critical',
            description: 'Payment intent ID does not exist in Stripe',
          });
        }
      }

      // Verify execution exists in Ursula
      if (task.ursula_execution_id) {
        const executionExists = await this.verifyExecution(task.ursula_execution_id);
        if (!executionExists) {
          issues.push({
            type: 'invalid_execution_id',
            severity: 'critical',
            description: 'Execution ID does not exist in Ursula',
          });
        }
      }

    } catch (error) {
      issues.push({
        type: 'verification_failed',
        severity: 'medium',
        description: 'Failed to verify task consistency with external systems',
      });
    }

    return issues;
  }

  /**
   * Analyze system health (weekly)
   */
  private async analyzeSystemHealth(tasks: any[]): Promise<{
    totalIssues: number;
    criticalIssues: number;
    consistencyRate: number;
    paymentSuccessRate: number;
    executionSuccessRate: number;
  }> {
    let totalIssues = 0;
    let criticalIssues = 0;
    let consistentTasks = 0;
    let successfulPayments = 0;
    let successfulExecutions = 0;

    for (const task of tasks) {
      const issues = await this.deepConsistencyCheck(task);
      totalIssues += issues.length;
      criticalIssues += issues.filter(i => i.severity === 'critical').length;
      
      if (issues.length === 0) {
        consistentTasks++;
      }
      
      if (task.billing_status === 'paid') {
        successfulPayments++;
      }
      
      if (task.status === 'completed') {
        successfulExecutions++;
      }
    }

    return {
      totalIssues,
      criticalIssues,
      consistencyRate: tasks.length > 0 ? consistentTasks / tasks.length : 0,
      paymentSuccessRate: tasks.length > 0 ? successfulPayments / tasks.length : 0,
      executionSuccessRate: tasks.length > 0 ? successfulExecutions / tasks.length : 0,
    };
  }

  /**
   * Get recent tasks for reconciliation
   */
  private async getRecentTasks(timeWindowMs: number): Promise<any[]> {
    // In production, would query database for tasks in time window
    console.log(`[CONSISTENCY] Getting tasks from last ${timeWindowMs / (60 * 60 * 1000)} hours`);
    return [];
  }

  /**
   * Verify payment intent exists in Stripe
   */
  private async verifyPaymentIntent(paymentIntentId: string): Promise<boolean> {
    // In production, would call Stripe API
    return true;
  }

  /**
   * Verify execution exists in Ursula
   */
  private async verifyExecution(executionId: string): Promise<boolean> {
    // In production, would call Ursula API
    return true;
  }

  /**
   * Create escalation for task issues
   */
  private async createEscalation(taskId: string, issues: any[]): Promise<void> {
    // Import HumanReviewPipeline to avoid circular dependency
    const { HumanReviewPipeline } = await import('./human-review-pipeline');
    
    await HumanReviewPipeline.createEscalation(
      taskId,
      'financial_discrepancy',
      issues.some(i => i.severity === 'critical') ? 'critical' : 'medium',
      `Consistency check found ${issues.length} issues`,
      issues.map(i => i.description).join('; '),
      { issues }
    );
  }

  /**
   * Create system-level escalation
   */
  private async createSystemEscalation(type: string, metrics: any): Promise<void> {
    const { HumanReviewPipeline } = await import('./human-review-pipeline');
    
    await HumanReviewPipeline.createEscalation(
      'system',
      'critical_error',
      'critical',
      `System health issue detected in ${type}`,
      `Critical issues: ${metrics.criticalIssues}, Consistency rate: ${(metrics.consistencyRate * 100).toFixed(1)}%`,
      metrics
    );
  }

  /**
   * Generate weekly report
   */
  private async generateWeeklyReport(jobId: string, metrics: any): Promise<void> {
    console.log(`[CONSISTENCY] Weekly report ${jobId}:`);
    console.log(`  Total issues: ${metrics.totalIssues}`);
    console.log(`  Critical issues: ${metrics.criticalIssues}`);
    console.log(`  Consistency rate: ${(metrics.consistencyRate * 100).toFixed(1)}%`);
    console.log(`  Payment success rate: ${(metrics.paymentSuccessRate * 100).toFixed(1)}%`);
    console.log(`  Execution success rate: ${(metrics.executionSuccessRate * 100).toFixed(1)}%`);
  }

  /**
   * Get job history
   */
  async getJobHistory(type?: 'hourly' | 'daily' | 'weekly'): Promise<ReconciliationJob[]> {
    // In production, would query database
    return [];
  }
}
