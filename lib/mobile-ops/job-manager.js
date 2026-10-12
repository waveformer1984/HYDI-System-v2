'use strict';

/**
 * Runs long mobile-ops jobs (see job-catalog.js) as child processes and keeps
 * their state and output in memory so a phone can follow them:
 *
 *   start → { id }  ·  get(id, since) → state + log lines after `since`
 *   cancel(id)      ·  list()
 *
 * Reconnect-safe: every log line has a monotonically increasing `seq`; a
 * client that loses its connection asks again with the last seq it saw and
 * gets exactly the lines it missed (unless they aged out of the bounded
 * buffer, which is reported as `truncated`).
 *
 * Safety: fixed argv from the catalog only, child env stripped of
 * credential-looking variables, output redacted and bounded, per-job
 * timeout, at most one running job per kind and MAX_RUNNING overall,
 * cancellation kills the whole process tree.
 *
 * State lives in this process only: restarting heidi-web forgets jobs (and
 * kills their children). Audit records go to auth_audit_log via the route.
 */

const { spawn: nodeSpawn, execFile } = require('child_process');
const { randomBytes } = require('crypto');
const { hasPermission } = require('../auth/rbac');
const { JOBS } = require('./job-catalog');
const { repoRoot } = require('./action-runners');

const WIN = process.platform === 'win32';
const MAX_RUNNING = 2;
const MAX_HISTORY = 20;
const MAX_LOG_BYTES = 256 * 1024;
const MAX_LINE_CHARS = 2000;
const KILL_GRACE_MS = 5000;

const SECRET_ENV = /(SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|API_KEY|SERVICE_ROLE|_KEY$|^KEY_|AUTH)/i;

const REDACTIONS = [
  [/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{8,}/g, '$1_$2_[REDACTED]'],
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{12,}/gi, '$1 [REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[REDACTED_PRIVATE_KEY]'],
  [/\b([A-Z0-9_]*(SECRET|TOKEN|PASSWORD|API_KEY)[A-Z0-9_]*)\s*[=:]\s*\S+/gi, '$1=[REDACTED]'],
  [/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, '$1[REDACTED]@'],
];

function redact(text) {
  let t = text;
  for (const [re, rep] of REDACTIONS) t = t.replace(re, rep);
  return t;
}

function childEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (SECRET_ENV.test(k)) continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);

class JobManager {
  /**
   * @param {object} [opts]
   * @param {Record<string, any>} [opts.jobs]   catalog override (tests)
   * @param {Function} [opts.spawn]             spawn override (tests)
   * @param {Function} [opts.killTree]          (pid) => void override (tests)
   * @param {string} [opts.root]                repo root
   * @param {() => number} [opts.now]
   * @param {number} [opts.maxLogBytes]
   */
  constructor(opts = {}) {
    this.jobs = opts.jobs || JOBS;
    this.spawn = opts.spawn || nodeSpawn;
    this.killTree = opts.killTree || defaultKillTree;
    this.root = opts.root || repoRoot();
    this.now = opts.now || Date.now;
    this.maxLogBytes = opts.maxLogBytes || MAX_LOG_BYTES;
    this.killGraceMs = opts.killGraceMs ?? KILL_GRACE_MS;
    /** @type {Map<string, any>} */
    this.all = new Map();
  }

  catalogFor(role) {
    return Object.entries(this.jobs)
      .filter(([, j]) => hasPermission(role, j.permission))
      .map(([kind, j]) => ({ kind, permission: j.permission, confirm_required: j.confirmRequired, summary: j.summary, timeout_ms: j.timeoutMs }));
  }

  /** @returns {{ ok: true, job: object } | { ok: false, error: string, message: string, allowed?: string[] }} */
  start({ kind, args = {}, confirm = false, role, actor = null }) {
    if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(this.jobs, kind)) return { ok: false, error: 'invalid_job', message: 'Unknown job kind.' };
    const def = this.jobs[kind];
    if (!hasPermission(role, def.permission)) return { ok: false, error: 'forbidden', message: `Role cannot run ${kind}.` };
    if (def.confirmRequired && confirm !== true) {
      return { ok: false, error: 'confirmation_required', message: 'Set confirm: true after reviewing the job.' };
    }
    const steps = def.steps(args && typeof args === 'object' ? args : {}, this.root);
    if (!Array.isArray(steps)) return { ok: false, error: steps.error, message: 'Invalid job arguments.', allowed: steps.allowed };

    const running = [...this.all.values()].filter((j) => !TERMINAL.has(j.state));
    if (running.some((j) => j.kind === kind)) return { ok: false, error: 'busy', message: `A ${kind} job is already running.` };
    if (running.length >= MAX_RUNNING) return { ok: false, error: 'busy', message: 'Too many jobs running; wait or cancel one.' };

    const job = {
      id: randomBytes(8).toString('hex'),
      kind,
      state: 'running',
      actor,
      role,
      created_at: this.now(),
      started_at: this.now(),
      ended_at: null,
      exit_code: null,
      error: null,
      step_index: 0,
      steps: steps.map((s) => ({ label: s.label, state: 'pending', exit_code: null })),
      artifacts: [],
      log: [],
      log_bytes: 0,
      next_seq: 1,
      truncated: false,
      _steps: steps,
      _child: null,
      _timer: null,
      _def: def,
    };
    this.all.set(job.id, job);
    this.prune();
    job._timer = setTimeout(() => this.stop(job, 'timed_out'), def.timeoutMs);
    if (typeof job._timer.unref === 'function') job._timer.unref();
    this.append(job, 'system', `job ${kind} started (${steps.length} step${steps.length === 1 ? '' : 's'})`);
    this.runStep(job);
    return { ok: true, job: this.summary(job) };
  }

  runStep(job) {
    if (TERMINAL.has(job.state)) return;
    const step = job._steps[job.step_index];
    if (!step) return this.finish(job, 'succeeded', 0);
    job.steps[job.step_index].state = 'running';
    this.append(job, 'system', `▶ ${step.label}`);
    let child;
    try {
      child = this.spawn(step.cmd, step.args, {
        cwd: step.cwd,
        env: childEnv(step.env),
        detached: !WIN, // own process group, so cancel can kill the tree
        windowsHide: true,
        // .cmd/.bat shims need a shell on Windows; argv is constant.
        shell: WIN && /\.(cmd|bat)$/i.test(step.cmd),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      job.steps[job.step_index].state = 'failed';
      return this.finish(job, 'failed', null, `could not start ${step.label}: ${err instanceof Error ? err.message : 'spawn failed'}`);
    }
    job._child = child;
    const onData = (stream) => {
      let carry = '';
      return (chunk) => {
        const text = carry + chunk.toString('utf8');
        const lines = text.split(/\r?\n/);
        carry = lines.pop() || '';
        for (const l of lines) this.append(job, stream, l);
        if (carry.length > MAX_LINE_CHARS) {
          this.append(job, stream, carry);
          carry = '';
        }
      };
    };
    child.stdout?.on('data', onData('stdout'));
    child.stderr?.on('data', onData('stderr'));
    child.on('error', (err) => {
      if (TERMINAL.has(job.state)) return;
      job.steps[job.step_index].state = 'failed';
      this.finish(job, 'failed', null, `${step.label}: ${err instanceof Error ? err.message : 'process error'}`);
    });
    child.on('close', (code, signal) => {
      job._child = null;
      if (TERMINAL.has(job.state)) return;
      const s = job.steps[job.step_index];
      s.exit_code = code;
      if (code === 0) {
        s.state = 'succeeded';
        job.step_index += 1;
        return this.runStep(job);
      }
      s.state = 'failed';
      this.finish(job, 'failed', code, `${step.label} exited with ${code === null ? `signal ${signal}` : `code ${code}`}`);
    });
  }

  finish(job, state, exitCode, error = null) {
    if (TERMINAL.has(job.state)) return;
    job.state = state;
    job.exit_code = exitCode;
    job.error = error;
    job.ended_at = this.now();
    clearTimeout(job._timer);
    if (state === 'succeeded' && job._def.artifacts) {
      const fs = require('fs');
      job.artifacts = job._def.artifacts(this.root).filter((p) => {
        try {
          return fs.statSync(p).isFile();
        } catch {
          return false;
        }
      });
    }
    this.append(job, 'system', `job ${state}${error ? `: ${error}` : ''}`);
  }

  /** End a running job (cancel or timeout) and kill its process tree. */
  stop(job, state) {
    if (TERMINAL.has(job.state)) return false;
    const child = job._child;
    const runningStep = job.steps[job.step_index];
    if (runningStep && runningStep.state === 'running') runningStep.state = state === 'timed_out' ? 'timed_out' : 'cancelled';
    this.finish(job, state, null, state === 'timed_out' ? `exceeded ${Math.round(job._def.timeoutMs / 1000)}s` : 'cancelled by user');
    if (child && child.pid) {
      try {
        this.killTree(child.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
      const hard = setTimeout(() => {
        try {
          if (child.exitCode === null && child.signalCode === null) this.killTree(child.pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }, this.killGraceMs);
      if (typeof hard.unref === 'function') hard.unref();
    }
    return true;
  }

  cancel({ id, role }) {
    const job = this.all.get(id);
    if (!job) return { ok: false, error: 'not_found', message: 'No such job.' };
    if (!hasPermission(role, job._def.permission)) return { ok: false, error: 'forbidden', message: 'Role cannot cancel this job.' };
    if (TERMINAL.has(job.state)) return { ok: true, job: this.summary(job), already_finished: true };
    this.stop(job, 'cancelled');
    return { ok: true, job: this.summary(job) };
  }

  append(job, stream, text) {
    const line = { seq: job.next_seq++, ts: this.now(), stream, text: redact(text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}…` : text) };
    job.log.push(line);
    job.log_bytes += line.text.length + 16;
    while (job.log_bytes > this.maxLogBytes && job.log.length > 1) {
      const dropped = job.log.shift();
      job.log_bytes -= dropped.text.length + 16;
      job.truncated = true;
    }
  }

  get({ id, since = 0, role, limit = 500 }) {
    const job = this.all.get(id);
    if (!job) return { ok: false, error: 'not_found', message: 'No such job.' };
    if (!hasPermission(role, 'status:view')) return { ok: false, error: 'forbidden', message: 'Role cannot view jobs.' };
    const after = Number.isFinite(Number(since)) ? Number(since) : 0;
    const lines = job.log.filter((l) => l.seq > after).slice(0, Math.max(1, Math.min(2000, limit)));
    const firstKept = job.log.length ? job.log[0].seq : job.next_seq;
    return {
      ok: true,
      job: this.summary(job),
      lines,
      next_since: lines.length ? lines[lines.length - 1].seq : Math.max(after, firstKept - 1),
      // The client missed lines that aged out of the bounded buffer.
      gap: after + 1 < firstKept && after > 0,
      more: job.log.some((l) => l.seq > (lines.length ? lines[lines.length - 1].seq : after)),
    };
  }

  list({ role }) {
    if (!hasPermission(role, 'status:view')) return [];
    return [...this.all.values()].sort((a, b) => b.created_at - a.created_at).map((j) => this.summary(j));
  }

  summary(job) {
    return {
      id: job.id,
      kind: job.kind,
      state: job.state,
      actor: job.actor,
      created_at: job.created_at,
      started_at: job.started_at,
      ended_at: job.ended_at,
      duration_ms: (job.ended_at || this.now()) - job.started_at,
      exit_code: job.exit_code,
      error: job.error,
      steps: job.steps.map((s) => ({ ...s })),
      artifacts: job.artifacts.slice(),
      truncated: job.truncated,
      last_seq: job.next_seq - 1,
    };
  }

  prune() {
    const finished = [...this.all.values()].filter((j) => TERMINAL.has(j.state)).sort((a, b) => a.created_at - b.created_at);
    while (this.all.size > MAX_HISTORY && finished.length) this.all.delete(finished.shift().id);
  }

  /** Kill everything still running (process shutdown). */
  shutdown() {
    for (const j of this.all.values()) this.stop(j, 'cancelled');
  }
}

function defaultKillTree(pid, signal) {
  if (WIN) {
    // Fixed argv; pid is a number we spawned.
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
    return;
  }
  process.kill(-pid, signal); // negative pid = the whole process group
}

/** One manager per heidi-web process (survives Next.js dev hot reloads). */
function getJobManager() {
  if (!globalThis.__hydiMobileJobManager) globalThis.__hydiMobileJobManager = new JobManager();
  return globalThis.__hydiMobileJobManager;
}

module.exports = { JobManager, getJobManager, redact, childEnv, TERMINAL, MAX_RUNNING };
