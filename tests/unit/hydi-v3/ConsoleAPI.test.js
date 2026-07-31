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
const ConsoleAPI = require('../../../src/hydi-v3/ConsoleAPI');

const SILENT = { log: () => {}, error: () => {}, warn: () => {} };

describe('ConsoleAPI', () => {
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
  let api;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `heidi-consoleapi-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });

    strategicObjectives = new StrategicObjectives({ ownerPriority: 'default' });
    memory = new BusinessMemory({ dataPath, strategicObjectives, logger: SILENT });
    await memory.start();
    memory.put({ type: 'opportunity', name: 'Acme deal', status: 'active', value: 5000 });

    executiveOS = new ExecutiveOperatingSystem({ dataPath, businessMemory: memory, strategicObjectives, logger: SILENT });
    await executiveOS.start();
    executionGateway = new ExecutionGateway({ dataPath, businessMemory: memory, logger: SILENT });
    await executionGateway.start();
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

    api = new ConsoleAPI({
      conversationEngine: engine, approvalCenter, timeline, agentWorkspace, sessionMemory, executiveOS, dataPath, logger: SILENT,
    });
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

  test('healthCheck reflects wired dependencies', () => {
    expect(api.healthCheck().ok).toBe(true);
    const bare = new ConsoleAPI({});
    expect(bare.healthCheck().ok).toBe(false);
  });

  test('goodMorning/ask are the same entry point used by both CLI and web (API consistency)', async () => {
    const viaGoodMorning = await api.goodMorning();
    const viaAsk = await api.ask('good morning');
    expect(viaGoodMorning.intent).toBe('good-morning');
    expect(viaAsk.intent).toBe('good-morning');
  });

  test('command palette lists the required verbs', () => {
    const palette = api.getCommandPalette();
    const commands = palette.map((c) => c.command);
    for (const required of ['good morning', 'status', 'show approvals', 'timeline', 'recommend', 'simulate [<id>]', 'health', 'backup', 'help']) {
      expect(commands.some((c) => c === required)).toBe(true);
    }
  });

  test('getAgents exposes all eight agents', () => {
    expect(api.getAgents().length).toBe(8);
  });

  test('getHealth surfaces all required business health sections', () => {
    const health = api.getHealth();
    for (const key of ['revenue', 'manufacturing', 'research', 'creative', 'financial', 'dataGaps']) {
      expect(health).toHaveProperty(key);
    }
  });

  test('approvals: list/approve/reject/simulate/explain delegate to ApprovalCenter', async () => {
    await executionGateway.execute({ type: 'draft-email', params: {}, requestingAgent: 'Sales Manager' });
    const approvals = api.getApprovals();
    expect(approvals.length).toBe(1);
    const sim = await api.simulate(approvals[0].id);
    expect(sim.ok).toBe(true);
    const explained = api.explainApproval(approvals[0].id);
    expect(explained.ok).toBe(true);
    const result = await api.approve(approvals[0].id);
    expect(result.ok).toBe(true);
    expect(api.getApprovals().length).toBe(0);
  });

  test('getSessionState reflects SessionMemory and restores after restart', async () => {
    await api.ask('focus revenue');
    expect(api.getSessionState().ownerPriority).toBe('revenue');
    await sessionMemory.destroy();

    const restoredSession = new SessionMemory({ dataPath, logger: SILENT });
    await restoredSession.start();
    expect(restoredSession.getContext().ownerPriority).toBe('revenue');
    await restoredSession.destroy();
    sessionMemory = new SessionMemory({ dataPath, logger: SILENT });
    await sessionMemory.start();
  });

  test('backup copies known stores and records exactly one timeline entry per call', async () => {
    const result = await api.backup();
    expect(result.ok).toBe(true);
    const stat = await fs.stat(result.dir);
    expect(stat.isDirectory()).toBe(true);
    expect(api.getTimeline({ category: 'backup' }).length).toBe(1);

    await api.ask('backup');
    expect(api.getTimeline({ category: 'backup' }).length).toBe(2);
  });

  test('setWindowLayout persists layout via SessionMemory', () => {
    api.setWindowLayout({ approvalsCollapsed: true });
    expect(api.getSessionState().windowLayout.approvalsCollapsed).toBe(true);
  });
});
