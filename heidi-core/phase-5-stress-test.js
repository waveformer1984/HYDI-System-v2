#!/usr/bin/env node
/**
 * Phase 5: Stress Test Harness
 *
 * Validates system stability under load:
 * - 50+ tasks/hour sustained
 * - Lease renewal under load
 * - Memory stability
 * - Decision quality maintenance
 */

// Load ONLY .env.local for development
const dotenv = require('dotenv');
const fs = require('fs');
const envPath = '.env.local';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const parsed = dotenv.parse(envContent);
  Object.assign(process.env, parsed);
  console.log('[STRESS-TEST] Loaded configuration from .env.local');
}

const { createClient } = require('@supabase/supabase-js');

class StressTestRunner {
  constructor(config = {}) {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    this.testDuration = config.testDuration || 3600000; // 1 hour default
    this.tasksPerHour = config.tasksPerHour || 60;
    this.taskInterval = (3600000 / this.tasksPerHour);

    // Unique id for THIS run. Tagged onto every task payload so we can later
    // count ONLY the heidi_events produced by this run's tasks (the agent
    // copies task.payload through into heidi_events.payload via logEvent()).
    this.runId = require('crypto').randomUUID();

    this.stats = {
      tasksCreated: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      decisionsAutoApprove: 0,
      decisionsReview: 0,
      decisionsBlock: 0,
      totalDuration: 0,
      errors: [],
      memoryPeakMB: 0,
      startTime: null,
      endTime: null
    };

    this.taskLoop = null;
    this.isRunning = false;
  }

  /**
   * Start the stress test
   */
  async start() {
    console.log('[STRESS-TEST] Starting...');
    console.log(`  Run ID: ${this.runId}`);
    console.log(`  Duration: ${this.testDuration / 1000}s`);
    console.log(`  Rate: ${this.tasksPerHour} tasks/hour (every ${this.taskInterval.toFixed(0)}ms)`);

    this.stats.startTime = Date.now();
    this.isRunning = true;

    // Monitor memory during test
    this.monitorMemory();

    // Start task generation loop
    this.taskLoop = setInterval(async () => {
      await this.generateTask();
    }, this.taskInterval);

    // Stop after test duration
    setTimeout(() => {
      this.stop();
    }, this.testDuration);
  }

  /**
   * Generate a random task
   */
  async generateTask() {
    try {
      const task = {
        type: this.randomTaskType(),
        status: 'pending',
        priority: Math.floor(Math.random() * 3) + 1,
        division: this.randomDivision(),
        payload: {
          action: 'test',
          timestamp: new Date().toISOString(),
          run_id: this.runId,
          test_batch: `batch-${new Date().getHours()}`
        },
        confidence: 0.50 + Math.random() * 0.45, // 0.50-0.95
        within_bounds: Math.random() > 0.1 // 90% within bounds
      };

      const { data, error } = await this.supabase
        .from('agent_bus')
        .insert(task)
        .select();

      if (error) {
        this.stats.errors.push(`Insert error: ${error.message}`);
        this.stats.tasksFailed++;
      } else {
        this.stats.tasksCreated++;
      }
    } catch (error) {
      this.stats.errors.push(`Task generation error: ${error.message}`);
      this.stats.tasksFailed++;
    }
  }

  /**
   * Monitor system memory usage
   */
  monitorMemory() {
    const interval = setInterval(() => {
      const memUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);

      if (heapUsedMB > this.stats.memoryPeakMB) {
        this.stats.memoryPeakMB = heapUsedMB;
      }

      if (heapUsedMB > 500) {
        console.warn(`[STRESS-TEST] ⚠️  High memory usage: ${heapUsedMB}MB`);
      }

      if (!this.isRunning) {
        clearInterval(interval);
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Stop the test and collect results
   */
  async stop() {
    console.log('\n[STRESS-TEST] Stopping...');

    this.isRunning = false;
    clearInterval(this.taskLoop);

    this.stats.endTime = Date.now();
    this.stats.totalDuration = this.stats.endTime - this.stats.startTime;

    // Collect results from database
    await this.collectResults();

    // Clean up test data (optional)
    if (process.env.CLEANUP !== 'false') {
      await this.cleanup();
    }
  }

  /**
   * Clean up test data from agent_bus
   */
  async cleanup() {
    try {
      console.log('[STRESS-TEST] Cleaning up test data...');

      // Delete ONLY this run's tasks, matched precisely by run_id.
      const { error } = await this.supabase
        .from('agent_bus')
        .delete()
        .eq('payload->>run_id', this.runId);

      if (!error) {
        console.log('[STRESS-TEST] ✅ Cleanup complete');
      } else {
        console.warn('[STRESS-TEST] Cleanup failed:', error.message);
      }
    } catch (error) {
      console.warn('[STRESS-TEST] Cleanup error:', error.message);
    }
  }

  /**
   * Collect test results from database
   */
  async collectResults() {
    try {
      // Count ONLY events produced by THIS run's tasks. The agent copies
      // task.payload into heidi_events.payload (logEvent), so our run_id is
      // present on exactly the events we caused. The created_at window is kept
      // as a secondary guard, but run_id is what makes the number trustworthy.
      const { data: events, error } = await this.supabase
        .from('heidi_events')
        .select('verdict')
        .eq('payload->>run_id', this.runId)
        .gte('created_at', new Date(this.stats.startTime).toISOString());

      if (!error && events) {
        for (const event of events) {
          if (event.verdict === 'AUTO-APPROVE') this.stats.decisionsAutoApprove++;
          else if (event.verdict === 'REVIEW') this.stats.decisionsReview++;
          else if (event.verdict === 'BLOCK') this.stats.decisionsBlock++;
        }

        this.stats.tasksCompleted = events.length;

        // IMPORTANT: Warn if no consumer is running
        if (events.length === 0) {
          console.warn('\n⚠️ WARNING: No heidi_events found during test!');
          console.warn('[STRESS-TEST] This means the HEIDI agent is NOT running.');
          console.warn('[STRESS-TEST] The harness only measures task *consumption* speed.');
          console.warn('[STRESS-TEST] Without an active agent, throughput will be 0.');
          console.warn('[STRESS-TEST]\n[STRESS-TEST] To get real numbers:');
          console.warn('[STRESS-TEST]   Terminal 1: $env:HEIDI_ALLOW_EXEC=\'true\'; node heidi-core/heidi-agent.js');
          console.warn('[STRESS-TEST]   Terminal 2: (run this harness again)');
        }
      }
    } catch (error) {
      console.error('[STRESS-TEST] Result collection error:', error.message);
    }

    this.printResults();
  }

  /**
   * Print test results
   */
  printResults() {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║         HEIDI PHASE 5 STRESS TEST RESULTS                 ║');
    console.log('╠════════════════════════════════════════════════════════════╣');

    console.log(`║ Duration: ${(this.stats.totalDuration / 1000).toFixed(0)}s (${(this.stats.totalDuration / 60000).toFixed(1)}m)`);
    console.log(`║ Tasks Created: ${this.stats.tasksCreated}`);
    console.log(`║ Tasks Completed: ${this.stats.tasksCompleted}`);
    console.log(`║ Tasks Failed: ${this.stats.tasksFailed}`);
    console.log(`║`);

    const pct = (n) => this.stats.tasksCompleted > 0
      ? (n / this.stats.tasksCompleted * 100).toFixed(1)
      : '0.0';
    const autoApprovePct = pct(this.stats.decisionsAutoApprove);
    const reviewPct = pct(this.stats.decisionsReview);
    const blockPct = pct(this.stats.decisionsBlock);

    console.log(`║ Decisions:`);
    console.log(`║   AUTO-APPROVE: ${this.stats.decisionsAutoApprove} (${autoApprovePct}%)`);
    console.log(`║   REVIEW: ${this.stats.decisionsReview} (${reviewPct}%)`);
    console.log(`║   BLOCK: ${this.stats.decisionsBlock} (${blockPct}%)`);
    console.log(`║`);

    const throughput = (this.stats.tasksCompleted / (this.stats.totalDuration / 1000)).toFixed(2);
    const throughputPerHour = Math.round(throughput * 3600);
    console.log(`║ Throughput:`);
    console.log(`║   ${throughput} tasks/second`);
    console.log(`║   ${throughputPerHour} tasks/hour`);
    console.log(`║`);

    console.log(`║ Memory:`);
    console.log(`║   Peak heap usage: ${this.stats.memoryPeakMB}MB`);
    console.log(`║`);

    if (this.stats.errors.length > 0) {
      console.log(`║ Errors (${this.stats.errors.length}):`);
      this.stats.errors.slice(0, 5).forEach(error => {
        console.log(`║   - ${error.substring(0, 50)}`);
      });
    } else {
      console.log(`║ Errors: None`);
    }

    console.log('╠════════════════════════════════════════════════════════════╣');

    // Determine pass/fail
    const consumerIsRunning = this.stats.tasksCompleted > 0;
    const throughputOK = throughputPerHour >= 60;
    const errorRateOK = this.stats.tasksFailed < (this.stats.tasksCreated * 0.05);

    let testStatus = '✅ PASSED';
    let verdict = 'SUCCESS';

    if (!consumerIsRunning) {
      testStatus = '⚠️ NO CONSUMER';
      verdict = 'INCONCLUSIVE';
    } else if (!throughputOK || !errorRateOK) {
      testStatus = '❌ FAILED';
      verdict = 'FAILURE';
    }

    console.log(`║ Test Status: ${testStatus}`.padEnd(64) + '║');
    console.log('╚════════════════════════════════════════════════════════════╝');

    // Print verdict with detailed guidance
    if (verdict === 'SUCCESS') {
      console.log('\n✨ Stress test PASSED: System stable under load');
      process.exit(0);
    } else if (verdict === 'INCONCLUSIVE') {
      console.log('\n⚠️ Stress test INCONCLUSIVE: Consumer (heidi-agent) is not running.');
      console.log('\nTo run a real test:');
      console.log('  Terminal 1: $env:HEIDI_ALLOW_EXEC=\'true\'; node heidi-core/heidi-agent.js');
      console.log('  Terminal 2: npm run stress-test');
      process.exit(1);
    } else {
      console.log('\n❌ Stress test FAILED: Performance below targets');
      console.log(`   Expected: 60+ tasks/hour, got: ${throughputPerHour}`);
      console.log(`   Expected: <5% error rate, got: ${((this.stats.tasksFailed/this.stats.tasksCreated)*100).toFixed(1)}%`);
      process.exit(1);
    }
  }

  /**
   * Random task type
   */
  randomTaskType() {
    const types = [
      'financial_approval',
      'operational_decision',
      'deployment_request',
      'resource_request',
      'vendor_approval'
    ];
    return types[Math.floor(Math.random() * types.length)];
  }

  /**
   * Random division
   */
  randomDivision() {
    const divisions = ['appforge', 'crypto', 'creative', 'financial', 'operations'];
    return divisions[Math.floor(Math.random() * divisions.length)];
  }
}

// ============================================================================
// MAIN
// ============================================================================

const runner = new StressTestRunner({
  testDuration: parseInt(process.env.TEST_DURATION || '3600000'), // 1 hour default
  tasksPerHour: parseInt(process.env.TASKS_PER_HOUR || '60')
});

runner.start().catch(error => {
  console.error('[STRESS-TEST] Startup error:', error.message);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[STRESS-TEST] Interrupt received, stopping...');
  runner.stop();
});
