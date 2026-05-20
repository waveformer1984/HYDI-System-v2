// autonomous-task-queue.js
// Background reasoning loop wired to real HEIDI infrastructure:
// lowdb tasks, CascadeEngineV3, Ollama health, and the /health endpoint.
// No placeholder methods — every check calls something real.

'use strict';

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const HEIDI_BASE   = 'http://127.0.0.1:3458';
const OLLAMA_BASE  = 'http://127.0.0.1:11434';
const PRIORITY_MAP = { critical: 3, high: 2, normal: 1, low: 0 };

class AutonomousTaskQueue {
  constructor(db, cascade, log = console) {
    this.db      = db;       // lowdb instance (shared with main server)
    this.cascade = cascade;  // CascadeEngineV3 instance
    this.log     = log;
    this.queue   = [];       // in-memory priority queue
    this.history = [];       // last 100 completed/failed tasks
    this.running = false;
    this._interval = null;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  enqueue(type, context = {}, priority = 'normal') {
    const task = {
      id:        `atq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      context,
      priority,
      createdAt: Date.now(),
      status:    'queued',
    };
    this.queue.push(task);
    this.queue.sort((a, b) => (PRIORITY_MAP[b.priority] || 0) - (PRIORITY_MAP[a.priority] || 0));
    this.log.log(`[ATQ] enqueued ${task.type} (${priority}) → ${task.id}`);
    return task.id;
  }

  snapshot() {
    return {
      queued:  this.queue.length,
      history: this.history.length,
      running: this.running,
      queue:   this.queue.slice(0, 10),
      recent:  this.history.slice(-5),
    };
  }

  start(intervalMs = 6000) {
    if (this._interval) return;
    this.log.log('[ATQ] Starting autonomous reasoning loop');

    // Seed the initial introspection tasks
    this.enqueue('introspect_health',   {}, 'normal');
    this.enqueue('validate_cascade',    {}, 'normal');
    this.enqueue('check_task_backlog',  {}, 'low');

    this._interval = setInterval(() => this._tick(), intervalMs);
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
      this.log.log('[ATQ] Stopped');
    }
  }

  // ── Internal tick ──────────────────────────────────────────────────────────

  async _tick() {
    if (this.running || this.queue.length === 0) return;
    this.running = true;
    const task = this.queue.shift();
    task.status    = 'executing';
    task.startedAt = Date.now();

    try {
      const result = await this._dispatch(task.type, task.context);
      task.status      = 'completed';
      task.result      = result;
      task.completedAt = Date.now();

      // Auto-enqueue follow-ups
      if (result.followUp) {
        for (const fu of [].concat(result.followUp)) {
          this.enqueue(fu.type, fu.context || {}, fu.priority || 'normal');
        }
      }
    } catch (err) {
      task.status = 'failed';
      task.error  = err.message;
      this.log.error(`[ATQ] ${task.type} failed: ${err.message}`);
    } finally {
      this.history.push(task);
      if (this.history.length > 100) this.history.shift();
      this.running = false;
    }
  }

  // ── Dispatcher ─────────────────────────────────────────────────────────────

  async _dispatch(type, ctx) {
    switch (type) {
      case 'introspect_health':    return this._introspectHealth();
      case 'validate_cascade':     return this._validateCascade();
      case 'check_task_backlog':   return this._checkTaskBacklog();
      case 'check_ollama':         return this._checkOllama();
      case 'synthesize_insight':   return this._synthesizeInsight(ctx);
      case 'summarize_history':    return this._summarizeHistory();
      default:
        throw new Error(`Unknown task type: ${type}`);
    }
  }

  // ── Task implementations (all real, no stubs) ──────────────────────────────

  async _introspectHealth() {
    let heidiOk = false;
    let heidiData = {};
    try {
      const r = await axios.get(`${HEIDI_BASE}/health`, { timeout: 3000 });
      heidiOk  = r.data.status === 'ok';
      heidiData = r.data;
    } catch (_) { /* offline */ }

    let ollamaOk = false;
    try {
      await axios.get(`${OLLAMA_BASE}/api/tags`, { timeout: 3000 });
      ollamaOk = true;
    } catch (_) { /* offline */ }

    // Memory file size
    const memFile = path.join(__dirname, 'heidi-memory.json');
    let memBytes = 0;
    try { memBytes = fs.statSync(memFile).size; } catch (_) {}

    const metrics = {
      heidiOk,
      ollamaOk,
      sessions:    heidiData.sessions ?? 0,
      tasks:       heidiData.tasks    ?? 0,
      memoryBytes: memBytes,
      timestamp:   Date.now(),
    };

    this.log.log(`[ATQ] health — heidi:${heidiOk} ollama:${ollamaOk} mem:${(memBytes/1024).toFixed(1)}KB`);

    const followUp = [];
    if (!ollamaOk) followUp.push({ type: 'check_ollama', priority: 'high' });
    if (memBytes > 5 * 1024 * 1024) followUp.push({ type: 'summarize_history', priority: 'normal' });

    // Re-schedule introspection every ~30 seconds (5 ticks at 6s each)
    followUp.push({ type: 'introspect_health', context: {}, priority: 'low' });

    return { metrics, followUp };
  }

  async _validateCascade() {
    let valid = false;
    let details = {};
    try {
      // CascadeEngineV3.reprioritizeTasks() is the real health method
      const result = await this.cascade.reprioritizeTasks();
      const health = result.structural_health || {};
      valid = health.health_rating !== 'critical';
      details = {
        rating: health.health_rating,
        issues: (health.issues || []).length,
        tasks:  (result.tasks || []).length,
      };
    } catch (err) {
      details = { error: err.message };
    }

    this.log.log(`[ATQ] cascade — valid:${valid} rating:${details.rating || 'error'} tasks:${details.tasks ?? '?'}`);

    const followUp = [];
    if (!valid) followUp.push({ type: 'validate_cascade', priority: 'high' });
    // Re-schedule cascade validation every ~60s (10 ticks)
    followUp.push({ type: 'validate_cascade', context: {}, priority: 'low' });

    return { valid, details, followUp };
  }

  async _checkTaskBacklog() {
    await this.db.read();
    const tasks    = this.db.data.tasks || [];
    const pending  = tasks.filter(t => t.status === 'pending').length;
    const stale    = tasks.filter(t => {
      if (t.status !== 'pending') return false;
      const age = Date.now() - new Date(t.createdAt).getTime();
      return age > 24 * 60 * 60 * 1000; // older than 24h
    });

    this.log.log(`[ATQ] backlog — pending:${pending} stale:${stale.length}`);

    const followUp = [{ type: 'check_task_backlog', priority: 'low' }];
    if (stale.length > 0) {
      followUp.push({
        type: 'synthesize_insight',
        context: { topic: `${stale.length} tasks have been pending >24h`, staleIds: stale.map(t => t.id) },
        priority: 'normal',
      });
    }

    return { pending, stale: stale.length, followUp };
  }

  async _checkOllama() {
    let models = [];
    let ok = false;
    try {
      const r = await axios.get(`${OLLAMA_BASE}/api/tags`, { timeout: 5000 });
      models = (r.data.models || []).map(m => m.name);
      ok = true;
    } catch (_) {}

    this.log.log(`[ATQ] ollama — ok:${ok} models:${models.join(',') || 'none'}`);
    return { ok, models };
  }

  async _synthesizeInsight(ctx) {
    const topic = ctx.topic || 'system state';

    if (!await this._ollamaAvailable()) {
      return { skipped: true, reason: 'Ollama offline' };
    }

    const prompt = `You are HEIDI, an autonomous AI system. Provide a brief (2-3 sentence) insight about: ${topic}`;
    const r = await axios.post(`${OLLAMA_BASE}/api/chat`, {
      model:    'llama3.2:latest',
      messages: [{ role: 'user', content: prompt }],
      stream:   false,
    }, { timeout: 30000 });

    const insight = r.data.message?.content || '';
    this.log.log(`[ATQ] insight — "${insight.slice(0, 80)}..."`);

    // Persist insight as a task in lowdb so it's visible via /tasks
    await this.db.read();
    this.db.data.tasks.push({
      id:          `insight_${Date.now()}`,
      title:       `Insight: ${topic.slice(0, 60)}`,
      description: insight,
      priority:    'low',
      source:      'autonomous-queue',
      status:      'completed',
      createdAt:   new Date().toISOString(),
    });
    await this.db.write();

    return { insight, topic };
  }

  async _summarizeHistory() {
    await this.db.read();
    const sessions  = this.db.data.sessions || [];
    const totalMsgs = sessions.reduce((n, s) => n + (s.history || []).length, 0);

    // Prune sessions with >50 exchanges to keep memory file small
    for (const s of sessions) {
      if ((s.history || []).length > 50) {
        s.history = s.history.slice(-20);
        this.log.log(`[ATQ] pruned session ${s.id} to last 20 exchanges`);
      }
    }
    await this.db.write();

    const memFile  = path.join(__dirname, 'heidi-memory.json');
    const newBytes = fs.existsSync(memFile) ? fs.statSync(memFile).size : 0;
    this.log.log(`[ATQ] summarize — sessions:${sessions.length} msgs:${totalMsgs} mem:${(newBytes/1024).toFixed(1)}KB`);

    return { sessions: sessions.length, totalMsgs, memoryBytes: newBytes };
  }

  async _ollamaAvailable() {
    try {
      await axios.get(`${OLLAMA_BASE}/api/tags`, { timeout: 2000 });
      return true;
    } catch (_) {
      return false;
    }
  }
}

module.exports = AutonomousTaskQueue;
