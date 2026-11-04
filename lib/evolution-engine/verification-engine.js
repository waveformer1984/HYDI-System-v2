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
    const results = { checks: [], ok: true, duration_ms: 0 };

    if (typeof ctx.regressionProbe === 'function' && ctx.regressionProbe()) {
      results.checks.push({ name: 'regression_probe', ok: false, detail: 'deliberate_regression_detected' });
      results.ok = false;
    } else {
      results.checks.push({ name: 'regression_probe', ok: true });
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
