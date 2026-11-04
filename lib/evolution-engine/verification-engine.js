'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/**
 * Run bounded automated verification for an improvement attempt.
 */
class VerificationEngine {
  /**
   * @param {{ repoRoot?: string, execFile?: typeof execFileAsync, timeoutMs?: number }} [opts]
   */
  constructor(opts = {}) {
    this.repoRoot = opts.repoRoot || process.cwd();
    this.execFile = opts.execFile || execFileAsync;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
  }

  /**
   * @param {object} ctx
   * @param {object} [ctx.baseline]
   * @param {string[]} [ctx.testFiles]
   * @param {() => boolean} [ctx.regressionProbe] injected for hermetic demos
   */
  async verify(ctx = {}) {
    const started = Date.now();
    const results = { checks: [], ok: true, duration_ms: 0, contract_frozen_at: ctx.frozenContract?.frozen_at || null };

    if (ctx.testIntegrityBefore && ctx.testIntegrityAfter) {
      const weak = this._detectTestWeakening(ctx.testIntegrityBefore, ctx.testIntegrityAfter);
      results.checks.push({ name: 'test_integrity', ok: !weak.length, weakening: weak });
      if (weak.length) results.ok = false;
    }

    if (typeof ctx.regressionProbe === 'function' && ctx.regressionProbe()) {
      const injected = ctx.regressionInjected === true;
      results.checks.push({
        name: 'regression_probe',
        ok: false,
        detail: injected ? 'injected_regression_detected' : 'regression_detected',
        injected,
      });
      results.ok = false;
    } else {
      results.checks.push({ name: 'regression_probe', ok: true, injected: false });
    }

    const files = ctx.testFiles && ctx.testFiles.length ? ctx.testFiles : null;
    if (files) {
      const testResult = await this._runJest(files);
      results.checks.push({ name: 'jest', ...testResult });
      if (!testResult.ok) results.ok = false;
    }

    if (ctx.baseline && ctx.afterMetrics) {
      const cmp = this._compareMetrics(ctx.baseline, ctx.afterMetrics);
      results.checks.push({ name: 'metrics_compare', ...cmp });
      if (!cmp.ok) results.ok = false;
    }

    results.duration_ms = Date.now() - started;
    return results;
  }

  _detectTestWeakening(before, after) {
    const issues = [];
    if (after.removed_tests?.length) issues.push({ kind: 'removed_tests', files: after.removed_tests });
    if (after.weakened_assertions?.length) issues.push({ kind: 'weakened_assertions', count: after.weakened_assertions.length });
    if (after.new_skips?.length) issues.push({ kind: 'new_skips', files: after.new_skips });
    if (before.hash && after.hash && before.hash === after.hash && issues.length === 0) return issues;
    return issues;
  }

  _compareMetrics(baseline, after) {
    const worse = [];
    if (baseline.error_rate != null && after.error_rate != null && after.error_rate > baseline.error_rate + 0.01) {
      worse.push('error_rate_regressed');
    }
    return { ok: worse.length === 0, worse, baseline, after };
  }

  async _runJest(files) {
    try {
      const { stdout, stderr } = await this.execFile(
        'npx',
        ['jest', ...files, '--runInBand', '--forceExit'],
        { cwd: this.repoRoot, timeout: this.timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      );
      const out = `${stdout}\n${stderr}`;
      return { ok: true, exit_code: 0, output_tail: out.slice(-1500) };
    } catch (err) {
      const code = typeof err.code === 'number' ? err.code : 1;
      const out = `${err.stdout || ''}\n${err.stderr || ''}`;
      return { ok: false, exit_code: code, output_tail: out.slice(-1500) };
    }
  }
}

module.exports = { VerificationEngine };
