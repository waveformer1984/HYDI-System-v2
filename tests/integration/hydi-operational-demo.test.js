'use strict';

/**
 * Deliverable 4 of the HYDI Operational Readiness Certification (Phase 22):
 * an end-to-end demonstration that HYDI can observe a realistic ProtoForge
 * day and produce a useful executive briefing from it, not a hello-world
 * smoke test. Every event is driven through the real BusinessEventBus so it
 * passes through the actual BusinessSignalInterpreter /
 * ManufacturingSignalInterpreter / BusinessMemory sync pipeline exactly as a
 * live sensor's event would — none of that pipeline is re-implemented here.
 *
 * There is no event-sourced "sales inquiry" signal path anywhere in this
 * codebase (opportunities are created directly via `BusinessMemory.put`), so
 * the opportunity scenario below uses that existing API rather than
 * inventing a new sensor/event type.
 */

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const OperatorSession = require('../../src/hydi-v3/OperatorSession');

const SILENT = { log: () => {}, error: () => {}, warn: () => {} };

describe('HYDI operational demonstration: a realistic ProtoForge day', () => {
  let dataPath;
  let session;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `hydi-operational-demo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
    session = new OperatorSession({ dataPath, logger: SILENT });
    await session.start();
  });

  afterEach(async () => {
    if (session) await session.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  test('Resonate development activity produces a BusinessSignal and updates the tracked project', () => {
    const signals = [];
    session.eventBus.subscribe('BusinessSignal', (event) => signals.push(event));

    session.eventBus.emit('CommitCreated', {
      project: 'Resonate',
      message: 'Major feature: real-time waveform rendering',
    }, 'GitSensor');

    expect(signals.length).toBe(1);
    expect(signals[0].payload.strategicObjective).toBe('resonate');

    const project = session.memory.get('project_resonate');
    expect(project).toBeTruthy();
    expect(project.status).toBe('active');
  });

  test('printer downtime produces an elevated-risk signal and an offline equipment record', () => {
    const signals = [];
    session.eventBus.subscribe('BusinessSignal', (event) => signals.push(event));

    session.eventBus.emit('PrinterOffline', {
      equipmentId: 'printer-1',
      equipmentName: '3D Printer',
    }, 'PrinterSensor');

    expect(signals.length).toBe(1);
    expect(signals[0].payload.risk).toBe('elevated');
    expect(signals[0].payload.impact).toBe('risk-equipment-offline');

    const equipment = session.memory.get('equipment_printer-1');
    expect(equipment).toBeTruthy();
    expect(equipment.status).toBe('offline');
  });

  test('a customer payment produces a positive revenue signal and a financial memory update', () => {
    const signals = [];
    session.eventBus.subscribe('BusinessSignal', (event) => signals.push(event));

    session.eventBus.emit('RevenueReceived', {
      amount: 2500,
      currency: 'USD',
      customer: 'Acme Corp',
    }, 'RevenueSensor');

    expect(signals.length).toBe(1);
    expect(signals[0].payload.amount).toBe(2500);

    const financial = session.memory.get('financial_acme-corp');
    expect(financial).toBeTruthy();
    expect(financial.value).toBeGreaterThanOrEqual(2500);

    const client = session.memory.get('client_acme-corp');
    expect(client).toBeTruthy();
  });

  test('a full ProtoForge day assembles into one coherent "good morning" executive briefing', async () => {
    // 1. Resonate development activity
    session.eventBus.emit('CommitCreated', {
      project: 'Resonate',
      message: 'Major feature: real-time waveform rendering',
    }, 'GitSensor');

    // 2. Manufacturing downtime
    session.eventBus.emit('PrinterOffline', {
      equipmentId: 'printer-1',
      equipmentName: '3D Printer',
    }, 'PrinterSensor');

    // 3. Revenue received
    session.eventBus.emit('RevenueReceived', {
      amount: 2500,
      currency: 'USD',
      customer: 'Acme Corp',
    }, 'RevenueSensor');

    // 4. New sales opportunity (direct BusinessMemory API — see file header)
    session.memory.put({
      type: 'opportunity',
      name: 'New customer inquiry — Acme Corp expansion',
      value: 5000,
      status: 'open',
    });

    const result = await session.ask('Good morning');
    expect(result.intent).toBe('good-morning');
    const briefing = result.briefing;

    // Resonate progress
    expect(briefing.resonateStatus).toBeTruthy();
    expect(briefing.resonateStatus.tracked).toBe(true);

    // Equipment risk
    const equipmentRisks = briefing.risks.filter((r) => r.category === 'equipment');
    expect(equipmentRisks.length).toBeGreaterThan(0);
    expect(equipmentRisks[0].severity).toBe('high');

    // Revenue update landed in financial memory
    const financial = session.memory.get('financial_acme-corp');
    expect(financial.value).toBeGreaterThanOrEqual(2500);

    // Opportunities show up among priority actions
    expect(briefing.priorityActions.length).toBeGreaterThan(0);
    const opportunityAction = briefing.priorityActions.find((a) => a.type === 'opportunity');
    expect(opportunityAction).toBeTruthy();

    // Recommended priorities + confidence levels
    expect(briefing.recommendations.length).toBeGreaterThan(0);

    // The rendered text is a real, human-readable artifact of all of the above.
    expect(result.text).toEqual(expect.stringContaining('Resonate'));
  });
});
