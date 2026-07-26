'use strict';

const fs = require('fs').promises;
const path = require('path');
const AuditLedger = require('../../../src/hydi-v3/AuditLedger');

describe('AuditLedger', () => {
  let ledger;
  let dataPath;

  beforeEach(async () => {
    dataPath = path.join('C:\\tmp', `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await fs.mkdir(dataPath, { recursive: true }).catch(() => {});
    ledger = new AuditLedger({ dataPath, logger: { log: () => {}, error: () => {} } });
    await ledger.start();
  });

  afterEach(async () => {
    await ledger.destroy().catch(() => {});
    await fs.rm(dataPath, { recursive: true, force: true }).catch(() => {});
  });

  test('records immutable, hash-chained events', () => {
    const a = ledger.record({ category: 'action', actor: 'test', payload: { x: 1 } });
    const b = ledger.record({ category: 'action', actor: 'test', payload: { x: 2 } });
    expect(a.hash).toBeTruthy();
    expect(b.previousHash).toBe(a.hash);
    expect(ledger.getEvents().length).toBe(2);
  });

  test('verify succeeds for intact chain', () => {
    ledger.record({ category: 'action', payload: {} });
    ledger.record({ category: 'action', payload: {} });
    const result = ledger.verify();
    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
  });

  test('detects tampered records', () => {
    ledger.record({ category: 'action', payload: {} });
    ledger.record({ category: 'action', payload: {} });
    ledger.records[0].payload = { tampered: true };
    const result = ledger.verify();
    expect(result.ok).toBe(false);
  });

  test('filters events by category and subjectId', () => {
    ledger.record({ category: 'action', actor: 'a', subjectId: '1' });
    ledger.record({ category: 'decision', actor: 'a', subjectId: '2' });
    expect(ledger.getEvents({ category: 'decision' }).length).toBe(1);
    expect(ledger.getEvents({ subjectId: '1' }).length).toBe(1);
  });
});
