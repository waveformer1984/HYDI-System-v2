'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const { randomBytes } = require('crypto');
const { TEST_SUITES, ACTIONS } = require('./action-catalog');
const { hasPermission } = require('../auth/rbac');
const ops = require('./ops-task-actions');

/** Execution-fabric ops actions, dispatched by exact catalog id. */
const OPS_RUNNERS = new Map([
  ['ops.task_status', ops.opsTaskStatus],
  ['ops.task_approve', ops.opsTaskApprove],
  ['ops.task_cancel', ops.opsTaskCancel],
  ['ops.task_resume', ops.opsTaskResume],
  ['ops.recovery_preview', ops.opsRecoveryPreview],
  ['ops.recovery_execute', ops.opsRecoveryExecute],
  ['ops.task_verify', ops.opsTaskVerify],
  ['ops.billing_verification', ops.opsBillingVerification],
  ['ops.execution_readiness', (_args, ctx) => ops.opsExecutionReadiness(ctx)],
]);

const execFileAsync = promisify(execFile);

const MAX_OUTPUT_CHARS = 8000;
const TEST_TIMEOUT_MS = 120_000;
const GIT_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 5000;

function correlationId() {
  return randomBytes(8).toString('hex');
}

function trimOutput(text) {
  if (typeof text !== 'string') return '';
  const t = text.replace(/\r/g, '');
  return t.length > MAX_OUTPUT_CHARS ? `${t.slice(0, MAX_OUTPUT_CHARS)}\n…[truncated]` : t;
}

function repoRoot() {
  return process.env.HYDI_REPO_ROOT || path.join(__dirname, '..', '..');
}

async function probeUrl(name, url, fetchImpl = globalThis.fetch) {
  const started = Date.now();
  try {
    const res = await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const ok = res.ok;
    let hint = ok ? 'ok' : `http_${res.status}`;
    if (ok && res.headers.get('content-type')?.includes('json')) {
      try {
        const body = await res.json();
        if (body && typeof body === 'object') {
          if (body.status) hint = String(body.status);
          else if (body.ok === false) hint = 'degraded';
        }
      } catch (_) {
        /* non-json ok */
      }
    }
    return { name, url, ok, ms: Date.now() - started, hint };
  } catch (err) {
    return {
      name,
      url,
      ok: false,
      ms: Date.now() - started,
      hint: err instanceof Error ? err.message : 'probe_failed',
    };
  }
}

async function runHealthCheck(ctx = {}) {
  const port = process.env.PORT || '3000';
  const proto = process.env.PROTOFORGE_CORE_URL || 'http://127.0.0.1:3005';
  const ollama = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  // Ursula EPM suite: the separate local Flask server (CLAUDE.md, port 5000).
  const ursula = (process.env.URSULA_URL || 'http://127.0.0.1:5000').replace(/\/+$/, '');
  const probes = [
    { name: 'heidi-web', url: `http://127.0.0.1:${port}/api/health` },
    { name: 'protoforge-core', url: `${proto.replace(/\/+$/, '')}/health` },
    { name: 'ollama', url: `${ollama}/api/tags` },
    { name: 'ursula', url: `${ursula}/` },
  ];
  const fetchImpl = ctx.fetchImpl || globalThis.fetch;
  const results = await Promise.all(probes.map((p) => probeUrl(p.name, p.url, fetchImpl)));
  const ok = results.every((r) => r.ok);
  return { ok, probes: results, ts: new Date().toISOString() };
}

async function runGitInspect(ctx = {}) {
  const cwd = ctx.repoRoot || repoRoot();
  const git = ctx.gitExec || ((args) => execFileAsync('git', args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 512 * 1024 }));
  const [branch, head, status] = await Promise.all([
    git(['rev-parse', '--abbrev-ref', 'HEAD']).then((r) => r.stdout.trim()).catch(() => 'unknown'),
    git(['rev-parse', '--short', 'HEAD']).then((r) => r.stdout.trim()).catch(() => 'unknown'),
    git(['status', '--short', '--branch']).then((r) => trimOutput(r.stdout)).catch(() => ''),
  ]);
  return { branch, head, status_lines: status.split('\n').filter(Boolean).slice(0, 40), cwd };
}

async function runTests(args = {}, ctx = {}) {
  const suite = typeof args.suite === 'string' ? args.suite.trim() : '';
  const files = TEST_SUITES[suite];
  if (!files) {
    return { ok: false, error: 'unknown_suite', allowed: Object.keys(TEST_SUITES) };
  }
  const cwd = ctx.repoRoot || repoRoot();
  const runner = ctx.testExec || ((jestArgs) => execFileAsync('npx', jestArgs, { cwd, timeout: TEST_TIMEOUT_MS, maxBuffer: 1024 * 1024 }));
  const started = Date.now();
  try {
    const { stdout, stderr } = await runner(['jest', ...files, '--runInBand', '--forceExit', '--colors=false']);
    const combined = trimOutput(`${stdout}\n${stderr}`);
    const ok = !/\bFAIL\b/.test(combined) && /\bPASS\b/.test(combined);
    return { ok, suite, ms: Date.now() - started, output: combined };
  } catch (err) {
    const stdout = err.stdout ? trimOutput(String(err.stdout)) : '';
    const stderr = err.stderr ? trimOutput(String(err.stderr)) : '';
    return {
      ok: false,
      suite,
      ms: Date.now() - started,
      output: trimOutput(`${stdout}\n${stderr}`),
      error: err instanceof Error ? err.message : 'test_run_failed',
    };
  }
}

/**
 * @param {'health.check'|'service.status'|'git.inspect'|'tests.run'} action
 * @param {object} args
 * @param {object} ctx  inject fetch, git, tests, statusLoader
 */
async function runAction(action, args, ctx = {}) {
  const id = correlationId();
  if (action === 'health.check') {
    const result = await runHealthCheck(ctx);
    return { correlation_id: id, action, ok: result.ok, result };
  }
  if (action === 'service.status') {
    if (typeof ctx.loadServiceStatus !== 'function') {
      return { correlation_id: id, action, ok: false, error: 'status_loader_unconfigured' };
    }
    const result = await ctx.loadServiceStatus();
    return { correlation_id: id, action, ok: true, result };
  }
  if (action === 'git.inspect') {
    const result = await runGitInspect(ctx);
    return { correlation_id: id, action, ok: true, result };
  }
  if (action === 'tests.run') {
    const result = await runTests(args, ctx);
    return { correlation_id: id, action, ok: result.ok, result };
  }
  if (action === 'billing.preflight') {
    const result = await runBillingPreflight(ctx);
    return { correlation_id: id, action, ok: result.ok, result };
  }
  if (action === 'billing.verify_workflow') {
    const result = await runBillingVerifyWorkflow(args, ctx);
    return { correlation_id: id, action, ok: result.ok, result };
  }
  const opsRunner = OPS_RUNNERS.get(action);
  if (typeof opsRunner === 'function') {
    // Defence in depth: re-check the server-side role against the catalog
    // permission here too, so no caller can reach an ops runner on the
    // strength of the action name alone.
    const meta = ACTIONS[action];
    if (!ctx.role || !hasPermission(ctx.role, meta.permission)) {
      return { correlation_id: id, action, ok: false, error: 'forbidden' };
    }
    const result = await opsRunner(args, ctx);
    return { correlation_id: id, action, ok: result.ok !== false, result, audited_at: new Date().toISOString() };
  }
  return { correlation_id: id, action, ok: false, error: 'unknown_action' };
}

async function runBillingPreflight(ctx = {}) {
  const cwd = ctx.repoRoot || repoRoot();
  const runner = ctx.preflightExec || ((script) => execFileAsync(process.execPath, [script], { cwd, timeout: 30_000, maxBuffer: 512 * 1024 }));
  const script = path.join(cwd, 'scripts/billing-preflight.js');
  try {
    const { stdout, stderr } = await runner(script);
    const lines = `${stdout}\n${stderr}`.split('\n').filter(Boolean);
    const checks = lines.filter((l) => /^(PASS|FAIL) /.test(l)).map((l) => {
      const m = l.match(/^(PASS|FAIL) ([^:]+): (.*)$/);
      return m ? { status: m[1], id: m[2], detail: m[3] } : { raw: l };
    });
    const ok = checks.length > 0 && checks.every((c) => c.status === 'PASS');
    return { ok, checks, output: trimOutput(`${stdout}\n${stderr}`) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'preflight_failed',
      output: trimOutput(String(err.stdout || '') + String(err.stderr || '')),
    };
  }
}

async function runBillingVerifyWorkflow(args = {}, ctx = {}) {
  const { createTask, runAutomatedSteps, finalReport, loadTask, saveTask, taskDir } = require('../billing/sandbox-workflow');
  const root = ctx.repoRoot || repoRoot();
  let taskId = typeof args.task_id === 'string' ? args.task_id : null;
  if (!taskId) {
    const task = createTask(root);
    taskId = task.id;
  } else if (!loadTask(root, taskId)) {
    return { ok: false, error: 'task_not_found', task_id: taskId };
  }
  const task = loadTask(root, taskId);
  await runAutomatedSteps(task, root, { catalogCheck: Boolean(process.env.BILLING_APP_URL) });
  saveTask(root, task);
  const report = finalReport(task);
  const { summarizeBillingIdentityReadiness } = require('../billing/identity-readiness');
  const billingTablesStep = task.steps.find((s) => s.id === 'billing_tables');
  const identity_readiness = summarizeBillingIdentityReadiness({
    tablesFound: billingTablesStep?.evidence?.tables_found,
    missing: billingTablesStep?.evidence?.missing,
  });
  const ok = report.failures.length === 0 && report.blocked.every((b) => ['env_secrets', 'stripe_listen', 'sandbox_setup'].includes(b.id) === false);
  return { ok: report.failures.length === 0, task_id: taskId, report, identity_readiness, task_dir: taskDir(root) };
}

module.exports = {
  correlationId,
  runAction,
  runHealthCheck,
  runGitInspect,
  runTests,
  runBillingPreflight,
  runBillingVerifyWorkflow,
  trimOutput,
  repoRoot,
};
