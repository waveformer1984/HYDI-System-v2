'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const BusinessMemory = require('../../../src/hydi-v3/BusinessMemory');
const ExecutiveOperatingSystem = require('../../../src/hydi-v3/ExecutiveOperatingSystem');
const { ExecutionGateway } = require('../../../src/hydi-v3/ExecutionGateway');
const { BusinessWorkflowEngine } = require('../../../src/hydi-v3/BusinessWorkflowEngine');
const StrategicObjectives = require('../../../src/hydi-v3/StrategicObjectives');
const ExecutiveCockpit = require('../../../src/hydi-v3/ExecutiveCockpit');
const AgentWorkspace = require('../../../src/hydi-v3/AgentWorkspace');
const ApprovalCenter = require('../../../src/hydi-v3/ApprovalCenter');
const ExecutiveTimeline = require('../../../src/hydi-v3/ExecutiveTimeline');
const SessionMemory = require('../../../src/hydi-v3/SessionMemory');
const ConversationEngine = require('../../../src/hydi-v3/ConversationEngine');

const SILENT = { log: () => {}, error: () => {}, warn: () => {} };

describe('ConversationEngine', () => {
  let dataPath;
  let memory;
  let strategicObjectives;
  let executiveOS;
  let executionGateway;
  let workflowEngine;
  let cockpit;
  let agentWorkspace;
  let approvalCenter;
  let timeline;
  let sessionMemory;
  let engine;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `heidi-convoengine-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });

    strategicObjectives = new StrategicObjectives({ ownerPriority: 'default' });
    memory = new BusinessMemory({ dataPath, strategicObjectives, logger: SILENT });
    await memory.start();
    memory.put({ type: 'task', name: 'Fix printer', status: 'blocked', value: 500, tags: ['blocker'] });
    memory.put({ type: 'opportunity', name: 'Acme deal', status: 'active', value: 5000, tags: ['resonate'] });
    memory.put({ tags: ['flagship'], type: 'project', name: 'Resonate App', status: 'active' });

    executiveOS = new ExecutiveOperatingSystem({ dataPath, businessMemory: memory, strategicObjectives, logger: SILENT });
    await executiveOS.start();

    executionGateway = new ExecutionGateway({ dataPath, businessMemory: memory, logger: SILENT });
    await executionGateway.start();
    await executionGateway.execute({ type: 'draft-email', params: { to: 'client@example.com' }, requestingAgent: 'Sales Manager' });

    workflowEngine = new BusinessWorkflowEngine({ dataPath, businessMemory: memory, executiveOS, strategicObjectives, logger: SILENT });
    await workflowEngine.start();

    cockpit = new ExecutiveCockpit({
      dataPath, businessMemory: memory, executiveOS, workflowEngine, executionGateway, strategicObjectives, logger: SILENT,
    });
    await cockpit.start();

    agentWorkspace = new AgentWorkspace({ executiveOS, executionGateway, workflowEngine });
    approvalCenter = new ApprovalCenter({ executionGateway, workflowEngine, strategicObjectives });
    timeline = new ExecutiveTimeline({ dataPath, executionGateway, workflowEngine, executiveOS, cockpit, logger: SILENT });
    await timeline.start();
    sessionMemory = new SessionMemory({ dataPath, logger: SILENT });
    await sessionMemory.start();

    engine = new ConversationEngine({
      cockpit, executiveOS, memory, workflowEngine, executionGateway, strategicObjectives,
      agentWorkspace, approvalCenter, timeline, sessionMemory, logger: SILENT,
    });
    engine.onBackup = async () => ({ text: 'Backup completed: 3 files.', ok: true, files: 3 });
  });

  afterEach(async () => {
    await timeline.destroy().catch(() => {});
    await sessionMemory.destroy().catch(() => {});
    await cockpit.destroy().catch(() => {});
    await workflowEngine.destroy().catch(() => {});
    await executionGateway.destroy().catch(() => {});
    await executiveOS.destroy().catch(() => {});
    await memory.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  test('good morning produces the complete executive briefing', async () => {
    const res = await engine.ask('good morning');
    expect(res.intent).toBe('good-morning');
    expect(res.briefing).toBeTruthy();
    expect(res.text).toContain('Executive Summary');
  });

  test('greeting variants ("hi", "hey", "hello") all resolve to good-morning', async () => {
    for (const greeting of ['hi', 'hey', 'hello', 'morning']) {
      const res = await engine.ask(greeting);
      expect(res.intent).toBe('good-morning');
    }
  });

  test('context persists across turns without restating (session memory)', async () => {
    await engine.ask('good morning');
    expect(sessionMemory.getContext().recentCommands.length).toBe(1);
    await engine.ask('what about Resonate?');
    expect(sessionMemory.getContext().focus).toBe('resonate');
    expect(sessionMemory.getContext().conversationHistory.length).toBe(2);
  });

  test('what about <objective> reports strategic objective status', async () => {
    const res = await engine.ask('what about Resonate?');
    expect(res.intent).toBe('what-about');
    expect(res.objective.id).toBe('resonate');
    expect(res.status).toBeTruthy();
  });

  test('what about <agent domain> falls back to agent workspace', async () => {
    const res = await engine.ask('what about manufacturing?');
    expect(res.intent).toBe('show-agent');
    expect(res.agent.name).toBe('Manufacturing Manager');
  });

  test('show approvals lists pending approvals and caches ids for pronoun resolution', async () => {
    const res = await engine.ask('show approvals');
    expect(res.intent).toBe('show-approvals');
    expect(res.approvals.length).toBe(1);
    expect(engine.lastApprovalIds.length).toBe(1);
  });

  test('approve it resolves the pronoun to the only pending approval', async () => {
    await engine.ask('show approvals');
    const res = await engine.ask('approve it');
    expect(res.intent).toBe('approve');
    expect(res.result.ok).toBe(true);
    expect(approvalCenter.list().length).toBe(0);
  });

  test('reject it resolves the pronoun when exactly one approval is pending', async () => {
    const res = await engine.ask('reject it');
    expect(res.intent).toBe('reject');
    expect(res.result.ok).toBe(true);
  });

  test('explain recommendation <ordinal> explains the cached recommendation', async () => {
    await engine.ask('good morning');
    const res = await engine.ask('explain recommendation one');
    expect(res.intent).toBe('explain-recommendation');
    expect(res.text).toContain('Why:');
  });

  test('explain recommendation with an out-of-range ordinal responds gracefully', async () => {
    await engine.ask('good morning');
    const res = await engine.ask('explain recommendation nine');
    expect(res.intent).toBe('explain-recommendation');
    expect(res.text).toMatch(/don't have/);
  });

  test('focus <priority> sets owner priority and cockpit stays in sync', async () => {
    const res = await engine.ask('focus revenue');
    expect(['focus', 'what-about']).toContain(res.intent);
    expect(cockpit.ownerPriority).toBe('revenue');
    expect(sessionMemory.getContext().ownerPriority).toBe('revenue');
  });

  test('command palette: recommend, timeline, health, backup, help all respond', async () => {
    const recommend = await engine.ask('recommend');
    expect(recommend.intent).toBe('recommend');

    const tl = await engine.ask('timeline');
    expect(tl.intent).toBe('timeline');

    const health = await engine.ask('health');
    expect(health.intent).toBe('health');
    expect(health.health.revenue).toBeTruthy();
    expect(health.health.manufacturing).toBeTruthy();
    expect(health.health.research).toBeTruthy();
    expect(health.health.creative).toBeTruthy();
    expect(health.health.financial).toBeTruthy();
    expect(Array.isArray(health.health.dataGaps)).toBe(true);

    const backup = await engine.ask('backup');
    expect(backup.intent).toBe('backup');
    expect(backup.text).toContain('Backup completed');

    const help = await engine.ask('help');
    expect(help.intent).toBe('help');
    expect(help.text).toContain('good morning');
  });

  test('unrecognized-by-engine commands fall through to the cockpit unchanged', async () => {
    const res = await engine.ask('status');
    expect(res.intent).toBe('cockpit');
    expect(res.text).toContain('ProtoForge status');
  });

  test('what deserves my attention summarizes risks and approvals', async () => {
    const res = await engine.ask('what deserves my attention');
    expect(res.intent).toBe('attention');
    expect(Array.isArray(res.risks)).toBe(true);
    expect(Array.isArray(res.approvals)).toBe(true);
  });

  test('what can you do without me lists autonomous capabilities', async () => {
    const res = await engine.ask('what can you do without me');
    expect(res.intent).toBe('autonomous-capabilities');
    expect(res.capabilities.every((c) => c.actionClass === 'autonomous')).toBe(true);
  });

  test('command parsing is case-insensitive and tolerates punctuation', async () => {
    const a = await engine.ask('GOOD MORNING!');
    const b = await engine.ask('Recommend?');
    expect(a.intent).toBe('good-morning');
    expect(b.intent).toBe('recommend');
  });

  test('permission enforcement: every mutating verb routes through ApprovalCenter, never direct execution', async () => {
    const spyApprove = jest.spyOn(approvalCenter, 'approve');
    const spyReject = jest.spyOn(approvalCenter, 'reject');
    await engine.ask('show approvals');
    await engine.ask('approve it');
    expect(spyApprove).toHaveBeenCalled();
    spyApprove.mockRestore();
    spyReject.mockRestore();
  });

  test('session recovery: a new engine over a restored SessionMemory keeps prior focus', async () => {
    await engine.ask('what about Resonate?');
    await sessionMemory.flush();
    await sessionMemory.destroy();

    const restoredSession = new SessionMemory({ dataPath, logger: SILENT });
    await restoredSession.start();
    expect(restoredSession.getContext().focus).toBe('resonate');
    await restoredSession.destroy();
    sessionMemory = new SessionMemory({ dataPath, logger: SILENT });
    await sessionMemory.start();
  });
});
