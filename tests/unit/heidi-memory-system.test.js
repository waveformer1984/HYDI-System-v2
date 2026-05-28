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
