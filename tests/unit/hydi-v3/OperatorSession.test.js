'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const OperatorSession = require('../../../src/hydi-v3/OperatorSession');
const OperatorCLI = require('../../../src/hydi-v3/OperatorCLI');
const BriefingRenderer = require('../../../src/hydi-v3/BriefingRenderer');

const silent = { log: () => {}, error: () => {}, warn: () => {} };

describe('OperatorSession', () => {
  let session;
  let dataPath;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `heidi-operator-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
    session = new OperatorSession({ dataPath, logger: silent, taskIntervalMs: 10 });
    await session.start();
  });

  afterEach(async () => {
    if (session) await session.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    session = null;
  });

  test('boots the whole executive stack', () => {
    expect(session.memory).toBeTruthy();
    expect(session.executiveOS).toBeTruthy();
    expect(session.taskEngine).toBeTruthy();
    expect(session.workflowEngine).toBeTruthy();
    expect(session.executionGateway).toBeTruthy();
    expect(session.cockpit).toBeTruthy();
    expect(session.healthCheck().ok).toBe(true);
  });

  test('every component shares one StrategicObjectives instance', () => {
    const shared = session.strategicObjectives;
    expect(session.memory.strategicObjectives).toBe(shared);
    expect(session.executiveOS.strategicObjectives).toBe(shared);
    expect(session.workflowEngine.strategicObjectives).toBe(shared);
    expect(session.cockpit.strategicObjectives).toBe(shared);
  });

  test('start is idempotent', async () => {
    const memory = session.memory;
    await session.start();
    expect(session.memory).toBe(memory);
  });

  test('briefing renders as text and HTML from the same object', () => {
    const briefing = session.briefing();
    expect(briefing).toHaveProperty('executiveSummary');
    expect(session.briefingText({ colour: false })).toContain('=== Executive Summary ===');
    expect(session.briefingHtml()).toContain('Executive Summary');
  });

  test('ask routes through the cockpit command surface', async () => {
    const response = await session.ask('help');
    expect(response.text).toContain('Available commands');
    expect(session.cockpit.interactions.length).toBeGreaterThan(0);
  });

  test('owner priority propagates to the shared objectives registry', async () => {
    const priorityDataPath = path.join(dataPath, 'priority');
    const scoped = new OperatorSession({
      dataPath: priorityDataPath, logger: silent, taskIntervalMs: 10, ownerPriority: 'resonate',
    });
    await scoped.start();
    try {
      expect(scoped.cockpit.ownerPriority).toBe('resonate');
      expect(scoped.strategicObjectives.ownerPriority).toBe('resonate');
      expect(scoped.memory.strategicObjectives.ownerPriority).toBe('resonate');
    } finally {
      await scoped.destroy();
    }
  });

  test('scoring stays consistent across memory and briefing', () => {
    session.memory.put({
      type: 'opportunity', name: 'Resonate launch bundle', status: 'active', value: 9000, effort: 2, risk: 1,
    });
    const briefing = session.briefing();
    const action = briefing.priorityActions.find((a) => a.name === 'Resonate launch bundle');
    expect(action).toBeTruthy();
    expect(action.reason).toBeTruthy();
    // The briefing must reuse the shared registry's score, not recompute one.
    const entity = session.memory.find({ type: 'opportunity' }).find((e) => e.name === 'Resonate launch bundle');
    expect(action.score).toBe(session.memory._score(entity));
  });

  test('every scored priority action carries a reason', () => {
    session.memory.put({ type: 'opportunity', name: 'Bundle A', status: 'active', value: 4000, effort: 1, risk: 1 });
    session.memory.put({ type: 'task', name: 'Blocked task', status: 'blocked', value: 100, effort: 1, risk: 1 });
    for (const action of session.briefing().priorityActions) {
      expect(action.reason).toBeTruthy();
      expect(typeof action.score).toBe('number');
    }
  });

  test('summary health matches the rendered status line', () => {
    session.memory.put({ type: 'equipment', name: 'Prusa MK4', status: 'maintenance' });
    const briefing = session.briefing();
    const text = BriefingRenderer.toText(briefing);
    const health = BriefingRenderer.healthOf(briefing);
    expect(text).toContain(`ProtoForge status: ${health}.`);
    expect(briefing.executiveSummary).toContain(`ProtoForge is ${health}.`);
  });

  test('rejects use before start and after destroy', async () => {
    const cold = new OperatorSession({ dataPath: path.join(dataPath, 'cold'), logger: silent });
    expect(() => cold.briefing()).toThrow('not started');

    await session.destroy();
    expect(() => session.briefing()).toThrow('destroyed');
    await expect(session.start()).rejects.toThrow('destroyed');
  });

  test('destroy is idempotent', async () => {
    await session.destroy();
    await expect(session.destroy()).resolves.toBeUndefined();
  });
});

describe('OperatorCLI', () => {
  let session;
  let cli;
  let dataPath;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `heidi-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
    session = new OperatorSession({ dataPath, logger: silent, taskIntervalMs: 10 });
    await session.start();
    cli = new OperatorCLI(session, { colour: false });
  });

  afterEach(async () => {
    if (session) await session.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    session = null;
    cli = null;
  });

  test('requires a session', () => {
    expect(() => new OperatorCLI(null)).toThrow('requires an OperatorSession');
  });

  test('classifies exit, briefing, empty and cockpit intents', () => {
    for (const word of ['exit', 'quit', 'BYE', ':q']) {
      expect(cli.parse(word).intent).toBe('exit');
    }
    for (const phrase of ['good morning', 'Good Morning!', 'morning', 'briefing', 'brief']) {
      expect(cli.parse(phrase).intent).toBe('briefing');
    }
    for (const blank of ['', '   ', null, undefined]) {
      expect(cli.parse(blank).intent).toBe('empty');
    }
    for (const passthrough of ['focus', 'status', 'approve abc', 'priority resonate', 'nonsense']) {
      expect(cli.parse(passthrough).intent).toBe('cockpit');
    }
  });

  test('"good morning" returns the full multi-section briefing', async () => {
    const result = await cli.handle('good morning');
    expect(result.done).toBe(false);
    expect(result.output).toContain('=== Executive Summary ===');
    expect(result.output).toContain('=== Strategic Objectives ===');
    expect(result.output).toContain('=== Critical Risks ===');
    expect(result.output).toContain('=== Recommended Actions ===');
    expect(result.output).toContain('=== Missing Data Sources ===');
  });

  test('exit signals completion without touching the session', async () => {
    const result = await cli.handle('exit');
    expect(result.done).toBe(true);
    expect(session.healthCheck().ok).toBe(true);
  });

  test('blank input produces no output and does not end the loop', async () => {
    const result = await cli.handle('   ');
    expect(result).toEqual({ output: '', done: false, intent: 'empty' });
  });

  test('unknown commands are delegated to the cockpit, not invented locally', async () => {
    // 'do the thing' is no longer a valid example here: ConversationEngine's
    // conversational action-creation intent (`do <x>`) now legitimately
    // intercepts any "do ..." phrase to create a real action. Use a phrase
    // that matches none of ConversationEngine's routes instead.
    const result = await cli.handle('xyzzy plugh frobnicate');
    expect(result.output).toContain('I did not understand');
  });

  test('cockpit commands round-trip', async () => {
    expect((await cli.handle('help')).output).toContain('Available commands');
    expect((await cli.handle('status')).output).toContain('ProtoForge status');
    expect((await cli.handle('approvals')).output).toContain('No pending approvals');
    expect((await cli.handle('priority resonate')).output).toContain('resonate');
  });

  test('errors are reported without crashing the loop', async () => {
    const broken = new OperatorCLI({
      briefing: () => { throw new Error('memory offline'); },
      ask: async () => { throw new Error('gateway offline'); },
    }, { colour: false });

    const briefingResult = await broken.handle('good morning');
    expect(briefingResult.done).toBe(false);
    expect(briefingResult.output).toBe('Error: memory offline');

    const askResult = await broken.handle('status');
    expect(askResult.done).toBe(false);
    expect(askResult.output).toBe('Error: gateway offline');
  });

  test('colour mode emits ANSI, plain mode does not', async () => {
    const colourCli = new OperatorCLI(session, { colour: true });
    expect((await colourCli.handle('good morning')).output).toMatch(new RegExp(String.fromCharCode(0x1b) + '\\['));
    expect((await cli.handle('good morning')).output).not.toMatch(new RegExp(String.fromCharCode(0x1b) + '\\['));
  });
});
