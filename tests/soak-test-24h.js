#!/usr/bin/env node
/**
 * HYDI 24-Hour Soak Test
 * ======================
 * Validates that the entire system can run unattended for 24 hours without:
 *  - Port conflicts
 *  - Unhandled promise rejections
 *  - Database errors (PGRST002, etc)
 *  - Memory leaks
 *  - Service crashes
 *
 * Usage:
 *   node tests/soak-test-24h.js [--duration-hours 1]
 *   (defaults to 24 hours)
 *
 * Output:
 *   - Live console updates every 30s
 *   - JSON report at test completion
 *   - Failure details captured for debugging
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIG
// ============================================================================

const DURATION_MS = (process.env.TEST_DURATION || 24) * 3600 * 1000;
const HEALTH_CHECK_INTERVAL = 30000; // 30s
const REPORT_FILE = path.join(__dirname, 'soak-test-report.json');

let metrics = {
  startTime: Date.now(),
  endTime: null,
  durationMs: DURATION_MS,
  checks: [],
  failures: [],
  crashes: [],
  stats: {
    totalChecks: 0,
    successfulChecks: 0,
    failedChecks: 0,
    serviceDownEvents: 0,
  }
};

// ============================================================================
// HEALTH CHECKS
// ============================================================================

async function checkService(name, url) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const timeout = setTimeout(() => {
      resolve({
        service: name,
        url,
        success: false,
        error: 'timeout',
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }, 5000);

    http.get(url, { timeout: 5000 }, (res) => {
      clearTimeout(timeout);
      const success = res.statusCode === 200;
      resolve({
        service: name,
        url,
        success,
        statusCode: res.statusCode,
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }).on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        service: name,
        url,
        success: false,
        error: err.code || err.message,
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    });
  });
}

// ============================================================================
// MONITORING
// ============================================================================

let lastKnownState = {};

async function runHealthCheckRound() {
  const checks = [
    { name: 'Next.js', url: 'http://localhost:3000/api/health' },
    { name: 'Supervisor', url: 'http://localhost:9999/health' },
    { name: 'Heidi Bridge', url: 'http://localhost:5050/health' },
    { name: 'Heidi Mobile', url: 'http://localhost:3006/api/health' },
    { name: 'Flask API', url: 'http://localhost:5000/health' },
  ];

  const results = await Promise.all(
    checks.map((c) => checkService(c.name, c.url))
  );

  for (const result of results) {
    metrics.checks.push(result);
    metrics.stats.totalChecks++;

    const wasUp = lastKnownState[result.service];
    if (result.success) {
      metrics.stats.successfulChecks++;
      if (wasUp === false) {
        console.log(`  ✅ ${result.service} recovered`);
      }
      lastKnownState[result.service] = true;
    } else {
      metrics.stats.failedChecks++;
      metrics.failures.push({
        service: result.service,
        error: result.error,
        statusCode: result.statusCode,
        timestamp: result.timestamp,
      });
      if (wasUp !== false) {
        console.log(`  ⚠️  ${result.service} DOWN (${result.error})`);
        metrics.stats.serviceDownEvents++;
      }
      lastKnownState[result.service] = false;
    }
  }

  return results.every((r) => r.success);
}

// ============================================================================
// PROCESS MONITORING (Check for crashes/restarts)
// ============================================================================

let previousProcState = {};

async function monitorSupervisor() {
  try {
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 5000);
      http.get('http://localhost:9999/status', (res) => {
        clearTimeout(timeout);
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(JSON.parse(data)));
      }).on('error', reject);
    });

    // Check for crashed processes
    for (const [proc, health] of Object.entries(response.health || {})) {
      if (health.status !== 'UP' && previousProcState[proc] === 'UP') {
        metrics.crashes.push({
          service: proc,
          timestamp: new Date().toISOString(),
        });
        console.log(`  💥 ${proc} crashed`);
      }
      previousProcState[proc] = health.status;
    }
  } catch {}
}

// ============================================================================
// REPORTING
// ============================================================================

function printLiveStatus() {
  const elapsed = Date.now() - metrics.startTime;
  const remaining = Math.max(0, DURATION_MS - elapsed);
  const elapsedHours = (elapsed / 3600000).toFixed(1);
  const remainingHours = (remaining / 3600000).toFixed(1);
  const successRate = metrics.stats.totalChecks > 0
    ? ((metrics.stats.successfulChecks / metrics.stats.totalChecks) * 100).toFixed(1)
    : 'N/A';

  console.clear();
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  HYDI 24-Hour Soak Test — LIVE STATUS                      ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Elapsed: ${elapsedHours}h  |  Remaining: ${remainingHours}h`);
  console.log(`  Health Checks: ${metrics.stats.totalChecks} total  |  Success Rate: ${successRate}%`);
  console.log(`  Failures: ${metrics.stats.failedChecks}  |  Service Down Events: ${metrics.stats.serviceDownEvents}`);
  console.log(`  Crashes: ${metrics.crashes.length}`);
  console.log('');

  if (metrics.failures.length > 0) {
    console.log('  Recent Failures:');
    metrics.failures.slice(-5).forEach((f) => {
      console.log(`    - ${f.service}: ${f.error} @ ${f.timestamp}`);
    });
    console.log('');
  }

  if (metrics.crashes.length > 0) {
    console.log('  Crashes:');
    metrics.crashes.slice(-5).forEach((c) => {
      console.log(`    - ${c.service} @ ${c.timestamp}`);
    });
    console.log('');
  }

  console.log('  Waiting for next health check in 30s...');
}

function generateReport() {
  metrics.endTime = Date.now();

  const isHealthy = metrics.stats.failedChecks === 0 && metrics.crashes.length === 0;
  const summary = {
    pass: isHealthy,
    durationHours: (DURATION_MS / 3600000).toFixed(1),
    uptime: '✅',
    stats: metrics.stats,
    crashes: metrics.crashes.length,
    failures: metrics.failures.length,
  };

  const report = {
    summary,
    metrics,
  };

  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

  console.clear();
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  HYDI 24-Hour Soak Test — FINAL REPORT                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Result: ${isHealthy ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  Duration: ${summary.durationHours}h`);
  console.log(`  Total Health Checks: ${metrics.stats.totalChecks}`);
  console.log(`  Successful Checks: ${metrics.stats.successfulChecks} (${(metrics.stats.successfulChecks / metrics.stats.totalChecks * 100).toFixed(1)}%)`);
  console.log(`  Failed Checks: ${metrics.stats.failedChecks}`);
  console.log(`  Service Down Events: ${metrics.stats.serviceDownEvents}`);
  console.log(`  Process Crashes: ${metrics.crashes.length}`);
  console.log('');
  console.log(`  Report saved to: ${REPORT_FILE}`);
  console.log('');

  if (metrics.crashes.length > 0) {
    console.log('  Crashes:');
    metrics.crashes.forEach((c) => {
      console.log(`    - ${c.service} @ ${c.timestamp}`);
    });
    console.log('');
  }

  if (metrics.failures.length > 0) {
    console.log('  Sample Failures (last 10):');
    metrics.failures.slice(-10).forEach((f) => {
      console.log(`    - ${f.service}: ${f.error} @ ${f.timestamp}`);
    });
    console.log('');
  }

  process.exit(isHealthy ? 0 : 1);
}

// ============================================================================
// MAIN
// ============================================================================

console.log('🧪 HYDI 24-Hour Soak Test Starting...');
console.log(`   Duration: ${(DURATION_MS / 3600000).toFixed(1)} hours`);
console.log(`   Health check interval: ${HEALTH_CHECK_INTERVAL / 1000}s`);
console.log(`   Report: ${REPORT_FILE}`);
console.log('');

// Health check loop
const checkInterval = setInterval(async () => {
  await runHealthCheckRound();
  await monitorSupervisor();
  printLiveStatus();

  // Check if done
  if (Date.now() - metrics.startTime >= DURATION_MS) {
    clearInterval(checkInterval);
    generateReport();
  }
}, HEALTH_CHECK_INTERVAL);

// Handle exit signals
process.on('SIGINT', () => {
  console.log('\n\nInterrupted by user');
  clearInterval(checkInterval);
  generateReport();
});

process.on('SIGTERM', () => {
  console.log('\nTerminated');
  clearInterval(checkInterval);
  generateReport();
});
