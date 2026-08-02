#!/usr/bin/env node

/**
 * Operational Qualification Harness
 * Main entry point for operational validation
 */

const StackOrchestrator = require('./orchestrator/stack-orchestrator');
const { WorkloadDriver, ConversationWorkload, MemoryStorageWorkload, MemoryRetrievalWorkload, SupervisorStatusWorkload, BridgeRequestWorkload, DatabaseOperationWorkload } = require('./workloads/workload-driver');
const MetricsCollector = require('./metrics/metrics-collector');
const { FailureInjector, DatabaseFailureScenario, RedisFailureScenario, ProcessCrashScenario, NetworkInterruptionScenario } = require('./failures/failure-injector');
const ReportGenerator = require('./reports/report-generator');
const fs = require('fs');
const path = require('path');

class OperationalQualificationHarness {
  constructor(config) {
    this.config = config;
    this.orchestrator = new StackOrchestrator(config);
    this.workloadDriver = new WorkloadDriver(config);
    this.metricsCollector = new MetricsCollector(config);
    this.failureInjector = new FailureInjector(config);
    this.reportGenerator = new ReportGenerator(config);
    this.results = {};
  }

  /**
   * Run full qualification
   */
  async runFull() {
    console.log('[Harness] Starting full operational qualification...');
    const startTime = Date.now();

    try {
      // Phase 1: Stack Lifecycle
      console.log('[Harness] Phase 1: Stack Lifecycle');
      await this.runStackLifecycle();

      // Phase 2: Workload Execution
      console.log('[Harness] Phase 2: Workload Execution');
      await this.runWorkloadExecution(this.config.qualification.full.duration);

      // Phase 3: Metrics Collection
      console.log('[Harness] Phase 3: Metrics Collection');
      await this.runMetricsCollection(this.config.qualification.full.duration);

      // Phase 4: Failure Injection
      console.log('[Harness] Phase 4: Failure Injection');
      await this.runFailureInjection();

      // Phase 5: Report Generation
      console.log('[Harness] Phase 5: Report Generation');
      await this.generateReport('full');

      const duration = Date.now() - startTime;
      console.log(`[Harness] Full qualification completed in ${duration}ms`);

      return { status: 'completed', duration, results: this.results };
    } catch (error) {
      console.error('[Harness] Full qualification failed:', error);
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Run quick qualification
   */
  async runQuick() {
    console.log('[Harness] Starting quick operational qualification...');
    const startTime = Date.now();

    try {
      // Phase 1: Stack Lifecycle
      console.log('[Harness] Phase 1: Stack Lifecycle');
      await this.runStackLifecycle();

      // Phase 2: Workload Execution
      console.log('[Harness] Phase 2: Workload Execution');
      await this.runWorkloadExecution(this.config.qualification.quick.duration);

      // Phase 3: Metrics Collection
      console.log('[Harness] Phase 3: Metrics Collection');
      await this.runMetricsCollection(this.config.qualification.quick.duration);

      // Phase 4: Report Generation
      console.log('[Harness] Phase 4: Report Generation');
      await this.generateReport('quick');

      const duration = Date.now() - startTime;
      console.log(`[Harness] Quick qualification completed in ${duration}ms`);

      return { status: 'completed', duration, results: this.results };
    } catch (error) {
      console.error('[Harness] Quick qualification failed:', error);
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Run specific phase
   */
  async runPhase(phaseName) {
    console.log(`[Harness] Running phase: ${phaseName}`);

    switch (phaseName) {
      case 'stack-lifecycle':
        await this.runStackLifecycle();
        break;
      case 'workload-execution':
        await this.runWorkloadExecution(600000); // 10 minutes default
        break;
      case 'metrics-collection':
        await this.runMetricsCollection(600000); // 10 minutes default
        break;
      case 'failure-injection':
        await this.runFailureInjection();
        break;
      case 'report-generation':
        await this.generateReport('phase');
        break;
      default:
        throw new Error(`Unknown phase: ${phaseName}`);
    }

    console.log(`[Harness] Phase completed: ${phaseName}`);
    return this.results[phaseName];
  }

  /**
   * Run stack lifecycle phase
   */
  async runStackLifecycle() {
    const result = await this.orchestrator.start();
    this.results.stackLifecycle = result;
    return result;
  }

  /**
   * Run workload execution phase
   */
  async runWorkloadExecution(duration) {
    // Register workloads
    const config = this.config.workloads;
    
    if (config.conversation.enabled) {
      this.workloadDriver.registerWorkload('conversation', new ConversationWorkload(config.conversation.endpoint));
    }
    if (config.memoryStorage.enabled) {
      this.workloadDriver.registerWorkload('memory-storage', new MemoryStorageWorkload(config.memoryStorage.endpoint));
    }
    if (config.memoryRetrieval.enabled) {
      this.workloadDriver.registerWorkload('memory-retrieval', new MemoryRetrievalWorkload(config.memoryRetrieval.endpoint));
    }
    if (config.supervisorStatus.enabled) {
      this.workloadDriver.registerWorkload('supervisor-status', new SupervisorStatusWorkload(config.supervisorStatus.endpoint));
    }
    if (config.bridgeRequest.enabled) {
      this.workloadDriver.registerWorkload('bridge-request', new BridgeRequestWorkload(config.bridgeRequest.endpoint));
    }
    if (config.databaseOperation.enabled) {
      this.workloadDriver.registerWorkload('database-operation', new DatabaseOperationWorkload(config.databaseOperation.endpoint));
    }

    const result = await this.workloadDriver.executeAll(duration);
    this.results.workloadExecution = result;
    return result;
  }

  /**
   * Run metrics collection phase
   */
  async runMetricsCollection(duration) {
    this.metricsCollector.start();

    // Wait for duration
    await new Promise(resolve => setTimeout(resolve, duration));

    const result = this.metricsCollector.stop();
    this.results.metrics = result;
    return result;
  }

  /**
   * Run failure injection phase
   */
  async runFailureInjection() {
    // Register failure scenarios
    const config = this.config.failures;
    
    if (config.database.enabled) {
      this.failureInjector.registerFailure('database', new DatabaseFailureScenario({}));
    }
    if (config.redis.enabled) {
      this.failureInjector.registerFailure('redis', new RedisFailureScenario({}));
    }
    if (config.processCrash.enabled) {
      this.failureInjector.registerFailure('process-crash', new ProcessCrashScenario('hydi-core'));
    }
    if (config.networkInterruption.enabled) {
      this.failureInjector.registerFailure('network-interruption', new NetworkInterruptionScenario({}));
    }

    const result = await this.failureInjector.executeAll();
    this.results.failureInjection = result;
    return result;
  }

  /**
   * Generate report
   */
  async generateReport(type) {
    const reportData = {
      qualificationType: type,
      duration: this.calculateTotalDuration(),
      stackLifecycle: this.results.stackLifecycle,
      workloadExecution: this.results.workloadExecution,
      metrics: this.results.metrics,
      failureInjection: this.results.failureInjection
    };

    const report = this.reportGenerator.generateReport(reportData);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `${timestamp}-qual-${type}.json`;
    const reportPath = this.reportGenerator.saveReport(report, filename);

    this.results.report = report;
    return report;
  }

  /**
   * Calculate total duration
   */
  calculateTotalDuration() {
    if (this.results.stackLifecycle && this.results.stackLifecycle.uptimeMs) {
      return this.results.stackLifecycle.uptimeMs;
    }
    return 0;
  }

  /**
   * Cleanup
   */
  async cleanup() {
    console.log('[Harness] Cleaning up...');
    
    try {
      await this.orchestrator.stop();
    } catch (error) {
      console.error('[Harness] Error during cleanup:', error);
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const phase = args[1];

  // Load configuration
  const configPath = path.join(__dirname, 'config', 'qualification-config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const harness = new OperationalQualificationHarness(config);

  try {
    switch (command) {
      case 'full':
        await harness.runFull();
        break;
      case 'quick':
        await harness.runQuick();
        break;
      case 'phase':
        if (!phase) {
          console.error('Error: phase name required');
          process.exit(1);
        }
        await harness.runPhase(phase);
        break;
      default:
        console.error('Usage: node operational-qualification.js [full|quick|phase <phase-name>]');
        process.exit(1);
    }

    console.log('[Harness] Qualification completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('[Harness] Qualification failed:', error);
    await harness.cleanup();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = OperationalQualificationHarness;
