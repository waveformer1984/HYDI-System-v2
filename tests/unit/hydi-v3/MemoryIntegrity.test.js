const MemoryIntegrity = require('../../../src/hydi-v3/MemoryIntegrity');

describe('MemoryIntegrity', () => {
  let integrity;

  beforeEach(() => {
    integrity = new MemoryIntegrity();
  });

  afterEach(() => {
    integrity.destroy();
  });

  test('passes scan for valid memory', () => {
    const result = integrity.verify({
      reflectiveMemory: { whatWorked: new Map(), whatFailed: new Map(), confidenceReality: [] },
      missions: [{ id: 'm1', createdAt: new Date().toISOString(), tasks: [] }],
      missionIds: ['m1'],
      tasks: [{ id: 't1', missionId: 'm1', createdAt: new Date().toISOString() }],
      conversations: [{ id: 'c1', timestamp: new Date().toISOString() }],
    });
    expect(result.passed).toBe(true);
  });

  test('detects duplicate ids', () => {
    const result = integrity.verify({
      missions: [{ id: 'm1', createdAt: new Date().toISOString() }, { id: 'm1', createdAt: new Date().toISOString() }],
    });
    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.includes('duplicate_mission_id'))).toBe(true);
  });

  test('detects corrupted Map and repairs', () => {
    const stores = {
      reflectiveMemory: { whatWorked: { key: { timestamp: Date.now() } }, whatFailed: new Map(), confidenceReality: [] },
    };
    const result = integrity.verify(stores);
    expect(result.passed).toBe(false);
    expect(result.repairs.length).toBeGreaterThan(0);
    expect(stores.reflectiveMemory.whatWorked instanceof Map).toBe(true);
  });
});
