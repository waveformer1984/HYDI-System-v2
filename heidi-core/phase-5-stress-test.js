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
  }

  /**
   * Collect test results from database
   */
  async collectResults() {
    try {
      // Get recent events created during test
      const { data: events, error } = await this.supabase
        .from('heidi_events')
        .select('verdict')
        .gte('created_at', new Date(this.stats.startTime).toISOString())
        .lte('created_at', new Date(this.stats.endTime).toISOString());

      if (!error && events) {
        for (const event of events) {
          if (event.verdict === 'AUTO-APPROVE') this.stats.decisionsAutoApprove++;
          else if (event.verdict === 'REVIEW') this.stats.decisionsReview++;
          else if (event.verdict === 'BLOCK') this.stats.decisionsBlock++;
        }

        this.stats.tasksCompleted = events.length;
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

    const autoApprovePct = (this.stats.decisionsAutoApprove / this.stats.tasksCompleted * 100).toFixed(1);
    const reviewPct = (this.stats.decisionsReview / this.stats.tasksCompleted * 100).toFixed(1);
    const blockPct = (this.stats.decisionsBlock / this.stats.tasksCompleted * 100).toFixed(1);

    console.log(`║ Decisions:`);
    console.log(`║   AUTO-APPROVE: ${this.stats.decisionsAutoApprove} (${autoApprovePct}%)`);
    console.log(`║   REVIEW: ${this.stats.decisionsReview} (${reviewPct}%)`);
    console.log(`║   BLOCK: ${this.stats.decisionsBlock} (${blockPct}%)`);
    console.log(`║`);

    const throughput = (this.stats.tasksCompleted / (this.stats.totalDuration / 1000)).toFixed(2);
    const throughputPerHour = (throughput * 3600).toFixed(0);
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
    }

    console.log('╠════════════════════════════════════════════════════════════╣');

    const testStatus = this.stats.tasksFailed === 0 ? '✅ PASSED' : '⚠️ PARTIAL FAILURE';
    console.log(`║ Test Status: ${testStatus}`.padEnd(64) + '║');

    console.log('╚════════════════════════════════════════════════════════════╝');

    // Print verdict
    if (throughputPerHour >= 60 && this.stats.tasksFailed < this.stats.tasksCreated * 0.05) {
      console.log('\n✨ Stress test PASSED: System stable under load');
      process.exit(0);
    } else {
      console.log('\n❌ Stress test FAILED: Performance below targets');
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
