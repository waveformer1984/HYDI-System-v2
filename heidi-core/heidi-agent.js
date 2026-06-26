#!/usr/bin/env node
/**
 * HEIDI Persistent Agent
 *
 * Runs on Frank as a long-lived process that:
 * 1. Claims an operational lease
 * 2. Polls agent_bus for pending tasks
 * 3. Executes decisions within bounds
 * 4. Reflects on outcomes and learns
 * 5. Monitors system drift
 *
 * Phase 2A: Persistent orchestration
 */

const { createClient } = require('@supabase/supabase-js');

class HeidiAgent {
  constructor(config = {}) {
    this.name = 'frank-heidi-agent';
    this.leaseHolder = 'frank';
    this.leaseTTL = 120; // seconds
    this.leaseRenewalInterval = 90; // renew every 90s
    this.taskPollInterval = 30000; // poll every 30s
    this.reflectionInterval = 3600000; // reflect every hour
    this.decisionBounds = null;

    // Supabase client
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // State tracking
    this.isRunning = false;
    this.leaseClaimed = false;
    this.stats = {
      startTime: Date.now(),
      tasksProcessed: 0,
      tasksApproved: 0,
      tasksBlocked: 0,
      tasksReviewed: 0,
      reflectionsCycled: 0
    };

    // Task event loop
    this.leaseTimer = null;
    this.pollTimer = null;
    this.reflectionTimer = null;
  }

  /**
   * Claim or renew operational lease
   * Returns true if lease is held, false if someone else has it
   */
  async claimLease() {
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.leaseTTL * 1000);

      const { data, error } = await this.supabase
        .from('heidi_decision_bounds')
        .update({
          lease_holder: this.leaseHolder,
          lease_expires: expiresAt.toISOString()
        })
        .eq('lease_holder', null)
        .or(`lease_expires.lt.${now.toISOString()}`)
        .select();

      if (error) {
        console.error('[HEIDI-AGENT] Lease claim error:', error.message);
        return false;
      }

      if (data && data.length > 0) {
        this.leaseClaimed = true;
        console.log(`[HEIDI-AGENT] ✅ Lease claimed (expires: ${expiresAt.toISOString()})`);
        return true;
      }

      // Lease is held by someone else
      const { data: current } = await this.supabase
        .from('heidi_decision_bounds')
        .select('lease_holder, lease_expires')
        .single();

      if (current) {
        console.log(`[HEIDI-AGENT] ⚠️ Lease held by ${current.lease_holder} until ${current.lease_expires}`);
      }

      this.leaseClaimed = false;
      return false;
    } catch (error) {
      console.error('[HEIDI-AGENT] Lease claim failed:', error.message);
      this.leaseClaimed = false;
      return false;
    }
  }

  /**
   * Load decision bounds (AUTO-APPROVE threshold, BLOCK criteria, etc)
   */
  async loadDecisionBounds() {
    try {
      const { data, error } = await this.supabase
        .from('heidi_decision_bounds')
        .select('*')
        .single();

      if (error) {
        console.error('[HEIDI-AGENT] Bounds load error:', error.message);
        return false;
      }

      this.decisionBounds = data;
      console.log(`[HEIDI-AGENT] Decision bounds loaded: confidence_threshold=${data.auto_approve_threshold}`);
      return true;
    } catch (error) {
      console.error('[HEIDI-AGENT] Bounds loading failed:', error.message);
      return false;
    }
  }

  /**
   * Poll agent_bus for pending tasks
   * Return all tasks with status='pending'
   */
  async pollTasks() {
    try {
      const { data, error } = await this.supabase
        .from('agent_bus')
        .select('*')
        .eq('status', 'pending')
        .order('priority', { ascending: false })
        .limit(10);

      if (error) {
        console.error('[HEIDI-AGENT] Task poll error:', error.message);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[HEIDI-AGENT] Task polling failed:', error.message);
      return [];
    }
  }

  /**
   * Make a decision on a task
   * Returns: { verdict: 'AUTO-APPROVE' | 'REVIEW' | 'BLOCK', reason: string }
   */
  async makeDecision(task) {
    try {
      // Never auto-approve without explicit enable flag
      if (!process.env.HEIDI_ALLOW_EXEC) {
        return { verdict: 'REVIEW', reason: 'HEIDI_ALLOW_EXEC not set' };
      }

      // Check bounds
      if (!this.decisionBounds) {
        return { verdict: 'REVIEW', reason: 'Decision bounds not loaded' };
      }

      const taskConfidence = task.confidence || 0;
      const threshold = this.decisionBounds.auto_approve_threshold || 0.85;

      // Decision logic (triple gate)
      if (taskConfidence >= threshold && task.within_bounds) {
        return {
          verdict: 'AUTO-APPROVE',
          reason: `High confidence (${(taskConfidence * 100).toFixed(0)}%) and within bounds`
        };
      }

      if (taskConfidence < 0.5) {
        return {
          verdict: 'BLOCK',
          reason: `Low confidence (${(taskConfidence * 100).toFixed(0)}%)`
        };
      }

      // Default to review
      return {
        verdict: 'REVIEW',
        reason: `Confidence ${(taskConfidence * 100).toFixed(0)}% below threshold ${(threshold * 100).toFixed(0)}%`
      };
    } catch (error) {
      console.error('[HEIDI-AGENT] Decision failed:', error.message);
      return { verdict: 'REVIEW', reason: 'Decision engine error' };
    }
  }

  /**
   * Execute a task (if verdict is AUTO-APPROVE)
   */
  async executeTask(task, decision) {
    try {
      if (decision.verdict !== 'AUTO-APPROVE') {
        // Log review/block decision but don't execute
        await this.logEvent(task, decision.verdict, decision.reason);
        return { success: true, executed: false, verdict: decision.verdict };
      }

      console.log(`[HEIDI-AGENT] Executing task: ${task.id}`);

      // Update task status to executing
      await this.supabase
        .from('agent_bus')
        .update({ status: 'executing' })
        .eq('id', task.id);

      // Execute task (payload contains the action)
      let result = { success: false };
      try {
        // Simulate task execution based on type
        if (task.type === 'financial_approval') {
          result = await this.executeFinancialTask(task);
        } else if (task.type === 'operational_decision') {
          result = await this.executeOperationalTask(task);
        } else {
          result = { success: false, error: 'Unknown task type' };
        }
      } catch (error) {
        result = { success: false, error: error.message };
      }

      // Update task status
      const finalStatus = result.success ? 'completed' : 'failed';
      await this.supabase
        .from('agent_bus')
        .update({ status: finalStatus, result })
        .eq('id', task.id);

      // Log the event
      await this.logEvent(task, 'AUTO-APPROVE', `Executed: ${result.success ? 'success' : 'failed'}`);

      this.stats.tasksApproved++;
      return { success: true, executed: true, verdict: 'AUTO-APPROVE', result };
    } catch (error) {
      console.error('[HEIDI-AGENT] Execution failed:', error.message);
      return { success: false, executed: false, error: error.message };
    }
  }

  /**
   * Placeholder for financial task execution
   */
  async executeFinancialTask(task) {
    // In production: call payment APIs, update ledgers, etc.
    console.log(`[HEIDI-AGENT] Financial task: ${task.payload.type}`);
    return { success: true, executed_at: new Date().toISOString() };
  }

  /**
   * Placeholder for operational task execution
   */
  async executeOperationalTask(task) {
    // In production: trigger workflows, send notifications, etc.
    console.log(`[HEIDI-AGENT] Operational task: ${task.payload.action}`);
    return { success: true, executed_at: new Date().toISOString() };
  }

  /**
   * Log decision event to heidi_events
   */
  async logEvent(task, verdict, reason) {
    try {
      const { error } = await this.supabase
        .from('heidi_events')
        .insert({
          event_type: 'decision',
          division: task.division,
          payload: task.payload,
          verdict,
          context_snapshot: {
            task_id: task.id,
            reason,
            lease_holder: this.leaseHolder
          },
          memory_ids: []
        });

      if (error) {
        console.error('[HEIDI-AGENT] Event log error:', error.message);
      }
    } catch (error) {
      console.error('[HEIDI-AGENT] Event logging failed:', error.message);
    }
  }

  /**
   * Process one task cycle
   */
  async processTaskCycle() {
    if (!this.leaseClaimed) return;

    try {
      const tasks = await this.pollTasks();
      if (tasks.length === 0) return;

      console.log(`[HEIDI-AGENT] Processing ${tasks.length} pending tasks`);

      for (const task of tasks) {
        const decision = await this.makeDecision(task);
        const result = await this.executeTask(task, decision);

        this.stats.tasksProcessed++;
        if (decision.verdict === 'REVIEW') {
          this.stats.tasksReviewed++;
        } else if (decision.verdict === 'BLOCK') {
          this.stats.tasksBlocked++;
        }
      }
    } catch (error) {
      console.error('[HEIDI-AGENT] Task cycle failed:', error.message);
    }
  }

  /**
   * Reflect on recent decisions and store insights
   */
  async reflect() {
    if (!this.leaseClaimed) return;

    try {
      console.log('[HEIDI-AGENT] Running reflection cycle...');

      // Fetch recent events
      const { data: events, error } = await this.supabase
        .from('heidi_events')
        .select('*')
        .eq('event_type', 'decision')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error || !events || events.length === 0) return;

      // Analyze patterns
      const approved = events.filter(e => e.verdict === 'AUTO-APPROVE').length;
      const blocked = events.filter(e => e.verdict === 'BLOCK').length;
      const reviewed = events.filter(e => e.verdict === 'REVIEW').length;

      const reflection = {
        cycle: this.stats.reflectionsCycled + 1,
        event_range: {
          from: events[events.length - 1].id,
          to: events[0].id
        },
        patterns: [
          `Approved ${approved}/${events.length} tasks`,
          `Blocked ${blocked}/${events.length} tasks`,
          `Escalated ${reviewed}/${events.length} tasks for review`
        ],
        uncertainties: blocked > 0 ? ['Low-confidence decisions need human review'] : [],
        improvements: approved > 0.8 * events.length ? ['Increase AUTO-APPROVE threshold'] : [],
        timestamp: new Date().toISOString()
      };

      // Store reflection
      const { error: reflectError } = await this.supabase
        .from('heidi_reflections')
        .insert({
          reflection,
          event_range: reflection.event_range,
          cycle: reflection.cycle
        });

      if (reflectError) {
        console.error('[HEIDI-AGENT] Reflection storage error:', reflectError.message);
      } else {
        console.log(`[HEIDI-AGENT] Reflection cycle ${reflection.cycle} complete`);
        this.stats.reflectionsCycled++;
      }
    } catch (error) {
      console.error('[HEIDI-AGENT] Reflection failed:', error.message);
    }
  }

  /**
   * Initialize agent
   */
  async initialize() {
    console.log('[HEIDI-AGENT] Initializing...');

    // Try to claim lease
    let leaseAttempts = 0;
    while (!this.leaseClaimed && leaseAttempts < 3) {
      const claimed = await this.claimLease();
      if (claimed) break;
      leaseAttempts++;
      await new Promise(r => setTimeout(r, 2000));
    }

    if (!this.leaseClaimed) {
      console.error('[HEIDI-AGENT] Failed to claim lease after 3 attempts. Running in advisory mode.');
      // Can still run in advisory mode (REVIEW everything)
    }

    // Load decision bounds
    await this.loadDecisionBounds();

    this.isRunning = true;
    console.log('[HEIDI-AGENT] Ready');
  }

  /**
   * Start event loop
   */
  start() {
    console.log('[HEIDI-AGENT] Starting event loop...');

    // Lease renewal (every 90s)
    this.leaseTimer = setInterval(async () => {
      if (this.leaseClaimed) {
        await this.claimLease();
      }
    }, this.leaseRenewalInterval * 1000);

    // Task processing (every 30s)
    this.pollTimer = setInterval(async () => {
      await this.processTaskCycle();
    }, this.taskPollInterval);

    // Reflection (every hour)
    this.reflectionTimer = setInterval(async () => {
      await this.reflect();
    }, this.reflectionInterval);

    console.log('[HEIDI-AGENT] Event loops active');
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log('[HEIDI-AGENT] Shutting down...');

    // Clear timers
    clearInterval(this.leaseTimer);
    clearInterval(this.pollTimer);
    clearInterval(this.reflectionTimer);

    // Release lease
    if (this.leaseClaimed) {
      try {
        await this.supabase
          .from('heidi_decision_bounds')
          .update({ lease_holder: null })
          .eq('lease_holder', this.leaseHolder);

        console.log('[HEIDI-AGENT] Lease released');
      } catch (error) {
        console.error('[HEIDI-AGENT] Lease release error:', error.message);
      }
    }

    console.log('[HEIDI-AGENT] Shutdown complete');
    process.exit(0);
  }

  /**
   * Print status report
   */
  statusReport() {
    const uptime = Math.round((Date.now() - this.stats.startTime) / 1000);
    return {
      name: this.name,
      lease_holder: this.leaseHolder,
      lease_claimed: this.leaseClaimed,
      uptime_seconds: uptime,
      stats: this.stats
    };
  }
}

// Start if run directly
if (require.main === module) {
  const agent = new HeidiAgent();

  agent.initialize().then(() => {
    agent.start();

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('\n[HEIDI-AGENT] SIGTERM received');
      await agent.shutdown();
    });

    process.on('SIGINT', async () => {
      console.log('\n[HEIDI-AGENT] SIGINT received');
      await agent.shutdown();
    });

    // Status report every 5 minutes
    setInterval(() => {
      console.log('[HEIDI-AGENT] Status:', JSON.stringify(agent.statusReport(), null, 2));
    }, 300000);
  }).catch(error => {
    console.error('[HEIDI-AGENT] Initialization failed:', error);
    process.exit(1);
  });
}

module.exports = HeidiAgent;
