'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const BusinessMemory = require('../../../src/hydi-v3/BusinessMemory');
const ExecutiveOperatingSystem = require('../../../src/hydi-v3/ExecutiveOperatingSystem');
const { SalesManager } = require('../../../src/hydi-v3/ExecutiveAgents');

describe('ExecutiveOperatingSystem', () => {
  let osInstance;
  let memory;
  let dataPath;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `heidi-exec-os-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
    memory = new BusinessMemory({ dataPath, logger: { log: () => {}, error: () => {} } });
    await memory.start();
    osInstance = new ExecutiveOperatingSystem({
      dataPath,
      businessMemory: memory,
      logger: { log: () => {}, error: () => {} },
    });
  });

  afterEach(async () => {
    if (osInstance) await osInstance.destroy().catch(() => {});
    if (memory) await memory.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    osInstance = null;
    memory = null;
  });

  test('lifecycle methods work', async () => {
    await osInstance.initialize();
    expect(osInstance._started).toBe(true);
    expect(osInstance.healthCheck().ok).toBe(true);
    await osInstance.flush();
    osInstance.stop();
    expect(osInstance._started).toBe(false);
    await osInstance.destroy();
    expect(osInstance._destroyed).toBe(true);
  });

  test('registers eight default agents', () => {
    expect(osInstance.agents.size).toBe(8);
    expect(osInstance.agents.has('Sales Manager')).toBe(true);
    expect(osInstance.agents.has('Technical Architect')).toBe(true);
  });

  test('adds and removes agents', () => {
    const agent = new SalesManager();
    agent.name = 'Extra Sales';
    osInstance.addAgent(agent);
    expect(osInstance.agents.has('Extra Sales')).toBe(true);
    expect(osInstance.removeAgent('Extra Sales')).toBe(true);
    expect(osInstance.removeAgent('Missing')).toBe(false);
  });

  test('generates morning briefing', () => {
    const briefing = osInstance.morningBriefing();
    expect(briefing.generatedAt).toBeTruthy();
    expect(briefing.protoForgeStatus).toBeTruthy();
    expect(Array.isArray(briefing.priorityActions)).toBe(true);
    expect(Array.isArray(briefing.risks)).toBe(true);
    expect(Array.isArray(briefing.recommendations)).toBe(true);
    expect(briefing.agentReports).toBeTruthy();
  });

  test('produces natural text briefing', () => {
    memory.put({ type: 'opportunity', name: 'Big Deal', value: 5000, effort: 2, risk: 0.1 });
    const briefing = osInstance.morningBriefing();
    const text = osInstance.toText(briefing);
    expect(text).toContain('ProtoForge status');
    expect(text).toContain('Big Deal');
    expect(text).toContain('Top Opportunities');
    expect(text).toContain('Critical Risks');
    expect(text).toContain('Recommended Actions');
  });

  test('priority actions rank high-value opportunities', () => {
    const low = memory.put({ type: 'opportunity', name: 'Low', value: 100, effort: 1, risk: 0 });
    const high = memory.put({ type: 'opportunity', name: 'High', value: 1000, effort: 1, risk: 0 });
    const actions = osInstance.priorityActions(2);
    expect(actions[0].id).toBe(high);
    expect(actions[1].id).toBe(low);
  });

  test('detects deadline, equipment, and blocked-project risks', () => {
    const printer = memory.put({ type: 'equipment', name: 'Printer', status: 'maintenance' });
    memory.put({ type: 'project', name: 'Widget', status: 'active', payload: { deadline: Date.now() - 1000 } });
    const dependent = memory.put({ type: 'project', name: 'Dependent', status: 'active' });
    memory.relate(dependent, printer, 'depends-on');

    const risks = osInstance.risks();
    const categories = risks.map((r) => r.category);
    expect(categories).toContain('deadline');
    expect(categories).toContain('resource-conflict');
    expect(categories).toContain('equipment');
  });

  test('recommends top action and lead follow-up', () => {
    memory.put({ type: 'opportunity', name: 'Upsell', value: 2000, effort: 1, risk: 0 });
    memory.put({ type: 'client', name: 'Lead A', tags: ['lead'], status: 'active' });
    const briefing = osInstance.morningBriefing();
    expect(briefing.recommendations.length).toBeGreaterThanOrEqual(2);
    expect(briefing.recommendations[0].action).toContain('Upsell');
  });

  test('persists and restores briefing history', async () => {
    await osInstance.start();
    osInstance.morningBriefing();
    await osInstance.destroy();

    const restored = new ExecutiveOperatingSystem({
      dataPath,
      businessMemory: memory,
      logger: { log: () => {}, error: () => {} },
    });
    await restored.start();
    expect(restored.lastBriefing).toBeTruthy();
    expect(restored.decisions.length).toBeGreaterThan(0);
    await restored.destroy();
  });

  test('recovers from corrupted persistence', async () => {
    const file = path.join(dataPath, 'executive-os.json');
    await fs.writeFile(file, 'not-json { corrupted');
    const recovered = new ExecutiveOperatingSystem({
      dataPath,
      businessMemory: memory,
      logger: { log: () => {}, error: () => {} },
    });
    await expect(recovered.start()).resolves.toBeUndefined();
    expect(recovered.healthCheck().ok).toBe(true);
    await recovered.destroy();
  });

  test('benchmark: generates 100 briefings in under one second', () => {
    memory.put({ type: 'opportunity', name: 'A', value: 100, effort: 1, risk: 0 });
    memory.put({ type: 'project', name: 'P', status: 'active' });
    const start = Date.now();
    for (let i = 0; i < 100; i += 1) {
      osInstance.morningBriefing();
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });

  test('consumes BusinessSignal events and surfaces activity in briefings', async () => {
    const BusinessEventBus = require('../../../src/hydi-v3/BusinessEventBus');
    const bus = new BusinessEventBus({ maxHistory: 100 });
    const osWithBus = new ExecutiveOperatingSystem({
      dataPath,
      businessMemory: memory,
      eventBus: bus,
      logger: { log: () => {}, error: () => {} },
    });
    await osWithBus.start();

    bus.emit('BusinessSignal', {
      interpretation: 'Resonate Audio Engine updated',
      strategicObjective: 'resonate',
      subsystem: 'Audio Engine',
      project: 'Resonate',
      fileCategory: 'source',
      originatingEvent: 'FileModified',
      impact: 'engineering-progress',
    }, 'Test');

    const briefing = osWithBus.morningBriefing();
    expect(briefing.recentActivity).toContain('1 activity signal for resonate.');
    expect(briefing.recentActivity.some((l) => l.includes('Audio Engine'))).toBe(true);
    await osWithBus.destroy();
    bus.destroy();
  });

  test('source contains no printer-specific code', () => {
    const eosSource = require('fs').readFileSync(
      require.resolve('../../../src/hydi-v3/ExecutiveOperatingSystem'), 'utf8',
    );
    const printerTerms = /\bprinter\b|\bcreality\b|\boctoprint\b|\bmoonraker\b|\bklipper\b|\bfilament\b/i;
    expect(printerTerms.test(eosSource)).toBe(false);
  });
});
