'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const BusinessMemory = require('../../../src/hydi-v3/BusinessMemory');
const ExecutiveOperatingSystem = require('../../../src/hydi-v3/ExecutiveOperatingSystem');
const { ExecutionGateway } = require('../../../src/hydi-v3/ExecutionGateway');
const { BusinessWorkflowEngine } = require('../../../src/hydi-v3/BusinessWorkflowEngine');
const AgentWorkspace = require('../../../src/hydi-v3/AgentWorkspace');

const SILENT = { log: () => {}, error: () => {}, warn: () => {} };

describe('AgentWorkspace', () => {
  let dataPath;
  let memory;
  let executiveOS;
  let executionGateway;
  let workflowEngine;
  let workspace;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `heidi-agentws-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });

    memory = new BusinessMemory({ dataPath, logger: SILENT });
    await memory.start();
    memory.put({ type: 'task', name: 'Fix printer', status: 'blocked', value: 500, tags: ['blocker'] });
    memory.put({ type: 'task', name: 'Ship order', status: 'active', value: 200 });
    memory.put({ type: 'equipment', name: 'Printer A', status: 'maintenance', tags: ['system'] });
    memory.put({ type: 'opportunity', name: 'Acme deal', status: 'active', value: 5000 });
    memory.put({ type: 'client', name: 'Acme Corp', status: 'active', tags: ['lead'] });

    executiveOS = new ExecutiveOperatingSystem({ dataPath, businessMemory: memory, logger: SILENT });
    await executiveOS.start();

    executionGateway = new ExecutionGateway({ dataPath, businessMemory: memory, logger: SILENT });
    await executionGateway.start();
    await executionGateway.execute({ type: 'create-report', params: {}, requestingAgent: 'Manufacturing Manager' });

    workflowEngine = new BusinessWorkflowEngine({ dataPath, businessMemory: memory, executiveOS, logger: SILENT });
    await workflowEngine.start();
    const wfId = workflowEngine.createWorkflow({
      type: 'manufacturing', title: 'Restock filament', assignedAgent: 'Manufacturing Manager', expectedValue: 300,
    });
    workflowEngine.workflows.get(wfId).status = 'awaiting-approval';

    workspace = new AgentWorkspace({ executiveOS, executionGateway, workflowEngine });
  });

  afterEach(async () => {
    await workflowEngine.destroy().catch(() => {});
    await executionGateway.destroy().catch(() => {});
    await executiveOS.destroy().catch(() => {});
    await memory.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  test('lists all eight executive agents', () => {
    expect(workspace.listAgentNames().length).toBe(8);
    expect(workspace.healthCheck().ok).toBe(true);
  });

  test('getAgent returns priorities, recent/pending work, and explainability', () => {
    const mfg = workspace.getAgent('Manufacturing Manager');
    expect(mfg.available).toBe(true);
    expect(mfg.priorities.length).toBeGreaterThan(0);
    expect(mfg.explainability).toEqual(expect.any(String));
    expect(mfg.recentWork.length).toBeGreaterThanOrEqual(1);
    expect(mfg.pendingWork.length).toBeGreaterThanOrEqual(1);
    expect(typeof mfg.confidence).toBe('number');
    expect(mfg.confidence).toBeGreaterThanOrEqual(0.1);
    expect(mfg.confidence).toBeLessThanOrEqual(0.95);
  });

  test('getAgent throws for unknown agent name', () => {
    expect(() => workspace.getAgent('Nope')).toThrow('Unknown agent');
  });

  test('findAgentByQuery resolves free-text domain words', () => {
    expect(workspace.findAgentByQuery('manufacturing')).toBe('Manufacturing Manager');
    expect(workspace.findAgentByQuery('revenue')).toBe('Sales Manager');
    expect(workspace.findAgentByQuery('nonsense-domain')).toBeNull();
  });

  test('listAgents returns a summary for every agent', () => {
    const all = workspace.listAgents();
    expect(all.length).toBe(8);
    expect(all.every((a) => a.available)).toBe(true);
    expect(all.every((a) => typeof a.confidence === 'number')).toBe(true);
  });

  test('never fabricates data when dependencies are missing', () => {
    const bare = new AgentWorkspace({});
    expect(bare.healthCheck().ok).toBe(false);
    const result = bare.getAgent('Sales Manager');
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/not connected/i);
  });

  test('recommendations carry full explainability fields', () => {
    memory.put({ type: 'opportunity', name: 'Big printer order', status: 'active', value: 6000, tags: ['manufacturing'] });
    const mfg = workspace.getAgent('Manufacturing Manager');
    for (const rec of mfg.recommendations) {
      expect(rec).toHaveProperty('why');
      expect(rec).toHaveProperty('expectedOutcome');
      expect(rec).toHaveProperty('businessImpact');
      expect(rec).toHaveProperty('risk');
      expect(rec).toHaveProperty('estimatedEffort');
      expect(rec).toHaveProperty('strategicObjective');
      expect(rec).toHaveProperty('confidence');
      expect(rec).toHaveProperty('requiredApproval');
    }
  });
});
