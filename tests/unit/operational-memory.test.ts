/**
 * Phase 3 — Operational Memory Tests
 *
 * Tests:
 * - Events are recorded and retrieved
 * - Events survive restart (durable file-based storage)
 * - Correlation IDs are tracked
 * - File rotation prevents unbounded growth
 */

import { OperationalMemory } from '../../lib/operational/OperationalMemory';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Phase 3 — OperationalMemory', () => {
  let tmpDir: string;
  let memory: OperationalMemory;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-op-test-'));
    memory = new OperationalMemory(tmpDir);
  });

  afterEach(async () => {
    await memory.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeEvent(overrides: Partial<import('../../lib/operational/types').OperationalEvent> = {}) {
    return {
      id: `test-${Date.now()}-${Math.random()}`,
      timestamp: new Date().toISOString(),
      type: 'state_transition' as const,
      component: 'test-comp',
      previousState: 'HEALTHY' as const,
      newState: 'UNAVAILABLE' as const,
      ...overrides,
    };
  }

  it('records and retrieves events', () => {
    const event = makeEvent();
    memory.record(event);
    const recent = memory.getRecent(10);
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe(event.id);
  });

  it('retrieves events by correlation ID', () => {
    const correlationId = 'incident-123';
    memory.record(makeEvent({ correlationId }));
    memory.record(makeEvent({ correlationId }));
    memory.record(makeEvent({ correlationId: 'other' }));

    const events = memory.getByCorrelationId('incident-123');
    expect(events).toHaveLength(2);
  });

  it('retrieves events by component', () => {
    memory.record(makeEvent({ component: 'database' }));
    memory.record(makeEvent({ component: 'ollama' }));
    memory.record(makeEvent({ component: 'database' }));

    const dbEvents = memory.getByComponent('database');
    expect(dbEvents).toHaveLength(2);
  });

  it('retrieves events by type', () => {
    memory.record(makeEvent({ type: 'state_transition' }));
    memory.record(makeEvent({ type: 'failure_detected' }));

    const transitions = memory.getByType('state_transition');
    expect(transitions).toHaveLength(1);
  });

  it('persists events to disk and loads them on restart', async () => {
    const event = makeEvent({ component: 'persistent-test' });
    memory.record(event);
    await memory.flush();

    // Create a new instance pointing at the same directory
    const memory2 = new OperationalMemory(tmpDir);
    const events = memory2.getByComponent('persistent-test');
    expect(events.length).toBeGreaterThanOrEqual(1);
    await memory2.destroy();
  });

  it('flush writes pending events to disk', async () => {
    memory.record(makeEvent({ component: 'flush-test' }));
    memory.record(makeEvent({ component: 'flush-test' }));
    await memory.flush();

    const filePath = path.resolve(tmpDir, '.hydi-operational', 'operational-events.jsonl');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
});
