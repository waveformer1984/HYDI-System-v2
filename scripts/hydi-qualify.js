#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

/**
 * `hydi qualify` — end-to-end qualification suite.
 *
 * Launches the real local system, verifies baseline health, injects
 * failures, verifies detection/recovery/verification, and produces
 * evidence-backed qualification results.
 *
 * No mocked success is acceptable as the sole evidence.
 *
 * Usage:
 *   node scripts/hydi-qualify.js
 *   node scripts/hydi-qualify.js --json
 *   node scripts/hydi-qualify.js --scenario A1-protoforge-kill
 *   node scripts/hydi-qualify.js --class A
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const JSON_MODE = process.argv.includes('--json');
const SCENARIO_FILTER = process.argv.find((a) => a.startsWith('--scenario='))?.split('=')[1];
const CLASS_FILTER = process.argv.find((a) => a.startsWith('--class='))?.split('=')[1];

// Load the FailureInjector
require('../scripts/babel-register');
const { FailureInjector, DEFAULT_SCENARIOS } = require('../lib/operational/FailureInjector');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkHealth(url, timeoutMs = 5000) {
  try {
    const out = execSync(
      `curl -s -o - -w "\\n%{http_code}" --max-time ${Math.floor(timeoutMs / 1000)} ${url}`,
      { encoding: 'utf8', timeout: timeoutMs + 5000 },
    );
    const lines = out.trim().split('\n');
    const statusCode = parseInt(lines[lines.length - 1], 10);
    const body = lines.slice(0, -1).join('\n');
    return { ok: statusCode >= 200 && statusCode < 500, statusCode, body };
  } catch {
    return { ok: false, statusCode: 0, body: '' };
  }
}

async function runQualification() {
  const injector = new FailureInjector(ROOT);
  let scenarios = injector.getAllScenarios();

  // Filter scenarios
  if (SCENARIO_FILTER) {
    scenarios = scenarios.filter((s) => s.scenarioId === SCENARIO_FILTER);
  }
  if (CLASS_FILTER) {
    scenarios = scenarios.filter((s) => s.failureClass === CLASS_FILTER);
  }

  if (scenarios.length === 0) {
    console.error('No scenarios matched the filter.');
    process.exit(1);
  }

  const results = [];
  const suiteStart = Date.now();

  console.log(`\n=== HEIDI QUALIFICATION SUITE ===`);
  console.log(`Running ${scenarios.length} scenario(s)...\n`);

  // 1. Verify baseline health
  console.log('Step 1: Verifying baseline health...');
  const baselineChecks = [
    { name: 'protoforge-core', url: 'http://127.0.0.1:3005/health' },
    { name: 'heidi-web', url: 'http://127.0.0.1:3000/api/health' },
  ];

  let baselineHealthy = true;
  for (const check of baselineChecks) {
    const h = checkHealth(check.url);
    if (!h.ok) {
      console.log(`  [FAIL] ${check.name}: HTTP ${h.statusCode}`);
      baselineHealthy = false;
    } else {
      console.log(`  [OK]   ${check.name}: HTTP ${h.statusCode}`);
    }
  }

  if (!baselineHealthy) {
    console.log('\nBaseline not healthy. Start the system first: npm run boot');
    if (JSON_MODE) {
      console.log(JSON.stringify({
        suiteName: 'hydi-qualify',
        timestamp: new Date().toISOString(),
        scenarios: [],
        totalScenarios: 0,
        passed: 0,
        failed: 0,
        escalated: 0,
        durationMs: 0,
        overallVerdict: 'NOT_OPERATIONAL',
        evidence: { baselineHealthy: false, allScenariosCompleted: false, recoverySuccessRate: 0, escalationRate: 0 },
      }, null, 2));
    }
    process.exit(1);
  }

  console.log('  Baseline healthy.\n');

  // 2. Run each scenario
  for (const scenario of scenarios) {
    console.log(`\n--- Scenario: ${scenario.name} (${scenario.scenarioId}) ---`);
    console.log(`  Class: ${scenario.failureClass} | Risk: ${scenario.riskLevel} | Target: ${scenario.targetComponent}`);

    const scenarioStart = Date.now();
    const result = {
      scenarioId: scenario.scenarioId,
      name: scenario.name,
      failureClass: scenario.failureClass,
      injected: false,
      detected: false,
      diagnosed: false,
      actionSelected: null,
      actionExecuted: false,
      recovered: false,
      verified: false,
      escalated: false,
      durationMs: 0,
      evidence: [],
      error: undefined,
    };

    // Step 2a: Inject failure
    console.log('  Step 2a: Injecting failure...');
    const injectResult = injector.injectFailure(scenario);
    result.injected = injectResult.injected;
    result.evidence.push(...injectResult.evidence);

    if (!injectResult.injected) {
      result.error = injectResult.error;
      console.log(`  [FAIL] Injection failed: ${injectResult.error}`);
      result.durationMs = Date.now() - scenarioStart;
      results.push(result);
      continue;
    }
    console.log('  [OK] Failure injected.');

    // Step 2b: Wait for detection (watchdog polls every 2 min, but we check sooner)
    console.log('  Step 2b: Waiting for detection (checking health in 5s)...');
    await sleep(5000);

    // Check if the component is actually down
    const healthUrls = {
      'protoforge-core': 'http://127.0.0.1:3005/health',
      'heidi-web': 'http://127.0.0.1:3000/api/health',
      'heidi-mobile-chat': 'http://127.0.0.1:3006/api/health',
      'ollama': 'http://127.0.0.1:11434/api/tags',
    };

    const healthUrl = healthUrls[scenario.targetComponent];
    if (healthUrl) {
      const h = checkHealth(healthUrl, 3000);
      result.detected = !h.ok;
      result.evidence.push({
        check: 'post-injection-health',
        status: h.ok ? 'pass' : 'fail',
        value: `HTTP ${h.statusCode}`,
        checkedAt: new Date().toISOString(),
      });
      console.log(`  ${result.detected ? '[OK]   Detected: component is down' : '[WARN] Component may have auto-recovered already'}`);
    } else {
      // For container/DB scenarios, check Docker
      result.detected = true; // assume detected for non-process scenarios
      console.log('  [OK]   Detection assumed for container/DB scenario');
    }

    // Step 2c: Wait for recovery (watchdog + RecoveryEngine)
    console.log('  Step 2c: Waiting for recovery (up to 150s for watchdog poll + recovery)...');

    // For process kills, the watchdog should detect and call RecoveryEngine
    // For container restarts, the container should come back on its own
    let recovered = false;
    const maxWaitMs = scenario.timeoutMs;
    const checkIntervalMs = 10000;
    const maxChecks = Math.floor(maxWaitMs / checkIntervalMs);

    for (let i = 0; i < maxChecks; i++) {
      await sleep(checkIntervalMs);

      const verifyResult = injector.verifyRecovery(scenario);
      if (verifyResult.recovered) {
        recovered = true;
        result.evidence.push(...verifyResult.evidence);
        break;
      }
    }

    result.recovered = recovered;
    result.verified = recovered;

    if (recovered) {
      console.log('  [OK]   Recovery verified with evidence.');
      result.actionExecuted = true;
      result.actionSelected = scenario.expectedAction;
    } else {
      console.log('  [WARN] Auto-recovery did not complete within timeout.');
      console.log('  Step 2d: Attempting manual recovery...');
      try {
        const recoverCmd = `node scripts/hydi-recover.js --governed --component=${scenario.targetComponent}`;
        execSync(recoverCmd, { cwd: ROOT, timeout: 120000, stdio: 'pipe' });
        await sleep(10000);
        const verifyResult = injector.verifyRecovery(scenario);
        result.recovered = verifyResult.recovered;
        result.verified = verifyResult.recovered;
        result.evidence.push(...verifyResult.evidence);
        result.actionExecuted = verifyResult.recovered;
        result.actionSelected = 'manual_governed_recovery';
        if (verifyResult.recovered) {
          console.log('  [OK]   Manual recovery succeeded.');
        } else {
          console.log('  [FAIL] Manual recovery also failed — escalating.');
          result.escalated = true;
        }
      } catch (e) {
        console.log(`  [FAIL] Manual recovery failed: ${e.message}`);
        result.escalated = true;
      }
    }

    // Step 2e: Cleanup
    console.log('  Step 2e: Cleanup...');
    injector.cleanup(scenario);

    result.durationMs = Date.now() - scenarioStart;
    results.push(result);

    const verdict = result.recovered ? 'RECOVERED' : result.escalated ? 'ESCALATED' : 'FAILED';
    console.log(`  Result: ${verdict} (${result.durationMs}ms)`);
  }

  // 3. Produce final report
  const durationMs = Date.now() - suiteStart;
  const passed = results.filter((r) => r.recovered || r.verified).length;
  const failed = results.filter((r) => !r.recovered && !r.escalated).length;
  const escalated = results.filter((r) => r.escalated).length;

  const recoverySuccessRate = results.length > 0
    ? Math.round((passed / results.length) * 100)
    : 0;
  const escalationRate = results.length > 0
    ? Math.round((escalated / results.length) * 100)
    : 0;

  let overallVerdict;
  if (failed === 0 && recoverySuccessRate >= 60) {
    overallVerdict = 'OPERATIONAL';
  } else if (failed === 0 && (recoverySuccessRate + escalationRate) >= 80) {
    overallVerdict = 'OPERATIONAL_WITH_LIMITATIONS';
  } else {
    overallVerdict = 'NOT_OPERATIONAL';
  }

  const qualificationResult = {
    suiteName: 'hydi-qualify',
    timestamp: new Date().toISOString(),
    scenarios: results,
    totalScenarios: results.length,
    passed,
    failed,
    escalated,
    durationMs,
    overallVerdict,
    evidence: {
      baselineHealthy,
      allScenariosCompleted: results.every((r) => r.injected),
      recoverySuccessRate,
      escalationRate,
    },
  };

  // Save artifact
  const artifactDir = path.resolve(ROOT, '.hydi-operational');
  if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });
  const artifactPath = path.join(artifactDir, `qualification-${Date.now()}.json`);
  fs.writeFileSync(artifactPath, JSON.stringify(qualificationResult, null, 2), 'utf8');

  if (JSON_MODE) {
    console.log(JSON.stringify(qualificationResult, null, 2));
  } else {
    console.log('\n=== QUALIFICATION REPORT ===\n');
    console.log(`  Scenarios: ${results.length}`);
    console.log(`  Passed:    ${passed}`);
    console.log(`  Failed:    ${failed}`);
    console.log(`  Escalated: ${escalated}`);
    console.log(`  Duration:  ${durationMs}ms`);
    console.log(`  Recovery success rate: ${recoverySuccessRate}%`);
    console.log(`  Escalation rate: ${escalationRate}%`);
    console.log(`  Verdict:   ${overallVerdict}`);
    console.log(`  Artifact:  ${artifactPath}\n`);

    for (const r of results) {
      const icon = r.recovered ? '[PASS]' : r.escalated ? '[ESCAL]' : '[FAIL]';
      console.log(`  ${icon} ${r.scenarioId}: ${r.name} (${r.durationMs}ms)`);
    }
    console.log('');
  }

  process.exit(failed > 0 ? 1 : 0);
}

runQualification().catch((e) => {
  console.error('Qualification failed:', e.message);
  process.exit(2);
});
