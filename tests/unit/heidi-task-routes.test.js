'use strict';

/**
 * Task lifecycle through heidi-core itself: the chat commands answer without
 * a model call, the REST routes return real status codes, and the model's
 * update_mission tool can't approve or finish an action task.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const HeidiCore = require('../../heidi-core/server');

function sse(port, input) {
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

describe('heidi-core task commands and routes', () => {
  let core;
  let server;
  let base;
  let port;
  let modelCalls = 0;
  let saved;

  beforeAll(async () => {
    saved = process.env.HEIDI_AUTONOMOUS_ACTIONS;
    delete process.env.HEIDI_AUTONOMOUS_ACTIONS;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-task-routes-'));
    core = new HeidiCore({ memory: { dbPath: path.join(dir, 'legacy.db') }, conversationDbPath: path.join(dir, 'heidi_memory.db') });
    await core.memory.initialize();
    await core.memory.registerAgent('Heidi', 'orchestrator', null, 0);
    await core.memory.setAgentPermission('Heidi', 3);
    core.brain = { chatWithTools: async () => { modelCalls += 1; return { text: 'x', tool_calls: [] }; } };
    server = core.app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    port = server.address().port;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    core.missionWorker.stop();
    server.close();
    if (core.memoryRuntime.store) core.memoryRuntime.store.close();
    if (core.memory.db) await core.memory.close();
    if (saved === undefined) delete process.env.HEIDI_AUTONOMOUS_ACTIONS;
    else process.env.HEIDI_AUTONOMOUS_ACTIONS = saved;
  });

  it('runs the lifecycle from chat and REST, without the model', async () => {
    const act = { type: 'run_command', command: 'git', args: ['status'] };
    const id = await core.memory.createMission('check the tree', 1, { action: act }, 'Heidi', { actor: 'test' });
    const other = await core.memory.createMission('another check', 1, { action: act }, 'Heidi', { actor: 'test' });
    await core.missionWorker.tick();
    await core.missionWorker.tick();
    expect((await core.memory.getMission(id)).status).toBe('awaiting_approval');

    const list = await sse(port, 'tasks');
    expect(list[0].t).toMatch(/✋ 2 waiting for you/);
    expect(list[1]).toMatchObject({ done: true, model: 'tasks' });

    // REST: detail with parsed fields and history.
    const detail = await (await fetch(`${base}/missions/${id}`)).json();
    expect(detail.mission).toMatchObject({ status: 'awaiting_approval', approval: { required: true, decision: null }, context: { action: act } });
    expect(detail.events.map((e) => e.to_state)).toEqual(['queued', 'planning', 'awaiting_approval']);
    expect((await fetch(`${base}/missions/4242`)).status).toBe(404);
    expect((await fetch(`${base}/missions/${id}/explode`, { method: 'POST' })).status).toBe(404);

    // Approve from chat: the nudged worker runs it (dry run: not armed).
    const approved = await sse(port, `task approve ${id} looks fine`);
    expect(approved[0].t).toMatch(/👍 Approved/);
    for (let i = 0; i < 50 && (await core.memory.getMission(id)).status !== 'completed'; i += 1) await new Promise((r) => setTimeout(r, 20));
    const done = await (await fetch(`${base}/missions/${id}`)).json();
    expect(done.mission.status).toBe('completed');
    expect(done.mission.evidence.outcome).toBe('dry_run');
    expect(done.events.find((e) => e.reason === 'approved: looks fine').actor).toBe('human:owner');

    // REST reject, then a second decision is a conflict.
    const rej = await fetch(`${base}/missions/${other}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: 'not today' }) });
    expect(rej.status).toBe(200);
    expect((await rej.json()).mission).toMatchObject({ status: 'cancelled', approval: { decision: 'rejected', note: 'not today' } });
    expect((await fetch(`${base}/missions/${other}/approve`, { method: 'POST' })).status).toBe(409);

    const listed = await (await fetch(`${base}/missions?state=completed,cancelled`)).json();
    expect(listed.missions.map((m) => m.id).sort()).toEqual([id, other].sort());
    expect(listed.counts).toMatchObject({ completed: 1, cancelled: 1 });
    expect(modelCalls).toBe(0);
  });

  it("the model's tools can't approve, run, or complete an action task", async () => {
    const act = { type: 'run_command', command: 'git', args: ['status'] };
    const created = await core.toolRegistry.execute('create_mission', { goal: 'g', action: act, assigned_agent: 'Heidi', success: { outputIncludes: 'clean' } }, 'Heidi');
    expect(created).toMatchObject({ created: true, state: 'queued' });
    const id = created.task_id;
    expect(lifecycleState(await core.memory.getMission(id))).toBe('queued');
    expect(JSON.parse((await core.memory.getMission(id)).context).success).toEqual({ outputIncludes: 'clean' });

    for (const status of ['running', 'awaiting_approval', 'verifying', 'active']) {
      expect((await core.toolRegistry.execute('update_mission', { id, status }, 'Heidi')).error).toMatch(/can't be set from chat/);
    }
    expect((await core.toolRegistry.execute('update_mission', { id, status: 'completed' }, 'Heidi')).error).toMatch(/only the worker/);
    expect(await core.toolRegistry.execute('update_mission', { id, status: 'cancelled', result: 'duplicate' }, 'Heidi')).toEqual({ updated: true, state: 'cancelled' });
    const last = (await core.memory.getMissionEvents(id)).pop();
    expect(last).toMatchObject({ actor: 'Heidi', to_state: 'cancelled', reason: 'duplicate' });
  });
});

function lifecycleState(m) {
  return m && m.status;
}
