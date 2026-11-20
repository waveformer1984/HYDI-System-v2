'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomBytes } = require('crypto');
const { ExecutionGateway } = require('../execution-fabric/gateway');
const { MemoryTaskStore } = require('../execution-fabric/task-store-memory');
const { LEASE_STALE_MS } = require('../execution-fabric/recovery');
const { getTemplate, validateAllTemplates, cloneMayUseCapability, assertNotCloneForbidden } = require('./templates');
const { callOllamaAdvisor } = require('../governance/action-advisor');
const { DEFAULT_MODEL } = require('./pool-actions');
const { isPoolPaused, poolRuntimeDir } = require('./pool-control');
const { createCloneExecutionContext } = require('./clone-context');

const ROOT = path.resolve(__dirname, '..', '..');
const MAX_SUBTASKS = 20;
const HEARTBEAT_MS = 10_000;

function envInt(name, fallback) {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function freeRamGb() {
  return os.freemem() / (1024 ** 3);
}

function pickCapabilityForSubtask(subtask, template) {
  if (subtask.capability_id && (template.allowed_capabilities || []).includes(subtask.capability_id)) {
    return subtask.capability_id;
  }
  if (template.llm) {
    const id = (template.allowed_capabilities || []).find((c) => c.startsWith('pool.'));
    return id || 'pool.llm_complete';
  }
  const id = (template.allowed_capabilities || []).find((c) => c === 'pool.http_fetch')
    || (template.allowed_capabilities || [])[0];
  return id;
}

class LlmSemaphore {
  constructor(max) {
    this.max = max;
    this.inUse = 0;
    this.waiters = [];
  }

  async acquire() {
    if (this.inUse < this.max) {
      this.inUse += 1;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    }).then(() => {
      this.inUse += 1;
      return () => this.release();
    });
  }

  release() {
    this.inUse = Math.max(0, this.inUse - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  snapshot() {
    return { max: this.max, in_use: this.inUse, waiters: this.waiters.length };
  }
}

class SpecialistPool {
  /**
   * @param {object} opts
   * @param {import('../execution-fabric/task-store-memory').MemoryTaskStore} [opts.store]
   * @param {ExecutionGateway} [opts.gateway]
   */
  constructor(opts = {}) {
    this.store = opts.store || new MemoryTaskStore();
    this.gateway = opts.gateway || new ExecutionGateway({ store: this.store, skipRecovery: true });
    this.now = opts.now || Date.now;
    this.fetchImpl = opts.fetchImpl || globalThis.fetch;
    this.planFn = opts.planFn || opts.planSubtasks || null;
    this.root = opts.root || ROOT;
    this.maxClones = envInt('POOL_MAX_CLONES', 12);
    this.llmSlots = envInt('POOL_LLM_SLOTS', 1);
    this.llmSem = new LlmSemaphore(this.llmSlots);
    this.claimMutex = Promise.resolve();
    this.activeClones = 0;
    this.stats = {
      tasks_today: 0,
      day_key: new Date(this.now()).toISOString().slice(0, 10),
      missions: {},
    };
    this.processed = new Set();
    this.running = false;
    this._cloneControllers = new Map();
  }

  status() {
    this.rollDay();
    return {
      ok: true,
      paused: isPoolPaused(process.env, this.root),
      queue_depth: 0,
      active_clones: this.activeClones,
      llm: this.llmSem.snapshot(),
      max_clones: this.maxClones,
      stats: this.stats,
    };
  }

  rollDay() {
    const key = new Date(this.now()).toISOString().slice(0, 10);
    if (this.stats.day_key !== key) {
      this.stats.day_key = key;
      this.stats.tasks_today = 0;
    }
  }

  async withClaimLock(fn) {
    const prev = this.claimMutex;
    let release;
    this.claimMutex = new Promise((r) => {
      release = r;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async planSubtasks(missionText) {
    if (this.planFn) return this.planFn(missionText);
    const prompt = [
      `Break this mission into at most ${MAX_SUBTASKS} subtasks. JSON only: {"subtasks":[{"template":"scout|researcher|verifier|writer|prompter","title":"...","args":{}}]}`,
      missionText,
    ].join('\n');
    const raw = await callOllamaAdvisor({
      prompt,
      model: process.env.POOL_LLM_MODEL || DEFAULT_MODEL,
      timeoutMs: 60_000,
      fetchImpl: this.fetchImpl,
    });
    let subtasks = [];
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) subtasks = JSON.parse(m[0]).subtasks || [];
    } catch {
      subtasks = [];
    }
    return subtasks.slice(0, MAX_SUBTASKS).map((s, i) => ({
      template: s.template || 'scout',
      title: s.title || `subtask-${i + 1}`,
      args: s.args || {},
      acceptance_criteria: s.acceptance_criteria || s.title || 'complete',
      subtask_id: randomBytes(8).toString('hex'),
    }));
  }

  async enqueueMission(mission) {
    validateAllTemplates();
    const missionId = mission.id || randomBytes(8).toString('hex');
    const subtasks = await this.planSubtasks(mission.objective || mission.text || '');
    const created = [];
    for (const st of subtasks) {
      const template = getTemplate(st.template);
      if (!template) continue;
      const cap = pickCapabilityForSubtask(st, template);
      const gate = cloneMayUseCapability(st.template, cap);
      if (!gate.ok) continue;
      const idem = `pool-${missionId}-${st.subtask_id}`;
      const { task } = await this.store.createTask({
        capability_id: cap,
        role: 'agent',
        actor: `pool:planner`,
        objective: `${missionId}:${st.title}`,
        idempotency_key: idem,
        input: {
          pool_subtask: true,
          pool_mission_id: missionId,
          pool_template: st.template,
          pool_subtask_id: st.subtask_id,
          pool_verifier: false,
          args: st.args || {},
          acceptance_criteria: st.acceptance_criteria,
        },
        plan: { pool: true, template: st.template, capability_id: cap },
      });
      created.push(task);
    }
    this.stats.missions[missionId] = {
      created_at: new Date(this.now()).toISOString(),
      subtasks: subtasks.map((s) => s.subtask_id),
      state: 'RUNNING',
      evidence: [],
    };
    await this.persistStatus();
    return { ok: true, mission_id: missionId, subtasks: created.length, tasks: created };
  }

  async persistStatus() {
    const dir = poolRuntimeDir(this.root);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'status.json');
    const snap = this.status();
    let depth = 0;
    if (typeof this.store.listQueuedPoolSubtasks === 'function') {
      depth = (await this.store.listQueuedPoolSubtasks({ limit: 200 })).length;
    }
    snap.queue_depth = depth;
    fs.writeFileSync(file, `${JSON.stringify(snap, null, 2)}\n`, 'utf8');
    return snap;
  }

  async claimNextSubtask(holder) {
    return this.withClaimLock(async () => {
      if (isPoolPaused(process.env, this.root)) return null;
      const list = await this.store.listQueuedPoolSubtasks({ limit: 100 });
      for (const task of list) {
        const stId = task.input && task.input.pool_subtask_id;
        if (stId && this.processed.has(stId)) continue;
        const claim = await this.store.claimLease(task.id, holder, LEASE_STALE_MS);
        if (!claim.ok) continue;
        const plan = await this.store.transition(task.id, 'PLANNING', { reason: 'pool_claim' });
        if (!plan.ok) continue;
        const tr = await this.store.transition(task.id, 'RUNNING', { reason: 'pool_claim' });
        if (!tr.ok) continue;
        if (stId) this.processed.add(stId);
        return tr.task;
      }
      return null;
    });
  }

  async requeueStaleLeases() {
    const before = new Date(this.now()).toISOString();
    const stale = await this.store.listStaleLeases(before);
    for (const task of stale) {
      if (!task.input?.pool_subtask) continue;
      await this.store.transition(task.id, 'QUEUED', { reason: 'lease_expired' });
      task.lease_holder = null;
      task.lease_expires_at = null;
      await this.store.persist(task);
    }
  }

  budgetAllows(templateId) {
    this.rollDay();
    const tpl = getTemplate(templateId);
    if (!tpl) return false;
    const key = `${this.stats.day_key}:${templateId}`;
    const used = this.stats[`budget_${key}`] || 0;
    return used < tpl.per_day_task_budget;
  }

  bumpBudget(templateId) {
    const key = `${this.stats.day_key}:${templateId}`;
    const field = `budget_${key}`;
    this.stats[field] = (this.stats[field] || 0) + 1;
    this.stats.tasks_today += 1;
  }

  async runCloneOnce(cloneId, templateId) {
    if (!this.budgetAllows(templateId)) return { ok: false, error: 'daily_budget' };
    const tpl = getTemplate(templateId);
    if (!tpl) return { ok: false, error: 'bad_template' };
    const holder = `clone:${templateId}:${cloneId}`;
    const task = await this.claimNextSubtask(holder);
    if (!task) return { ok: true, idle: true };

    const stId = task.input.pool_subtask_id;

    const cap = task.capability_id;
    const may = cloneMayUseCapability(task.input.pool_template, cap);
    if (!may.ok) {
      await this.store.transition(task.id, 'FAILED', { reason: 'capability_denied' });
      return { ok: false, error: may.error };
    }
    assertNotCloneForbidden(cap);

    const releaseLlm = tpl.llm ? await this.llmSem.acquire() : null;
    try {
      const submitted = await this.gateway.submit({
        capabilityId: cap,
        args: { ...(task.input.args || {}), acceptance_criteria: task.input.acceptance_criteria },
        confirm: true,
        role: 'agent',
        actor: holder,
        objective: task.objective,
        idempotencyKey: task.idempotency_key,
        correlationId: task.correlation_id,
        ctx: {
          role: 'agent',
          cloneExecution: createCloneExecutionContext({ actor: holder, templateId }),
        },
      });
      if (!submitted.ok) {
        await this.store.transition(task.id, 'FAILED', { reason: submitted.error || 'submit_failed' });
        return submitted;
      }
      this.bumpBudget(templateId);
      const fresh = await this.store.get(task.id);
      if (fresh && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(fresh.state)) {
        await this.store.transition(task.id, 'COMPLETED', { reason: 'pool_done' });
      }
      await this.maybeEnqueueVerifier(task);
      await this.maybeCompleteMission(task.input.pool_mission_id);
      return { ok: true, task_id: task.id, result: submitted };
    } finally {
      if (releaseLlm) releaseLlm();
    }
  }

  async maybeEnqueueVerifier(parentTask) {
    if (parentTask.input.pool_verifier) return;
    const missionId = parentTask.input.pool_mission_id;
    const subtaskId = randomBytes(6).toString('hex');
    const idem = `pool-v-${missionId}-${parentTask.input.pool_subtask_id}`;
    await this.store.createTask({
      capability_id: 'pool.verify_evidence',
      role: 'agent',
      actor: 'pool:verifier-chain',
      objective: `verify:${parentTask.input.pool_subtask_id}`,
      idempotency_key: idem,
      input: {
        pool_subtask: true,
        pool_mission_id: missionId,
        pool_template: 'verifier',
        pool_subtask_id: subtaskId,
        pool_verifier: true,
        parent_subtask_id: parentTask.input.pool_subtask_id,
        args: {
          criteria: parentTask.input.acceptance_criteria,
          evidence: JSON.stringify(parentTask.outcome || {}).slice(0, 4000),
        },
      },
    });
  }

  async maybeCompleteMission(missionId) {
    const m = this.stats.missions[missionId];
    if (!m) return;
    const pending = await this.store.listQueuedPoolSubtasks({ limit: 200 });
    const mine = pending.filter((t) => t.input?.pool_mission_id === missionId);
    if (mine.length) return;
    m.state = 'COMPLETED';
    m.completed_at = new Date(this.now()).toISOString();
    await this.persistStatus();
  }

  desiredClones(queueDepth) {
    if (isPoolPaused(process.env, this.root)) return 0;
    if (freeRamGb() < 1.5) return 0;
    return Math.min(queueDepth, this.maxClones, 12);
  }

  async runWorkersOnce() {
    await this.requeueStaleLeases();
    const queued = await this.store.listQueuedPoolSubtasks({ limit: 200 });
  const byTemplate = {};
    for (const t of queued) {
      const tpl = t.input.pool_template;
      byTemplate[tpl] = (byTemplate[tpl] || 0) + 1;
    }
    const jobs = [];
    for (const [templateId, depth] of Object.entries(byTemplate)) {
      const tpl = getTemplate(templateId);
      if (!tpl) continue;
      const n = Math.min(depth, tpl.max_clones, this.desiredClones(depth));
      for (let i = 0; i < n; i += 1) {
        jobs.push(this.runCloneOnce(`${i}`, templateId));
      }
    }
    this.activeClones = jobs.length;
    const results = await Promise.all(jobs);
    await this.persistStatus();
    return results;
  }

  canSpawnMissionFromClone(capabilityId) {
    return assertNotCloneForbidden(capabilityId);
  }
}

module.exports = {
  SpecialistPool,
  LlmSemaphore,
  pickCapabilityForSubtask,
  MAX_SUBTASKS,
};