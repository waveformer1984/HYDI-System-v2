'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const BusinessMemory = require('../../../src/hydi-v3/BusinessMemory');

describe('BusinessMemory', () => {
  let memory;
  let dataPath;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `heidi-business-memory-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
    memory = new BusinessMemory({ dataPath, logger: { log: () => {}, error: () => {} } });
  });

  afterEach(async () => {
    if (memory) await memory.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    memory = null;
  });

  test('initialize, healthCheck, start, stop, flush, destroy are supported', async () => {
    await memory.initialize();
    expect(memory._started).toBe(true);
    await memory.flush();
    const health = memory.healthCheck();
    expect(health.ok).toBe(true);
    memory.stop();
    expect(memory._started).toBe(false);
    await memory.destroy();
    expect(memory._destroyed).toBe(true);
    expect(memory._persistTimer).toBeNull();
  });

  test('puts and gets entities with default values', () => {
    const id = memory.put({ type: 'client', name: 'Acme' });
    const client = memory.get(id);
    expect(client.name).toBe('Acme');
    expect(client.type).toBe('client');
    expect(client.priority).toBe('normal');
    expect(client.status).toBe('active');
    expect(client.value).toBe(0);
    expect(client.effort).toBe(1);
    expect(client.risk).toBe(0);
  });

  test('updates existing entities while preserving createdAt', () => {
    const id = memory.put({ type: 'client', name: 'Acme' });
    const first = memory.get(id);
    const updatedId = memory.put({ id, name: 'Acme Corp', value: 1000 });
    const second = memory.get(updatedId);
    expect(second.name).toBe('Acme Corp');
    expect(second.value).toBe(1000);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
  });

  test('rejects unknown entity types', () => {
    expect(() => memory.put({ type: 'dragon' })).toThrow();
  });

  test('removes entities and their relationships', () => {
    const a = memory.put({ type: 'client', name: 'A' });
    const b = memory.put({ type: 'project', name: 'B' });
    memory.relate(a, b, 'owns');
    expect(memory.remove(a)).toBe(true);
    expect(memory.get(a)).toBeUndefined();
    expect(memory.getRelated(b).length).toBe(0);
    expect(memory.remove(a)).toBe(false);
  });

  test('finds and filters entities', () => {
    memory.put({ type: 'client', name: 'Alpha', tags: ['vip'] });
    memory.put({ type: 'client', name: 'Beta', status: 'archived' });
    memory.put({ type: 'opportunity', name: 'Big Deal', value: 5000, priority: 'high' });
    expect(memory.find({ type: 'client' }).length).toBe(2);
    expect(memory.find({ type: 'client', status: 'archived' }).length).toBe(1);
    expect(memory.find({ tags: 'vip' }).length).toBe(1);
    expect(memory.find({ text: 'Deal' }).length).toBe(1);
    expect(memory.find({ minValue: 1000 }).length).toBe(1);
  });

  test('ranks opportunities by value, risk, and effort', () => {
    const a = memory.put({ type: 'opportunity', name: 'A', value: 100, effort: 1, risk: 0 });
    const b = memory.put({ type: 'opportunity', name: 'B', value: 100, effort: 2, risk: 0 });
    const c = memory.put({ type: 'opportunity', name: 'C', value: 50, effort: 1, risk: 0 });
    const ranked = memory.rankOpportunities();
    expect(ranked[0].id).toBe(a);
    expect(ranked[1].id).toBe(b);
    expect(ranked[2].id).toBe(c);
    expect(ranked[0].score).toBeGreaterThan(ranked[2].score);
  });

  test('persists and restores across instances', async () => {
    await memory.start();
    const a = memory.put({ type: 'client', name: 'Persist' });
    const b = memory.put({ type: 'project', name: 'Proj' });
    memory.relate(a, b, 'owns');
    await memory.destroy();

    const restored = new BusinessMemory({ dataPath, logger: { log: () => {}, error: () => {} } });
    await restored.start();
    expect(restored.get(a).name).toBe('Persist');
    expect(restored.getRelated(a, 'owns').length).toBe(1);
    await restored.destroy();
  });

  test('recovers from corrupted persistence', async () => {
    const file = path.join(dataPath, 'business-memory.json');
    await fs.writeFile(file, 'not-json { corrupted');
    const recovered = new BusinessMemory({ dataPath, logger: { log: () => {}, error: () => {} } });
    await expect(recovered.start()).resolves.toBeUndefined();
    expect(recovered.healthCheck().ok).toBe(true);
    expect(recovered.getStatus().total).toBe(0);
    const corruptFiles = (await fs.readdir(dataPath)).filter((f) => f.includes('corrupt'));
    expect(corruptFiles.length).toBeGreaterThan(0);
    await recovered.destroy();
  });

  test('handles edge cases gracefully', async () => {
    await memory.start();
    expect(() => memory.put({})).not.toThrow();
    expect(memory.get('missing')).toBeUndefined();
    expect(() => memory.relate('a', 'b')).toThrow();
    const archived = memory.put({ type: 'project', name: 'Done', status: 'archived' });
    expect(memory.find({ status: 'archived' })[0].id).toBe(archived);
  });

  test('benchmark: processes 1000 entities in under one second', async () => {
    await memory.start();
    const start = Date.now();
    for (let i = 0; i < 1000; i += 1) {
      memory.put({ type: i % 2 === 0 ? 'client' : 'opportunity', name: `ent-${i}`, value: i, effort: 1, risk: 0 });
    }
    const elapsed = Date.now() - start;
    expect(memory.getStatus().total).toBe(1000);
    expect(elapsed).toBeLessThan(1000);
  });
});
