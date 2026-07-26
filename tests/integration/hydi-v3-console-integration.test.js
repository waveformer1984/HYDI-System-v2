'use strict';

/**
 * Integration coverage for HYDI Phase 15 — the Local Operations Console.
 *
 * Exercises the full OperatorSession stack (BusinessMemory,
 * ExecutiveOperatingSystem, ExecutionGateway, BusinessWorkflowEngine,
 * ExecutiveCockpit, plus the new ExecutiveTimeline, AgentWorkspace,
 * ApprovalCenter, SessionMemory, ConversationEngine, ConsoleAPI) the way the
 * CLI and the web console actually consume it, rather than any component in
 * isolation.
 */

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const OperatorSession = require('../../src/hydi-v3/OperatorSession');
const { isLocalRequest } = require('../../src/hydi-v3/localAccessGuard');

const SILENT = { log: () => {}, error: () => {}, warn: () => {} };

describe('HYDI Phase 15: Local Operations Console integration', () => {
  let dataPath;
  let session;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `hydi-console-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
    session = new OperatorSession({ dataPath, logger: SILENT });
    await session.start();
  });

  afterEach(async () => {
    if (session) await session.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  test('OperatorSession wires every Phase 15 component and reports healthy', () => {
    const health = session.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.checks.timeline).toBe(true);
    expect(health.checks.agentWorkspace).toBe(true);
    expect(health.checks.approvalCenter).toBe(true);
    expect(health.checks.sessionMemory).toBe(true);
    expect(health.checks.conversationEngine).toBe(true);
    expect(health.checks.consoleAPI).toBe(true);
  });

  test('conversation flow: greeting produces the complete briefing and follow-ups keep context', async () => {
    const morning = await session.ask('good morning');
    expect(morning.intent).toBe('good-morning');
    expect(morning.briefing).toBeTruthy();

    const about = await session.ask('what about Resonate?');
    expect(about.intent).toBe('what-about');
    expect(session.sessionMemory.getContext().focus).toBe('resonate');

    const recommend = await session.ask('recommend');
    expect(recommend.intent).toBe('recommend');
  });

  test('API consistency: session.ask and session.consoleAPI.ask are the same call path', async () => {
    const a = await session.ask('status');
    const b = await session.consoleAPI.ask('status');
    expect(a.intent).toBe(b.intent);
    expect(a.text).toBe(b.text);
  });

  test('command parsing covers the required command palette verbs', async () => {
    const commands = ['good morning', 'status', 'focus resonate', 'focus revenue', 'focus manufacturing',
      'show approvals', 'timeline', 'recommend', 'simulate', 'health', 'backup', 'help'];
    for (const cmd of commands) {
      const res = await session.ask(cmd);
      expect(res.text).toBeTruthy();
    }
  });

  test('approval workflow: a review-required action is queued, appears in the Approval Center, and can be approved through conversation', async () => {
    await session.executionGateway.execute({
      type: 'draft-email', params: { to: 'client@example.com' }, requestingAgent: 'Sales Manager',
    });

    const approvals = session.consoleAPI.getApprovals();
    expect(approvals.length).toBe(1);
    expect(approvals[0]).toHaveProperty('businessValue');
    expect(approvals[0]).toHaveProperty('risk');
    expect(approvals[0]).toHaveProperty('responsibleAgent');
    expect(approvals[0]).toHaveProperty('executionPlan');

    const shown = await session.ask('show approvals');
    expect(shown.approvals.length).toBe(1);

    const approved = await session.ask('approve it');
    expect(approved.intent).toBe('approve');
    expect(approved.result.ok).toBe(true);
    expect(session.consoleAPI.getApprovals().length).toBe(0);
  });

  test('executive timeline records execution, approval, and briefing events in order', async () => {
    await session.ask('good morning');
    await session.executionGateway.execute({ type: 'create-report', params: {}, requestingAgent: 'Ops' });
    await session.executionGateway.execute({ type: 'draft-email', params: {}, requestingAgent: 'Sales Manager' });

    const timeline = session.consoleAPI.getTimeline({});
    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline.some((t) => t.category === 'briefing')).toBe(true);
    expect(timeline.some((t) => t.category === 'execution')).toBe(true);
    expect(timeline.some((t) => t.category === 'approval')).toBe(true);

    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i - 1].at).toBeGreaterThanOrEqual(timeline[i].at);
    }
  });

  test('dashboard accuracy: cockpit dashboard and ApprovalCenter agree on pending approval counts', async () => {
    await session.executionGateway.execute({ type: 'draft-email', params: {}, requestingAgent: 'Sales Manager' });
    const dashboard = session.cockpit.getDashboardData();
    const approvals = session.consoleAPI.getApprovals();
    expect(dashboard.pendingApprovals).toBe(approvals.length);
  });

  test('business health never fabricates missing sections', () => {
    const health = session.consoleAPI.getHealth();
    for (const key of ['revenue', 'manufacturing', 'research', 'creative', 'financial', 'dataGaps']) {
      expect(health).toHaveProperty(key);
    }
    expect(Array.isArray(health.dataGaps)).toBe(true);
  });

  test('agent workspace exposes all eight agents with explainability', () => {
    const agents = session.consoleAPI.getAgents();
    expect(agents.length).toBe(8);
    const detail = session.consoleAPI.getAgent('Manufacturing Manager');
    expect(detail.explainability).toBeTruthy();
    expect(Array.isArray(detail.priorities)).toBe(true);
  });

  test('session recovery: focus, priority, and history survive a full session restart', async () => {
    await session.ask('focus revenue');
    await session.ask('what changed');
    await session.sessionMemory.flush();
    await session.destroy();

    const restored = new OperatorSession({ dataPath, logger: SILENT });
    await restored.start();
    const ctx = restored.sessionMemory.getContext();
    expect(ctx.ownerPriority).toBe('revenue');
    expect(ctx.recentCommands.length).toBeGreaterThanOrEqual(2);
    expect(ctx.conversationHistory.length).toBeGreaterThanOrEqual(2);
    await restored.destroy();
    session = null;
  });

  test('permission enforcement: only loopback requests are treated as local', () => {
    expect(isLocalRequest({
      headers: { host: 'localhost:3000' },
      socket: { remoteAddress: '127.0.0.1' },
    })).toBe(true);

    expect(isLocalRequest({
      headers: { host: 'localhost:3000', 'x-forwarded-for': '203.0.113.5' },
      socket: { remoteAddress: '127.0.0.1' },
    })).toBe(false);

    expect(isLocalRequest({
      headers: { host: 'example.com' },
      socket: { remoteAddress: '203.0.113.5' },
    })).toBe(false);
  });

  test('regression: pre-Phase-15 ExecutiveCockpit commands still work unchanged through the session', async () => {
    const status = await session.ask('status');
    expect(status.text).toContain('ProtoForge status');
    const workflows = await session.ask('workflows');
    expect(workflows.text).toBeTruthy();
    const priority = await session.ask('priority manufacturing');
    expect(priority.text).toContain('manufacturing');
    expect(session.cockpit.ownerPriority).toBe('manufacturing');
  });

  test('performance: startup, briefing, and recommendation refresh meet Phase 15 targets', async () => {
    // session already started in beforeEach — measure a second, independent
    // session so the startup timing is not affected by jest's own warm-up.
    const perfDataPath = path.join(os.tmpdir(), `hydi-console-perf-${Date.now()}`);
    await fs.mkdir(perfDataPath, { recursive: true });
    const perfSession = new OperatorSession({ dataPath: perfDataPath, logger: SILENT });

    const t0 = Date.now();
    await perfSession.start();
    const startupMs = Date.now() - t0;

    const t1 = Date.now();
    await perfSession.ask('good morning');
    const briefingMs = Date.now() - t1;

    const t2 = Date.now();
    perfSession.consoleAPI.getApprovals();
    perfSession.consoleAPI.getHealth();
    const refreshMs = Date.now() - t2;

    await perfSession.destroy();
    await fs.rm(perfDataPath, { recursive: true, force: true }).catch(() => {});

    expect(startupMs).toBeLessThan(2000);
    expect(briefingMs).toBeLessThan(500);
    expect(refreshMs).toBeLessThan(250);
  });
});
