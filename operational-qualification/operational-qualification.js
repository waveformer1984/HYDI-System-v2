#!/usr/bin/env node

/**
 * Operational Qualification Harness
 * Main entry point for operational validation
 */

const StackOrchestrator = require('./orchestrator/stack-orchestrator');
const { WorkloadDriver, ConversationWorkload, MemoryStorageWorkload, MemoryRetrievalWorkload, SupervisorStatusWorkload, BridgeRequestWorkload, DatabaseOperationWorkload } = require('./workloads/workload-driver');
const MetricsCollector = require('./metrics/metrics-collector');
const { FailureInjector } = require('./failures/failure-injector');
const ReportGenerator = require('./reports/report-generator');
const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');
const v8 = require('v8');

// A deterministic secret is needed so the harness can sign x-hydi-service-token
// headers for authenticated routes (e.g. /api/chat/route). The generated value
// is exported to child processes (next-app) via process.env inheritance.
if (!process.env.HYDI_SERVICE_SECRET) {
  process.env.HYDI_SERVICE_SECRET = randomBytes(32).toString('hex');
  console.log('[Harness] Generated HYDI_SERVICE_SECRET for qualification');
}

class OperationalQualificationHarness {
  /**
   * @param {object} config  parsed qualification-config.json
   * @param {object} options `{ chaos, dryRun, supervised }`. `chaos` defaults
   *   to false: failure injection is destructive and must be requested
   *   explicitly via the --chaos CLI flag.
   */
  constructor(config, options = {}) {
    this.config = config;
    this.options = { chaos: false, dryRun: false, supervised: false, ...options };
    this.orchestrator = new StackOrchestrator(config);
    // Each collaborator receives its own config section. Passing the root
    // config made every `this.config.<key>` lookup undefined, so tuned
    // intervals and thresholds were silently replaced by hardcoded defaults.
    this.workloadDriver = new WorkloadDriver(config.workloads);
    this.metricsCollector = new MetricsCollector(config.metrics);
    this.failureInjector = new FailureInjector(config.failures, {
      enabled: this.options.chaos,
      dryRun: this.options.dryRun,
      supervised: this.options.supervised,
    });
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

      // Phases 2 and 3 run CONCURRENTLY. Running them in sequence (as an
      // earlier revision did) sampled metrics only after the load had stopped,
      // so the metrics described an idle system, and a "24 hour" run actually
      // took 48 hours.
      console.log('[Harness] Phases 2+3: Workload Execution with concurrent Metrics Collection');
      await this.runLoadedWindow(this.config.qualification.full.duration);

      // Phase 4: Failure Injection (no-op unless --chaos was passed)
      console.log('[Harness] Phase 4: Failure Injection');
      await this.runFailureInjection();

      // Phase 5: Stack shutdown — required to evidence graceful shutdown
      console.log('[Harness] Phase 5: Stack Shutdown');
      await this.runStackShutdown();

      // Phase 6: Report Generation
      console.log('[Harness] Phase 6: Report Generation');
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
      this.takeHeapSnapshot('startup');

      // Phases 2 and 3 run concurrently — see runFull for rationale.
      console.log('[Harness] Phases 2+3: Workload Execution with concurrent Metrics Collection');
      const quickDuration = this.config.qualification.quick.duration;
      const midpointTimer = setTimeout(() => this.takeHeapSnapshot('midpoint'), quickDuration / 2);
      await this.runLoadedWindow(quickDuration);
      clearTimeout(midpointTimer);
      this.takeHeapSnapshot('completion');

      // Phase 4: Stack shutdown
      console.log('[Harness] Phase 4: Stack Shutdown');
      await this.runStackShutdown();

      // Phase 5: Report Generation
      console.log('[Harness] Phase 5: Report Generation');
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
   * Capture a V8 heap snapshot for post-run retention analysis.
   */
  takeHeapSnapshot(label) {
    try {
      const dir = path.join(__dirname, '..', 'reports', 'qualification', 'snapshots');
      fs.mkdirSync(dir, { recursive: true });
      const filename = `${label}-${Date.now()}.heapsnapshot`;
      const filePath = path.join(dir, filename);
      const snapshotPath = v8.writeHeapSnapshot(filePath);
      console.log(`[HeapSnapshot] Captured ${label} snapshot: ${snapshotPath}`);
      return snapshotPath;
    } catch (error) {
      console.warn(`[HeapSnapshot] Failed to capture ${label}:`, error.message);
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
      case 'loaded-window':
        await this.runLoadedWindow(600000); // 10 minutes default
        break;
      case 'stack-shutdown':
        await this.runStackShutdown();
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
   * Stop the stack and record the shutdown outcome separately from startup.
   * The two must be distinct records: a single object cannot simultaneously
   * have status 'started' and 'stopped', so grading both from one value
   * guaranteed one criterion always failed.
   */
  async runStackShutdown() {
    try {
      const result = await this.orchestrator.stop();
      this.results.stackShutdown = result;
      return result;
    } catch (error) {
      this.results.stackShutdown = { status: 'failed', error: error.message };
      return this.results.stackShutdown;
    }
  }

  /** Drive workload and sample metrics over the same window. */
  async runLoadedWindow(duration) {
    this.metricsCollector.start();
    try {
      await this.runWorkloadExecution(duration);
    } finally {
      this.results.metrics = this.metricsCollector.stop();
    }
    return { workload: this.results.workloadExecution, metrics: this.results.metrics };
  }

  /**
   * Run workload execution phase
   */
  async runWorkloadExecution(duration) {
    // Workload keys are kebab-case in qualification-config.json and are used
    // verbatim as the registered workload name. Earlier revisions read
    // camelCase keys (config.memoryStorage), which are absent from the config
    // and threw a TypeError before any workload could run.
    const config = this.config.workloads;
    const registry = {
      'conversation': ConversationWorkload,
      'memory-storage': MemoryStorageWorkload,
      'memory-retrieval': MemoryRetrievalWorkload,
      'supervisor-status': SupervisorStatusWorkload,
      'bridge-request': BridgeRequestWorkload,
      'database-operation': DatabaseOperationWorkload,
    };

    for (const [name, Workload] of Object.entries(registry)) {
      const entry = config[name];
      if (!entry) {
        console.warn(`[Harness] Workload "${name}" has no config entry; skipping`);
        continue;
      }
      if (!entry.enabled) continue;
      this.workloadDriver.registerWorkload(name, new Workload(entry.endpoint));
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
    // Failure keys are kebab-case in qualification-config.json. Earlier
    // revisions read config.processCrash / config.networkInterruption, which
    // do not exist in the config and threw before injection could start.
    const config = this.config.failures || {};

    for (const [name, entry] of Object.entries(config)) {
      if (entry && entry.enabled) this.failureInjector.registerFailure(name);
    }

    if (!this.options.chaos) {
      console.log('[Harness] Failure injection requested but chaos is disabled; scenarios will be recorded as NOT TESTED.');
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
      chaosEnabled: this.options.chaos,
      chaosDryRun: this.options.dryRun,
      stackLifecycle: this.results.stackLifecycle,
      stackShutdown: this.results.stackShutdown,
      workloadExecution: this.results.workloadExecution,
      metrics: this.results.metrics,
      failureInjection: this.results.failureInjection
    };

    const report = this.reportGenerator.generateReport(reportData);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `${timestamp}-qual-${type}.json`;
    this.results.reportPath = this.reportGenerator.saveReport(report, filename);

    this.results.report = report;
    return report;
  }

  /**
   * Calculate total duration
   */
  calculateTotalDuration() {
    // Uptime is only known once the stack has been stopped; the startup result
    // never carries it, which is why this previously always returned 0.
    if (this.results.stackShutdown && this.results.stackShutdown.uptimeMs) {
      return this.results.stackShutdown.uptimeMs;
    }
    if (this.results.stackLifecycle && this.results.stackLifecycle.startTime) {
      return Date.now() - this.results.stackLifecycle.startTime;
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
  const positional = args.filter((a) => !a.startsWith('--'));
  const command = positional[0];
  const phase = positional[1];

  // Chaos is opt-in. Neither `full` nor the failures.*.enabled config keys
  // enable destructive injection on their own.
  const options = {
    chaos: args.includes('--chaos'),
    dryRun: args.includes('--dry-run'),
    supervised: args.includes('--supervised'),
  };

  // Load configuration
  const configPath = path.join(__dirname, 'config', 'qualification-config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  if (options.chaos) {
    console.warn('[Harness] --chaos supplied: this run performs REAL failure injection against live services.');
  } else {
    console.log('[Harness] Chaos disabled (default). Resilience scenarios will be reported as NOT TESTED.');
  }

  const harness = new OperationalQualificationHarness(config, options);

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
        console.error([
          'Usage: node operational-qualification.js <full|quick|phase <phase-name>> [options]',
          '',
          'Options:',
          '  --chaos       Enable REAL destructive failure injection (disabled by default)',
          '  --dry-run     With --chaos, report what would be injected without injecting',
          '  --supervised  Let the supervisor perform recovery instead of the harness',
          '',
          'Phases: stack-lifecycle, workload-execution, metrics-collection,',
          '        loaded-window, failure-injection, stack-shutdown, report-generation',
        ].join('\n'));
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
