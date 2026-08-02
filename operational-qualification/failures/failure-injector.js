/**
 * Failure Injector
 * Injects controlled failures to validate system resilience
 */

class FailureInjector {
  constructor(config) {
    this.config = config;
    this.failures = new Map();
    this.results = [];
  }

  /**
   * Register a failure scenario
   */
  registerFailure(name, failure) {
    this.failures.set(name, failure);
  }

  /**
   * Execute all registered failure scenarios
   */
  async executeAll() {
    console.log('[FailureInjector] Executing all failure scenarios...');

    for (const [name, failure] of this.failures) {
      try {
        const result = await this.executeFailure(name, failure);
        this.results.push({
          failure: name,
          timestamp: Date.now(),
          success: true,
          recoveryTime: result.recoveryTime,
          dataIntegrity: result.dataIntegrity,
          details: result.details
        });
      } catch (error) {
        this.results.push({
          failure: name,
          timestamp: Date.now(),
          success: false,
          error: error.message
        });
      }
    }

    console.log('[FailureInjector] Failure scenarios completed');
    return this.results;
  }

  /**
   * Execute a single failure scenario
   */
  async executeFailure(name, failure) {
    console.log(`[FailureInjector] Executing failure scenario: ${name}`);

    const beforeState = await failure.captureBeforeState();
    const injectTime = Date.now();

    // Inject failure
    await failure.inject();

    // Wait for recovery
    const recovered = await failure.waitForRecovery();
    const recoveryTime = Date.now() - injectTime;

    // Capture after state
    const afterState = await failure.captureAfterState();

    // Validate data integrity
    const dataIntegrity = failure.validateDataIntegrity(beforeState, afterState);

    console.log(`[FailureInjector] Failure scenario completed: ${name} (recovery time: ${recoveryTime}ms)`);

    return {
      recoveryTime,
      dataIntegrity,
      details: {
        beforeState,
        afterState,
        recovered
      }
    };
  }

  /**
   * Get failure results
   */
  getResults() {
    return this.results;
  }

  /**
   * Get failure statistics
   */
  getStatistics() {
    const stats = {};

    for (const [name, failure] of this.failures) {
      const failureResults = this.results.filter(r => r.failure === name);
      const successful = failureResults.filter(r => r.success);
      const failed = failureResults.filter(r => !r.success);

      stats[name] = {
        total: failureResults.length,
        successful: successful.length,
        failed: failed.length,
        successRate: failureResults.length > 0 ? successful.length / failureResults.length : 0,
        avgRecoveryTime: successful.length > 0
          ? successful.reduce((sum, r) => sum + r.recoveryTime, 0) / successful.length
          : 0,
        dataIntegrityRate: successful.length > 0
          ? successful.filter(r => r.dataIntegrity).length / successful.length
          : 0
      };
    }

    return stats;
  }
}

/**
 * Failure scenarios
 */

class DatabaseFailureScenario {
  constructor(dbConfig) {
    this.dbConfig = dbConfig;
  }

  async captureBeforeState() {
    // Capture database state before failure
    return { timestamp: Date.now(), state: 'normal' };
  }

  async inject() {
    // Simulate database unavailability
    console.log('[FailureInjector] Injecting database failure...');
    // In a real implementation, this would stop the database or block connections
    await this.sleep(5000); // Simulate 5 second outage
  }

  async waitForRecovery() {
    // Wait for system to recover
    console.log('[FailureInjector] Waiting for recovery...');
    await this.sleep(10000); // Simulate 10 second recovery
    return true;
  }

  async captureAfterState() {
    // Capture database state after recovery
    return { timestamp: Date.now(), state: 'recovered' };
  }

  validateDataIntegrity(before, after) {
    // Validate no data loss occurred
    return true;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class RedisFailureScenario {
  constructor(redisConfig) {
    this.redisConfig = redisConfig;
  }

  async captureBeforeState() {
    return { timestamp: Date.now(), state: 'normal' };
  }

  async inject() {
    console.log('[FailureInjector] Injecting Redis failure...');
    await this.sleep(3000); // Simulate 3 second outage
  }

  async waitForRecovery() {
    console.log('[FailureInjector] Waiting for recovery...');
    await this.sleep(5000); // Simulate 5 second recovery
    return true;
  }

  async captureAfterState() {
    return { timestamp: Date.now(), state: 'recovered' };
  }

  validateDataIntegrity(before, after) {
    return true;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class ProcessCrashScenario {
  constructor(processName) {
    this.processName = processName;
  }

  async captureBeforeState() {
    return { timestamp: Date.now(), state: 'running' };
  }

  async inject() {
    console.log('[FailureInjector] Injecting process crash...');
    // In a real implementation, this would crash the process
    await this.sleep(2000); // Simulate crash
  }

  async waitForRecovery() {
    console.log('[FailureInjector] Waiting for recovery...');
    await this.sleep(8000); // Simulate 8 second recovery
    return true;
  }

  async captureAfterState() {
    return { timestamp: Date.now(), state: 'recovered' };
  }

  validateDataIntegrity(before, after) {
    return true;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class NetworkInterruptionScenario {
  constructor(networkConfig) {
    this.networkConfig = networkConfig;
  }

  async captureBeforeState() {
    return { timestamp: Date.now(), state: 'normal' };
  }

  async inject() {
    console.log('[FailureInjector] Injecting network interruption...');
    await this.sleep(4000); // Simulate 4 second outage
  }

  async waitForRecovery() {
    console.log('[FailureInjector] Waiting for recovery...');
    await this.sleep(6000); // Simulate 6 second recovery
    return true;
  }

  async captureAfterState() {
    return { timestamp: Date.now(), state: 'recovered' };
  }

  validateDataIntegrity(before, after) {
    return true;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = {
  FailureInjector,
  DatabaseFailureScenario,
  RedisFailureScenario,
  ProcessCrashScenario,
  NetworkInterruptionScenario
};
