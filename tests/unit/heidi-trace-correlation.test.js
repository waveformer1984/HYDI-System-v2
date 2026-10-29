'use strict';

/**
 * ProtoForge pipeline → Heidi task correlation by trace_id.
 *
 * End to end with real code on loopback ports: lib/pipeline (MemoryLedger,
 * a policy engine that escalates) → emission → lib/pipeline/heidi-task-link
 * → a real heidi-core `POST /missions`; protoforge-core's trace routes
 * (lib/pipeline/trace-routes) serve the live trace that Heidi's `trace`
 * command reads back. Nothing leaves 127.0.0.1.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');

const { createPipeline } = require('../../lib/pipeline');
const { createMetrics } = require('../../lib/pipeline/metrics');
const { MemoryLedger } = require('../../lib/pipeline/memory-ledger');
const { createHeidiTaskLinker, goalFor } = require('../../lib/pipeline/heidi-task-link');
const { mountTraceRoutes } = require('../../lib/pipeline/trace-routes');
const lifecycle = require('../../heidi-core/missions/lifecycle');
const HeidiCore = require('../../heidi-core/server');

const STREAM_BREAK = {
  eventId: 'evt-trace-1',
  eventType: 'stream.disconnected',
  source: 'ursula',
  payload: { stream_disconnected: true, connection_lost: true, websocket_error: '1006', stream_error: 'EPIPE', disconnect: 'server', stream: 'rezonate' },
};

function engineWith(decision) {
  return async () => ({
    evaluate: (hyp) => ({ decisionId: 'dec-7f3a9c21', hypothesisId: hyp.id, decision, matchedRuleId: 'rule-stream-review' }),
    recordDecision: async () => null,
  });
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

function sse(base, input) {
  const { port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/chat-tools', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (r) => {
      let buf = '';
      r.on('data', (c) => { buf += c; });
      r.on('end', () => resolve(buf.split('\n\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)))));
    });
    req.on('error', reject);
    req.end(JSON.stringify({ input }));
  });
}

describe('heidi task linker (unit)', () => {
  const ev = { trace_id: 'a1b2c3d4-0000-4000-8000-000000000001', outcome: 'escalate', fingerprint: 'fp1', event_type: 'stream.disconnected', source: 'ursula', classification: 'STREAM_FAILURE', confidence: 0.9, decision: 'escalate', decision_id: 'd1', matched_rule_id: 'r1', stream: 'rezonate' };
  const ok = (json, status = 201) => async () => ({ ok: status < 300, status, json: async () => json });

  it('opens one task per escalation with the trace attached, and skips other outcomes', async () => {
    const calls = [];
    const linker = createHeidiTaskLinker({
      env: { HEIDI_CORE_URL: 'http://heidi.test/', HEIDI_SECRET: 'shared-test-value' },
      fetchImpl: async (url, init) => { calls.push({ url, init }); return ok({ ok: true, mission: { id: 4 } })(); },
      log: () => {},
    });
    expect(await linker.handle(ev)).toEqual({ linked: true, existing: false, task_id: 4 });
    expect(calls[0].url).toBe('http://heidi.test/missions');
    expect(calls[0].init.headers['x-heidi-secret']).toBe('shared-test-value');
    const body = JSON.parse(calls[0].init.body);
    expect(body).toMatchObject({ trace_id: ev.trace_id, priority: 2, source: 'protoforge-pipeline', goal: 'Review ProtoForge escalate: STREAM_FAILURE from ursula (trace a1b2c3d4)' });
    expect(body.trace).toMatchObject({ fingerprint: 'fp1', decision_id: 'd1', matched_rule_id: 'r1', stream: 'rezonate' });
    expect(body).not.toHaveProperty('action');

    for (const outcome of ['approve', 'reject', 'duplicate', 'quarantined', 'error']) {
      expect((await linker.handle({ ...ev, outcome })).linked).toBe(false);
    }
    expect(calls).toHaveLength(1);
    expect(linker.status()).toMatchObject({ enabled: true, linked: 1, skipped: 5, failed: 0, target: 'http://heidi.test' });
  });

  it('never throws: a dead or refusing heidi-core is logged and counted', async () => {
    const logs = [];
    const down = createHeidiTaskLinker({ env: {}, fetchImpl: async () => { throw new TypeError('fetch failed'); }, log: (m) => logs.push(m) });
    await expect(down.handle(ev)).resolves.toEqual({ linked: false, reason: 'fetch failed' });
    expect(logs[0]).toMatch(/could not open a Heidi task for trace a1b2c3d4/);
    const refused = createHeidiTaskLinker({ env: {}, fetchImpl: ok({ error: 'Forbidden' }, 403), log: () => {} });
    expect((await refused.handle(ev)).reason).toBe('Forbidden');
    expect(refused.status()).toMatchObject({ failed: 1, last: { ok: false, error: 'Forbidden' } });
  });

  it('can be switched off, or told which outcomes to link', async () => {
    const fetchImpl = jest.fn(ok({ ok: true, existing: true, mission: { id: 9 } }, 200));
    expect((await createHeidiTaskLinker({ env: { HEIDI_TRACE_LINK: 'false' }, fetchImpl }).handle(ev)).reason).toBe('disabled');
    expect(fetchImpl).not.toHaveBeenCalled();
    const both = createHeidiTaskLinker({ env: { HEIDI_TRACE_LINK_OUTCOMES: 'escalate, reject' }, fetchImpl, log: () => {} });
    expect((await both.handle({ ...ev, outcome: 'reject' })).existing).toBe(true);
    expect(both.status()).toMatchObject({ existing: 1, outcomes: ['escalate', 'reject'] });
    expect(goalFor({ trace_id: 'abcdef123456', outcome: 'reject', event_type: 'x.y' })).toBe('Review ProtoForge reject: x.y (trace abcdef12)');
  });
});

describe('pipeline → Heidi task → trace, end to end', () => {
  let core;
  let heidi;
  let pf;
  let pipeline;
  let linker;
  const linked = [];
  const saved = {};

  beforeAll(async () => {
    for (const k of ['PROTOFORGE_CORE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'HEIDI_AUTONOMOUS_ACTIONS']) { saved[k] = process.env[k]; delete process.env[k]; }
    jest.spyOn(console, 'log').mockImplementation(() => {});

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-trace-'));
    core = new HeidiCore({ memory: { dbPath: path.join(dir, 'legacy.db') }, conversationDbPath: path.join(dir, 'heidi_memory.db') });
    await core.memory.initialize();
    core.brain = { chatWithTools: async () => { throw new Error('the model must not be called'); } };
    heidi = await listen(core.app);

    linker = createHeidiTaskLinker({ env: { HEIDI_CORE_URL: heidi.base }, log: () => {} });
    pipeline = createPipeline({
      ledger: new MemoryLedger(),
      policyEngineFactory: engineWith('escalate'),
      metrics: createMetrics(),
      // protoforge-core's wiring: emission → linker (fire-and-forget there; awaited here)
      emit: (type, data) => { if (type === 'pipeline_trace') linked.push(linker.handle(data)); },
    });
    const pfApp = express();
    mountTraceRoutes(pfApp, { getPipeline: () => pipeline, linker });
    pf = await listen(pfApp);
    process.env.PROTOFORGE_CORE_URL = pf.base;
  });

  afterAll(async () => {
    core.missionWorker.stop();
    heidi.server.close();
    if (pf.server.listening) pf.server.close();
    if (core.memoryRuntime.store) core.memoryRuntime.store.close();
    if (core.memory.db) await core.memory.close();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    jest.restoreAllMocks();
  });

  it('one trace_id links the pipeline run, the decision and the Heidi task', async () => {
    const trace = await pipeline.run(STREAM_BREAK);
    expect(trace.outcome).toBe('escalate');
    const result = await linked[0];
    expect(result).toMatchObject({ linked: true, existing: false });

    const task = await core.memory.getMission(result.task_id);
    expect(task).toMatchObject({ trace_id: trace.trace_id, status: 'queued', priority: 2, assigned_agent: null });
    expect(lifecycle.actionOf(task)).toBeNull(); // informational: nothing can run from it
    expect(lifecycle.traceOf(task)).toMatchObject({
      trace_id: trace.trace_id, fingerprint: trace.fingerprint, outcome: 'escalate',
      decision: 'escalate', decision_id: 'dec-7f3a9c21', matched_rule_id: 'rule-stream-review', stream: 'rezonate',
      classification: trace.stages.cascade.classification,
    });
    const [created] = await core.memory.getMissionEvents(task.id);
    expect(created).toMatchObject({ actor: 'protoforge-pipeline', reason: `opened from pipeline trace ${trace.trace_id.slice(0, 8)}` });
    expect(JSON.parse(created.data)).toEqual({ trace_id: trace.trace_id });

    // The same event again is a ledger duplicate: no new escalation, no new task.
    expect((await pipeline.run(STREAM_BREAK)).outcome).toBe('duplicate');
    expect((await linked[1]).linked).toBe(false);
    // A retried link for the same trace returns the existing task.
    expect(await linker.handle({ trace_id: trace.trace_id, outcome: 'escalate' })).toMatchObject({ linked: true, existing: true, task_id: task.id });
    expect(await core.memory.getMissionsByTrace(trace.trace_id)).toHaveLength(1);

    // Heidi's chat: the task shows its trace; `trace <prefix>` shows every stage live.
    const shown = await sse(heidi.base, `task ${task.id}`);
    expect(shown[0].t).toMatch(new RegExp(`Trace: ${trace.trace_id} \\(ProtoForge escalate, .*from ursula, rule rule-stream-review\\)`));
    const traced = await sse(heidi.base, `trace ${trace.trace_id.slice(0, 8)}`);
    expect(traced[1]).toMatchObject({ done: true, model: 'trace' });
    const text = traced[0].t;
    expect(text).toMatch(new RegExp(`^🔗 Trace ${trace.trace_id}`));
    expect(text).toMatch(/Pipeline: escalate .*from protoforge-core/);
    for (const stage of ['ingestion', 'ledger', 'cascade', 'kilo', 'protoforge', 'emission']) expect(text).toMatch(new RegExp(`✓ ${stage}: ok`));
    expect(text).toMatch(/protoforge: ok — escalate by rule rule-stream-review, decision dec-7f3a/);
    expect(text).toMatch(new RegExp(`Heidi tasks:\\n  ⏳ #${task.id} queued — Review ProtoForge escalate`));

    // REST: the same view, and the task list filtered by trace.
    const rest = await (await fetch(`${heidi.base}/traces/${trace.trace_id}`)).json();
    expect(rest.pipeline.trace_id).toBe(trace.trace_id);
    expect(rest.missions.map((m) => m.id)).toEqual([task.id]);
    const byTrace = await (await fetch(`${heidi.base}/missions?trace_id=${trace.trace_id.slice(0, 12)}`)).json();
    expect(byTrace.missions.map((m) => m.id)).toEqual([task.id]);

    // protoforge-core restarted (trace gone): Heidi still answers from the snapshot on the task.
    await new Promise((r) => pf.server.close(r));
    const offline = await sse(heidi.base, `trace ${trace.trace_id}`);
    expect(offline[0].t).toMatch(/snapshot on the task; protoforge-core no longer holds this trace/);
    expect(offline[0].t).toMatch(/ProtoForge escalate by rule rule-stream-review/);

    // A person closes the review; the worker never touches it.
    await core.missionWorker.tick();
    expect((await core.memory.getMission(task.id)).status).toBe('queued');
    const done = await sse(heidi.base, `task done ${task.id} stream came back on its own`);
    expect(done[0]).toHaveProperty('t');
    const closed = await core.memory.getMission(task.id);
    expect(closed.status).toBe('completed');
    expect(lifecycle.parseJson(closed.evidence)).toMatchObject({ outcome: 'completed', note: 'stream came back on its own', by: 'human:owner' });
  });

  it('POST /missions opens informational tasks only, and validates what it stores', async () => {
    const post = (body) => fetch(`${heidi.base}/missions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post({ goal: 'x', action: { type: 'run_command', command: 'git', args: ['status'] } })).status).toBe(400);
    expect((await post({ goal: 'x', context: { action: { type: 'log_event' } } })).status).toBe(400);
    expect((await post({ goal: '' })).status).toBe(400);
    expect((await post({ goal: 'x', trace_id: "'; DROP TABLE missions; --" })).status).toBe(400);
    expect((await post({ goal: 'x', trace_id: 'abcdef12', trace: { blob: 'y'.repeat(5000) } })).status).toBe(400);
    const r = await post({ goal: 'check the invoice export', priority: 9 });
    expect(r.status).toBe(201);
    expect((await r.json()).mission).toMatchObject({ status: 'queued', priority: 3, trace_id: null });
    expect((await fetch(`${heidi.base}/traces/zz`)).status).toBe(400);
    expect((await fetch(`${heidi.base}/traces/0123456789ab`)).status).toBe(404);
  });

  it('only a person can mark a task done, and only an informational one', async () => {
    const act = await core.memory.createMission('run it', 1, { action: { type: 'log_event', target: 't', payload: {} } }, 'Heidi', { actor: 'test' });
    expect(await lifecycle.runTaskCommand(core.memory, { cmd: 'done', id: act }, { actor: 'human:owner' })).toMatch(/only the worker can finish it/);
    const info = await core.memory.createMission('note', 1, null, null, { actor: 'test' });
    expect(await lifecycle.runTaskCommand(core.memory, { cmd: 'done', id: info }, { actor: 'Heidi' })).toBe('⚠️ Only a person can mark a task done.');
  });
});

describe('trace and done command parsing', () => {
  it('accepts a full id or an 8+ char hex prefix, nothing else', () => {
    expect(lifecycle.parseTraceCommand('trace a1b2c3d4')).toEqual({ cmd: 'trace', id: 'a1b2c3d4' });
    expect(lifecycle.parseTraceCommand('/trace A1B2C3D4-0000-4000-8000-000000000001')).toEqual({ cmd: 'trace', id: 'a1b2c3d4-0000-4000-8000-000000000001' });
    expect(lifecycle.parseTraceCommand('trace abc')).toEqual({ cmd: 'usage' });
    expect(lifecycle.parseTraceCommand('trace not-a-hex-id!')).toEqual({ cmd: 'usage' });
    for (const q of ['trace', 'trace the bug please', 'tracer a1b2c3d4', 'how do I trace a1b2c3d4']) expect(lifecycle.parseTraceCommand(q)).toBeNull();
    expect(lifecycle.parseTaskCommand('task done 5 reviewed it')).toEqual({ cmd: 'done', id: 5, note: 'reviewed it' });
  });
});
