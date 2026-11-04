'use strict';
const http = require('http');
const HeidiCore = require('../../heidi-core/server.js');

// Minimal stubs — the handler only touches these members.
function stubCore() {
  const heidi = new HeidiCore({ brain: {} });
  heidi.memoryRuntime = {
    resolveOwner: () => 'test',
    isMemoryCommand: () => false,
    beginTurn: () => ({ ok: true, context: {} }),
    endTurn: () => ({ saved: true }),
  };
  heidi.memory = {
    buildContext: async () => ({ recent_interactions: [], relevant_facts: [], recent_reflections: [], system_health: [] }),
    storeShortTerm: async () => {},
  };
  heidi.turnMeta = () => ({});
  heidi.getSystemStatus = async () => ({ overall: 'HEALTHY', checkedAt: new Date().toISOString(), components: [] });
  heidi.isSelfStatusQuery = () => false;
  heidi.isUngroundedCapabilityQuery = () => false;
  heidi.matchFastPath = () => null; // force the model path
  heidi.pickModel = () => 'qwen2.5:3b';
  heidi.retrieveProceduralMemory = async () => [];
  heidi.runTaskChat = async () => 'task output';
  heidi.traceReport = async () => ({ text: 'trace' });
  heidi.toolRegistry = { toOllamaTools: () => [], extractToolCalls: () => [], execute: async () => ({ ok: true }) };
  heidi.brain = {
    chatWithTools: async () => ({ text: 'ok answer', toolCalls: [] }),
    generateStream: async (prompt, onTok) => { onTok('tok'); return { text: 'tok', model: 'qwen2.5:3b' }; },
  };
  return heidi;
}

function listen(heidi) {
  return new Promise((r) => {
    const s = heidi.app.listen(0, '127.0.0.1', () => r({ server: s, port: s.address().port }));
  });
}
function post(port, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/chat-tools', method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}
const logs = [];
let logSpy;
beforeEach(() => { logs.length = 0; logSpy = jest.spyOn(console, 'log').mockImplementation((m) => logs.push(m)); });
afterEach(() => logSpy.mockRestore());
const terminal = () => logs.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((r) => r && r.event === 'chat_tools_terminal');

describe('/chat-tools terminal record', () => {
  it('deterministic route emits one completed record', async () => {
    const heidi = stubCore();
    const { server, port } = await listen(heidi);
    await post(port, { input: 'system report' });
    server.close();
    const t = terminal();
    expect(t).toHaveLength(1);
    expect(t[0].state).toBe('completed');
    expect(t[0].route).toBe('deterministic');
    expect(t[0].correlation_id).toBeTruthy();
  });

  it('paraphrase "run the system report tool now" is deterministic — zero model calls, matched id recorded', async () => {
    const heidi = stubCore();
    const brainSpy = jest.spyOn(heidi.brain, 'chatWithTools');
    const { server, port } = await listen(heidi);
    const r = await post(port, { input: 'run the system report tool now' });
    server.close();
    expect(brainSpy).not.toHaveBeenCalled(); // zero model invocations
    expect(r.data).toContain('system-status');
    const t = terminal();
    expect(t).toHaveLength(1);
    expect(t[0].route).toBe('deterministic');
    expect(t[0].matched).toBe('system_report_paraphrase');
  });

  it('mixed intent "run the system report and restart heidi" does NOT match deterministic', async () => {
    const heidi = stubCore();
    heidi.brain.chatWithTools = async () => ({ text: 'ok', toolCalls: [] });
    const { server, port } = await listen(heidi);
    await post(port, { input: 'run the system report and restart heidi' });
    server.close();
    const t = terminal();
    expect(t[0].route).not.toBe('deterministic'); // fell through to model/other path
  });

  it('model path emits one completed record', async () => {
    const heidi = stubCore();
    const { server, port } = await listen(heidi);
    await post(port, { input: 'what is the weather like today, tell me a story' });
    server.close();
    const t = terminal();
    expect(t.length).toBe(1);
    expect(['completed', 'failed']).toContain(t[0].state);
    expect(t[0].elapsed_ms).toBeGreaterThanOrEqual(0);
  });

  it('client disconnect mid-request emits one cancelled record, no duplicate on close', async () => {
    const heidi = stubCore();
    heidi.brain.chatWithTools = () => new Promise(() => {}); // hangs forever
    const { server, port } = await listen(heidi);
    const req = http.request({ host: '127.0.0.1', port, path: '/chat-tools', method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => { res.on('error', () => {}); res.on('data', () => {}); });
    req.on('error', () => {}); // expected: we destroy the socket mid-flight
    req.end(JSON.stringify({ input: 'long model work' }));
    await new Promise((r) => setTimeout(r, 300));
    req.destroy(); // client goes away mid-flight
    await new Promise((r) => setTimeout(r, 300));
    server.close();
    const t = terminal();
    expect(t).toHaveLength(1);
    expect(t[0].state).toBe('cancelled');
  });

  it('model+tool path emits per-op loop timing in the terminal record', async () => {
    const heidi = stubCore();
    heidi.brain.chatWithTools = jest.fn()
      .mockResolvedValueOnce({ text: 'calling tool', tool_calls: [{ function: { name: 'system_status', arguments: '{}' } }] })
      .mockResolvedValueOnce({ text: 'final answer', tool_calls: [] });
    const { server, port } = await listen(heidi);
    await post(port, { input: 'check the system status please' });
    server.close();
    const t = terminal();
    expect(t).toHaveLength(1);
    expect(t[0].state).toBe('completed');
    expect(Array.isArray(t[0].loop)).toBe(true);
    const ops = t[0].loop.map((e) => e.op);
    expect(ops).toContain('model_call');
    expect(ops).toContain('tool');
    const toolEv = t[0].loop.find((e) => e.op === 'tool');
    expect(toolEv.tool).toBe('system_status');
    expect(toolEv.outcome).toBe('ok');
    expect(typeof toolEv.dur_ms).toBe('number');
  });

  it('handler failure emits one failed record with bounded reason', async () => {
    const heidi = stubCore();
    heidi.brain.chatWithTools = async () => { throw new Error('upstream exploded'); };
    const { server, port } = await listen(heidi);
    await post(port, { input: 'make the model fail' });
    server.close();
    const t = terminal();
    expect(t).toHaveLength(1);
    expect(t[0].state).toBe('failed');
    expect((t[0].reason || '').length).toBeLessThanOrEqual(120);
  });
});
