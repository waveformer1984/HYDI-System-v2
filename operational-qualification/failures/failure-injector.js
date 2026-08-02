/**
 * Failure Injector
 * ================
 *
 * Injects REAL, controlled failures to validate system resilience.
 *
 * HISTORY / WHY THIS IS WRITTEN THIS WAY:
 * The original implementation of this module defined four "failure scenarios"
 * (database, Redis, process crash, network interruption) whose `inject()` was
 * a `setTimeout`, whose `waitForRecovery()` was a `setTimeout` returning
 * `true`, and whose `validateDataIntegrity()` was `return true`. Nothing was
 * ever terminated, restarted, or checked. Because report-generator.js grades
 * "All failure scenarios recover" and "Data integrity maintained" directly
 * from those return values, the harness would have certified resilience it
 * never exercised. Simulated logging is not failure injection and must never
 * be reported as such.
 *
 * The scenarios are now delegated to scripts/lib/soak-chaos.js, which
 * terminates real processes and restarts real containers, and which reports
 * `skipped` (never `passed`) when a fault could not be applied.
 *
 * SAFETY: injection is destructive. It is gated by an explicit `--chaos` flag
 * on the harness CLI; the `failures.*.enabled` config keys alone do not enable
 * it.
 */

const { buildScenarios } = require('../../scripts/lib/soak-chaos');

/** Maps qualification-config failure keys to chaos scenario names. */
const SCENARIO_MAP = {
  'database': 'restart-postgres',
  'redis': 'restart-redis',
  'process-crash': 'restart-next',
  'network-interruption': 'delayed-postgres-startup',
  'bridge': 'kill-bridge',
  'protohub': 'restart-protohub',
  'supervisor': 'restart-core',
};

class FailureInjector {
  /**
   * @param {object} config  the `failures` section of qualification-config.json
   * @param {object} options `{ enabled, dryRun, supervised }` — `enabled`
   *   must be true (set only by the --chaos CLI flag) or nothing is injected.
   */
  constructor(config, options = {}) {
    this.config = config || {};
    this.enabled = options.enabled === true;
    this.dryRun = options.dryRun === true;
    this.supervised = options.supervised === true;
    this.failures = new Map();
    this.results = [];
    this.scenarioIndex = new Map(buildScenarios().map((s) => [s.name, s]));
  }

  /**
   * Register a failure scenario by its qualification-config key.
   * Unknown keys are recorded as unsupported rather than silently ignored.
   */
  registerFailure(name) {
    const scenarioName = SCENARIO_MAP[name];
    const scenario = scenarioName ? this.scenarioIndex.get(scenarioName) : null;
    this.failures.set(name, { scenarioName, scenario });
  }

  /**
   * Execute all registered failure scenarios.
   * Returns one fully attributed result per scenario.
   */
  async executeAll() {
    if (!this.enabled) {
      console.log('[FailureInjector] Chaos disabled — no failures injected (this is the default).');
      return this.failures.size === 0 ? [] : [...this.failures.keys()].map((name) => ({
        failure: name,
        timestamp: Date.now(),
        status: 'skipped',
        executed: false,
        reason: 'chaos mode not enabled; run the harness with --chaos to inject this fault',
        recoveryTime: null,
        dataIntegrity: null,
      }));
    }

    console.log('[FailureInjector] Executing failure scenarios (REAL injection)...');

    for (const [name, entry] of this.failures) {
      this.results.push(await this.executeFailure(name, entry));
    }

    console.log('[FailureInjector] Failure scenarios completed');
    return this.results;
  }

  async executeFailure(name, entry) {
    const base = { failure: name, timestamp: Date.now() };

    if (!entry.scenario) {
      return {
        ...base,
        status: 'skipped',
        executed: false,
        reason: `no real implementation is available for failure "${name}"`,
        recoveryTime: null,
        dataIntegrity: null,
      };
    }

    if (this.dryRun) {
      return {
        ...base,
        status: 'skipped',
        executed: false,
        reason: `dry run: would have run scenario "${entry.scenarioName}"`,
        recoveryTime: null,
        dataIntegrity: null,
      };
    }

    console.log(`[FailureInjector] Executing failure scenario: ${name} -> ${entry.scenarioName}`);

    let outcome;
    try {
      outcome = await entry.scenario.run({ supervised: this.supervised });
    } catch (error) {
      outcome = {
        status: 'failed',
        injectedFault: entry.scenario.description,
        observedBehaviour: `scenario threw: ${error.message}`,
        recoveryMs: null,
      };
    }

    return {
      ...base,
      scenario: entry.scenarioName,
      status: outcome.status,
      executed: outcome.status !== 'skipped',
      reason: outcome.reason || null,
      injectedAt: outcome.injectedAt || null,
      injectedFault: outcome.injectedFault || null,
      observedBehaviour: outcome.observedBehaviour || null,
      recoveryTime: outcome.recoveryMs ?? null,
      recoveredBy: outcome.recoveredBy || null,
      // Data integrity is NOT asserted here. Verifying it requires comparing
      // durable state before and after the fault, which this harness does not
      // do. Reporting `null` keeps it out of the pass tally rather than
      // fabricating a `true`.
      dataIntegrity: null,
      dataIntegrityNote: 'not verified: harness does not snapshot or diff durable state',
    };
  }

  getResults() {
    return this.results;
  }

  /**
   * Statistics over executed scenarios only. Skipped scenarios are counted
   * separately and never contribute to a success rate, so a run in which
   * nothing could be injected does not read as 100% success.
   */
  getStatistics() {
    const stats = {};

    for (const name of this.failures.keys()) {
      const all = this.results.filter((r) => r.failure === name);
      const executed = all.filter((r) => r.executed);
      const passed = executed.filter((r) => r.status === 'passed');
      const recoveries = passed
        .map((r) => r.recoveryTime)
        .filter((v) => typeof v === 'number');

      stats[name] = {
        total: all.length,
        executed: executed.length,
        skipped: all.length - executed.length,
        passed: passed.length,
        failed: executed.length - passed.length,
        successRate: executed.length > 0 ? passed.length / executed.length : null,
        avgRecoveryTime: recoveries.length > 0
          ? recoveries.reduce((s, v) => s + v, 0) / recoveries.length
          : null,
        dataIntegrityRate: null,
      };
    }

    return stats;
  }
}

module.exports = { FailureInjector, SCENARIO_MAP };
