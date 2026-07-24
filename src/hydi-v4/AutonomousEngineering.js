'use strict';

const RepositoryAuditor = require('./RepositoryAuditor');

/**
 * AutonomousEngineering turns repository analysis into actionable, safe
 * improvements. It discovers technical debt, proposes refactors, generates
 * missing tests, and produces implementation plans.
 */
class AutonomousEngineering {
  constructor(kernel, options = {}) {
    this.kernel = kernel;
    this.auditor = new RepositoryAuditor(kernel, options.auditor);
    this.config = {
      maxRecommendations: options.maxRecommendations || 20,
      ...options,
    };
  }

  async auditRepository() {
    const scan = await this.auditor.scan();
    const deadCode = this.auditor.findDeadCode();
    const duplicates = this.auditor.findDuplicateLogic();
    const cycles = this.auditor.findCircularImports();
    const timers = this.auditor.findTimerLeaks();
    const resources = this.auditor.findResourceLeaks();

    const recommendations = [];

    if (cycles.length > 0) {
      recommendations.push({
        type: 'architectural_drift',
        priority: 'high',
        reason: `${cycles.length} circular import(s) detected`,
        plan: 'Refactor shared dependencies into a common dependency module.',
        files: cycles,
      });
    }

    if (timers.length > 0) {
      recommendations.push({
        type: 'resource_leak',
        priority: 'high',
        reason: `${timers.length} file(s) with timer imbalance`,
        plan: 'Ensure every setInterval/setTimeout has a matching clear and .unref() where appropriate.',
        files: timers.map((t) => t.file),
      });
    }

    if (duplicates.length > 0) {
      recommendations.push({
        type: 'duplicate_logic',
        priority: 'medium',
        reason: `${duplicates.length} duplicate code block(s) found`,
        plan: 'Extract common blocks into shared utility functions.',
        samples: duplicates.slice(0, 3),
      });
    }

    if (deadCode.length > 0) {
      recommendations.push({
        type: 'dead_code',
        priority: 'low',
        reason: `${deadCode.length} potentially unused export(s)`,
        plan: 'Verify and remove or consolidate unused exports.',
        files: deadCode.map((d) => d.file),
      });
    }

    if (resources.length > 0) {
      recommendations.push({
        type: 'blocking_operation',
        priority: 'medium',
        reason: `${resources.length} child_process usage(s) detected`,
        plan: 'Wrap external process calls with timeouts, cancellation, and resource cleanup.',
        files: resources.map((r) => r.file),
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      summary: scan.summary,
      issueCounts: {
        deadCode: deadCode.length,
        duplicateLogic: duplicates.length,
        circularImports: cycles.length,
        timerLeaks: timers.length,
        resourceLeaks: resources.length,
      },
      recommendations: recommendations.slice(0, this.config.maxRecommendations),
      raw: { deadCode, duplicates: duplicates.slice(0, 10), cycles, timers, resources },
    };
  }

  generateTestSkeleton(moduleId) {
    const mod = this.kernel.moduleRegistry.get(moduleId);
    if (!mod) return { error: `module not found: ${moduleId}` };
    const caps = mod.manifest.capabilities || [];
    const tests = [
      `test('${moduleId} initializes', async () => {`,
      `  const m = kernel.moduleRegistry.get('${moduleId}');`,
      `  await m.initialize();`,
      `  expect(m._initialized).toBe(true);`,
      `});`,
      `test('${moduleId} starts and stops', async () => {`,
      `  await kernel.startModule('${moduleId}');`,
      `  await kernel.stopModule('${moduleId}');`,
      `  expect(kernel.moduleRegistry.get('${moduleId}')._started).toBe(false);`,
      `});`,
    ];
    for (const cap of caps) {
      tests.push(`test('${moduleId} provides ${cap}', async () => {`);
      tests.push(`  const result = await kernel.requestCapability('${cap}', { test: true });`);
      tests.push(`  expect(result).toBeDefined();`);
      tests.push(`});`);
    }
    return { moduleId, tests };
  }

  async generateRepairPlan(moduleId) {
    const health = await this.kernel.healthMonitor.check();
    const mod = this.kernel.moduleRegistry.get(moduleId);
    const plan = {
      moduleId,
      healthy: mod ? (await mod.health()).healthy : false,
      steps: [
        `Run kernel.stopModule('${moduleId}')`,
        `Inspect module health: ${JSON.stringify(health.modules[moduleId] || {})}`,
        `Apply minimal upstream fix`,
        `Run kernel.startModule('${moduleId}')`,
        `Verify with kernel.healthMonitor.check()`,
      ],
    };
    return plan;
  }

  async detectDrift() {
    const audit = await this.auditRepository();
    const drift = audit.recommendations.filter((r) => r.type === 'architectural_drift');
    return { driftDetected: drift.length > 0, items: drift };
  }
}

module.exports = AutonomousEngineering;
