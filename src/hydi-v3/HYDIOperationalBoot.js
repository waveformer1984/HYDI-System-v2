#!/usr/bin/env node
'use strict';

/**
 * HYDIOperationalBoot
 *
 * One authoritative startup verification sequence for HYDI. This module does not
 * duplicate the startup intelligence in `HYDIStartupSequence`; it delegates the
 * actual environment checks, `OperatorSession` construction, sensor registration,
 * interpreter wiring, and health-report assembly to `HYDIStartupSequence` and
 * then normalizes the result into the readiness report shape required by the
 * Phase 23 operational proof-of-life.
 *
 * Usage:
 *   const { boot, statusText } = require('./src/hydi-v3/HYDIOperationalBoot');
 *   const report = await boot({ dataPath: './data' });
 */

const { runStartupSequence } = require('./HYDIStartupSequence');

function normalizeComponent(component) {
  return {
    name: component.name,
    status: component.ok ? 'healthy' : 'unhealthy',
    detail: component.detail || '',
  };
}

/**
 * Verify the operating environment and boot the full HYDI executive stack.
 *
 * @param {object} [config] passed through to `HYDIStartupSequence`
 * @returns {Promise<{status: 'ready'|'failed', startupTime: number, checks: Array<{name:string,status:string,detail:string}>, warnings: string[], failures: Array<{step:string,error:string}>, session?: OperatorSession}>}
 */
async function boot(config = {}) {
  const startup = await runStartupSequence(config);
  const checks = (startup.components || []).map(normalizeComponent);

  const report = {
    status: startup.status === 'healthy' ? 'ready' : 'failed',
    startupTime: startup.startupTime || 0,
    checks,
    warnings: startup.warnings || [],
    failures: startup.failures || [],
  };

  // Expose the live session so callers (e.g. `bin/hydi.js`) can render a status
  // summary and then destroy the stack cleanly.
  if (startup.session) {
    report.session = startup.session;
  }

  return report;
}

/**
 * Render a compact, human-readable operational status from a boot report.
 *
 * @param {ReturnType<boot>} report
 * @returns {string}
 */
function statusText(report) {
  const lines = [`HYDI ${report.status.toUpperCase()}`, `startup: ${report.startupTime}ms`];
  for (const check of report.checks) {
    const label = check.name.padEnd(22, ' ');
    const state = check.status === 'healthy' ? 'OK' : 'NOT OK';
    lines.push(`  ${label} ${state}${check.detail ? `  (${check.detail})` : ''}`);
  }
  if (report.warnings.length) {
    lines.push('', 'Warnings:');
    for (const w of report.warnings) lines.push(`  - ${w}`);
  }
  if (report.failures.length) {
    lines.push('', 'Failures:');
    for (const f of report.failures) lines.push(`  - ${f.step}: ${f.error}`);
  }
  return lines.join('\n');
}

module.exports = { boot, statusText };
