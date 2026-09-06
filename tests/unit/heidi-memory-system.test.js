'use strict';

// Mock database before HeidiMemorySystem is loaded
jest.mock('../../src/database', () => ({
  supabase: {
    from: jest.fn(() => ({
      insert: jest.fn().mockResolvedValue({ data: [], error: null }),
      upsert: jest.fn(() => ({ select: jest.fn().mockResolvedValue({ data: [], error: null }) })),
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: null, error: null }) })),
        order: jest.fn(() => ({ limit: jest.fn().mockResolvedValue({ data: [], error: null }) })),
      })),
      update: jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ data: [], error: null }) })),
    })),
  },
}));

const os = require('os');
const path = require('path');
const HeidiMemorySystem = require('../../src/memory/HeidiMemorySystem');

describe('HeidiMemorySystem', () => {
  let memory;

  beforeEach(() => {
    memory = new HeidiMemorySystem({
      enablePersistence: false,
      reflectionInterval: 9999999,
      localStoragePath: path.join(os.tmpdir(), 'hydi-test-' + Date.now()),
    });
  });

  afterEach(() => {
    if (memory) memory.destroy();
  });

  describe('constructor', () => {
    test('initializes with correct defaults', () => {
      expect(memory.config.sessionMaxSize).toBe(100);
      expect(memory.config.enablePersistence).toBe(false);
    });

    test('starts with zero drift score', () => {
      expect(memory.driftScore).toBe(0);
    });

    test('starts with empty session memory', () => {
      expect(memory.sessionMemory.tasks.size).toBe(0);
      expect(memory.sessionMemory.goals.size).toBe(0);
      expect(memory.sessionMemory.workingMemory.size).toBe(0);
    });

    test('starts with empty reflective memory', () => {
      expect(memory.reflectiveMemory.whatWorked.size).toBe(0);
      expect(memory.reflectiveMemory.whatFailed.size).toBe(0);
      expect(memory.reflectiveMemory.driftScore).toBe(0);
    });
  });

  describe('session memory', () => {
    test('stores and retrieves tasks', () => {
      memory.storeTask('t1', { type: 'chat', content: 'hello' });
      expect(memory.getTask('t1')).toEqual({ type: 'chat', content: 'hello' });
    });

    test('stores and retrieves goals', () => {
      memory.storeGoal('g1', { description: 'fix bug' });
      expect(memory.getGoal('g1')).toEqual({ description: 'fix bug' });
    });

    test('stores and retrieves context', () => {
      memory.storeContext('c1', { sessionId: 'abc' });
      expect(memory.getContext('c1')).toEqual({ sessionId: 'abc' });
    });

    test('returns null for unknown key', () => {
      expect(memory.getTask('nope')).toBeNull();
    });
  });

  describe('reflective memory', () => {
    test('stores what worked', () => {
      memory.storeWhatWorked('s1', { type: 'local', model: 'gpt-4-local' }, { success: true, latency: 200, confidence: 0.9 });
      expect(memory.reflectiveMemory.whatWorked.size).toBe(1);
    });

    test('stores what failed', () => {
      memory.storeWhatFailed('s2', { type: 'local' }, 'timeout error', { priority: 'normal', type: 'chat' });
      expect(memory.reflectiveMemory.whatFailed.size).toBe(1);
    });

    test('tracks confidence vs reality and updates drift score', () => {
      memory.trackConfidenceVsReality('task-1', 0.9, { success: true });
      expect(typeof memory.driftScore).toBe('number');
      expect(memory.driftScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe('reset', () => {
    test('clears session memory and reflective memory', async () => {
      memory.storeTask('t1', { data: 'test' });
      memory.storeWhatWorked('s1', { type: 'local' }, { success: true });
      await memory.reset();
      expect(memory.sessionMemory.tasks.size).toBe(0);
      expect(memory.reflectiveMemory.whatWorked.size).toBe(0);
      expect(memory.driftScore).toBe(0);
    });

    test('reset restores zero drift score even after tracking', async () => {
      memory.trackConfidenceVsReality('t1', 0.1, { success: true });
      await memory.reset();
      expect(memory.driftScore).toBe(0);
    });
  });

  // Regression coverage: analyzeWhatFailed() / identifySuccessPatterns() used
  // to group by a `.type` field that decision objects never have (they carry
  // `.model` and `.strategy` instead), so every failure collapsed into a
  // single meaningless 'unknown' bucket and generateRecommendations() then
  // emitted a 'failure_mitigation' adaptation targeting the literal string
  // 'unknown' -- logged as if a real model were being avoided while doing
  // nothing, since nothing routes on the string 'unknown'.
  describe('failure grouping targets the real model/strategy, not "unknown"', () => {
    test('analyzeWhatFailed groups repeated failures by model, not "unknown"', () => {
      memory.storeWhatFailed('loop_1', { model: 'gpt-4-local', strategy: 'local' }, 'spawn ENOENT', { type: 'revenue' });
      memory.storeWhatFailed('loop_2', { model: 'gpt-4-local', strategy: 'local' }, 'spawn ENOENT', { type: 'revenue' });
      memory.storeWhatFailed('loop_3', { model: 'gpt-4-local', strategy: 'local' }, 'spawn ENOENT', { type: 'revenue' });

      const analysis = memory.analyzeWhatFailed();
      expect(analysis.totalFailures).toBe(3);
      expect(analysis.commonFailures[0].type).toBe('gpt-4-local');
      expect(analysis.commonFailures[0].count).toBe(3);
      expect(analysis.commonFailures.some((f) => f.type === 'unknown')).toBe(false);
    });

    test('falls back to strategy, then "unknown", when model is absent', () => {
      memory.storeWhatFailed('loop_1', { strategy: 'hybrid' }, 'timeout', { type: 'critical' });
      memory.storeWhatFailed('loop_2', {}, 'mystery failure', { type: 'chat' });

      const analysis = memory.analyzeWhatFailed();
      const types = analysis.commonFailures.map((f) => f.type);
      expect(types).toContain('hybrid');
      expect(types).toContain('unknown');
    });

    test('generateRecommendations targets the actual failing model, not "unknown"', () => {
      for (let i = 0; i < 3; i++) {
        memory.storeWhatFailed(`loop_${i}`, { model: 'gpt-35-turbo', strategy: 'local' }, 'spawn ENOENT', { type: 'revenue' });
      }
      const recs = memory.generateRecommendations();
      const mitigation = recs.find((r) => r.type === 'failure_mitigation');
      expect(mitigation).toBeDefined();
      expect(mitigation.target).toBe('gpt-35-turbo');
    });

    test('identifySuccessPatterns detects local-strategy preference by strategy, not "unknown"', () => {
      memory.storeWhatWorked('s1', { model: 'gpt-4-local', strategy: 'local' }, { success: true, latency: 100, confidence: 0.9 });
      memory.storeWhatWorked('s2', { model: 'gpt-4-local', strategy: 'local' }, { success: true, latency: 100, confidence: 0.9 });
      memory.storeWhatWorked('s3', { model: 'gpt-4-local', strategy: 'local' }, { success: true, latency: 100, confidence: 0.9 });

      const analysis = memory.analyzeWhatWorked();
      expect(analysis.patterns).toContain('local_strategies_preferred');
    });
  });

  describe('getStatus', () => {
    test('returns valid status object', () => {
      const status = memory.getStatus();
      expect(status).toHaveProperty('session');
      expect(status).toHaveProperty('reflective');
      expect(status.reflective.driftScore).toBe(0);
    });
  });

  describe('destroy', () => {
    test('sets _destroyed flag and nulls timers', () => {
      memory.destroy();
      expect(memory._destroyed).toBe(true);
      expect(memory.cleanupTimer).toBeNull();
      expect(memory.reflectionTimer).toBeNull();
      expect(memory.persistTimer).toBeNull();
    });
  });
});
