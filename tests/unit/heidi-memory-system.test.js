/**
 * Unit tests for HeidiMemorySystem
 * Supabase and fs are mocked — all tests run offline.
 */

jest.mock('../../src/database', () => ({
  supabase: {
    from: jest.fn().mockReturnValue({
      insert: jest.fn().mockResolvedValue({ error: null }),
      select: jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue({ data: [], error: null }),
        }),
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
  },
}));

jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(),
    readFile: jest.fn().mockRejectedValue({ code: 'ENOENT' }),
    writeFile: jest.fn().mockResolvedValue(),
    access: jest.fn().mockResolvedValue(),
  },
}));

const HeidiMemorySystem = require('../../src/memory/HeidiMemorySystem');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMemory(cfg = {}) {
  return new HeidiMemorySystem({
    enablePersistence: false,
    reflectionInterval: 0,
    sessionMaxSize: 10,
    ...cfg,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HeidiMemorySystem', () => {

  // ── Constructor ───────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('applies default config values', () => {
      const mem = new HeidiMemorySystem();
      expect(mem.config.sessionMaxSize).toBe(100);
      expect(mem.config.sessionTTL).toBe(3600000);
      expect(mem.config.enablePersistence).toBe(true);
      expect(mem.config.driftThreshold).toBe(0.3);
    });

    it('starts with empty session memory', () => {
      const mem = makeMemory();
      expect(mem.sessionMemory.workingMemory.size).toBe(0);
    });

    it('starts with zero drift score', () => {
      const mem = makeMemory();
      expect(mem.driftScore).toBe(0);
    });
  });

  // ── Session memory ────────────────────────────────────────────────────────

  describe('storeSession / getSession', () => {
    it('stores and retrieves a value', () => {
      const mem = makeMemory();
      mem.storeSession('k1', { data: 42 });
      expect(mem.getSession('k1')).toEqual({ data: 42 });
    });

    it('returns null for unknown key', () => {
      expect(makeMemory().getSession('missing')).toBeNull();
    });

    it('stores in the specified category', () => {
      const mem = makeMemory();
      mem.storeSession('task-a', 'payload', 'tasks');
      expect(mem.getSession('task-a', 'tasks')).toBe('payload');
    });

    it('returns null when retrieving from the wrong category', () => {
      const mem = makeMemory();
      mem.storeSession('task-a', 'payload', 'tasks');
      expect(mem.getSession('task-a', 'workingMemory')).toBeNull();
    });
  });

  // ── storeTask / getTask ───────────────────────────────────────────────────

  describe('storeTask / getTask', () => {
    it('stores and retrieves a task by ID', () => {
      const mem = makeMemory();
      const task = { type: 'analysis', priority: 'high' };
      mem.storeTask('task-1', task);
      expect(mem.getTask('task-1')).toEqual(task);
    });

    it('returns null for unknown task ID', () => {
      expect(makeMemory().getTask('nope')).toBeNull();
    });
  });

  // ── storeContext / getContext ─────────────────────────────────────────────

  describe('storeContext / getContext', () => {
    it('round-trips context correctly', () => {
      const mem = makeMemory();
      mem.storeContext('ctx-1', { key: 'value' });
      expect(mem.getContext('ctx-1')).toEqual({ key: 'value' });
    });
  });

  // ── storeWhatWorked / storeWhatFailed ─────────────────────────────────────

  describe('storeWhatWorked', () => {
    it('stores a successful strategy with effectiveness score', () => {
      const mem = makeMemory();
      mem.storeWhatWorked('s1', { model: 'gpt4', type: 'local' }, { success: true, latency: 200, confidence: 0.9 });
      const worked = mem.reflectiveMemory.whatWorked;
      expect(worked.size).toBe(1);
      const entry = worked.get('s1');
      expect(entry.id).toBe('s1');
      expect(entry.effectiveness).toBeGreaterThan(0);
    });

    it('emits what_worked_stored event', () => {
      const mem = makeMemory();
      const handler = jest.fn();
      mem.on('what_worked_stored', handler);
      mem.storeWhatWorked('s2', {}, { success: true });
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('storeWhatFailed', () => {
    it('stores a failure with severity score', () => {
      const mem = makeMemory();
      mem.storeWhatFailed('f1', { model: 'local' }, 'timeout error', { priority: 'normal' });
      const failed = mem.reflectiveMemory.whatFailed;
      expect(failed.size).toBe(1);
      const entry = failed.get('f1');
      expect(entry.id).toBe('f1');
      expect(entry.severity).toBeGreaterThan(0);
    });

    it('emits what_failed_stored event', () => {
      const mem = makeMemory();
      const handler = jest.fn();
      mem.on('what_failed_stored', handler);
      mem.storeWhatFailed('f2', {}, 'error', {});
      expect(handler).toHaveBeenCalled();
    });
  });

  // ── trackConfidenceVsReality ──────────────────────────────────────────────

  describe('trackConfidenceVsReality', () => {
    it('records a confidence/outcome pair', () => {
      const mem = makeMemory();
      mem.trackConfidenceVsReality('t1', 0.9, { success: true });
      expect(mem.reflectiveMemory.confidenceReality.length).toBe(1);
    });

    it('updates the drift score after tracking', () => {
      const mem = makeMemory();
      mem.trackConfidenceVsReality('t1', 0.9, { success: true });
      // driftScore should be recalculated (may be 0 or small with good prediction)
      expect(typeof mem.driftScore).toBe('number');
    });

    it('emits confidence_tracked event', () => {
      const mem = makeMemory();
      const handler = jest.fn();
      mem.on('confidence_tracked', handler);
      mem.trackConfidenceVsReality('t2', 0.5, { success: false });
      expect(handler).toHaveBeenCalled();
    });
  });

  // ── calculateEffectiveness ────────────────────────────────────────────────

  describe('calculateEffectiveness', () => {
    it('returns 0 for a failed outcome', () => {
      expect(makeMemory().calculateEffectiveness({}, { success: false })).toBe(0);
    });

    it('returns higher score for fast, confident success', () => {
      const score = makeMemory().calculateEffectiveness(
        {},
        { success: true, latency: 1000, confidence: 0.95 }
      );
      expect(score).toBeGreaterThan(0.8);
    });

    it('clamps effectiveness to max 1.0', () => {
      const score = makeMemory().calculateEffectiveness(
        {},
        { success: true, latency: 100, confidence: 0.99 }
      );
      expect(score).toBeLessThanOrEqual(1.0);
    });
  });

  // ── calculateAccuracy ─────────────────────────────────────────────────────

  describe('calculateAccuracy', () => {
    it('returns 1 when high confidence predicts success correctly', () => {
      expect(makeMemory().calculateAccuracy(0.9, { success: true })).toBe(1);
    });

    it('returns 0 when high confidence but task failed', () => {
      expect(makeMemory().calculateAccuracy(0.9, { success: false })).toBe(0);
    });

    it('returns 1 when low confidence predicts failure correctly', () => {
      expect(makeMemory().calculateAccuracy(0.3, { success: false })).toBe(1);
    });

    it('returns 0 for null outcome', () => {
      expect(makeMemory().calculateAccuracy(0.9, null)).toBe(0);
    });
  });

  // ── updateDriftScore ──────────────────────────────────────────────────────

  describe('updateDriftScore', () => {
    it('driftScore = 0 when all predictions are correct', () => {
      const mem = makeMemory();
      mem.trackConfidenceVsReality('t1', 0.9, { success: true });
      mem.trackConfidenceVsReality('t2', 0.9, { success: true });
      expect(mem.driftScore).toBe(0);
    });

    it('driftScore = 1 when all predictions are wrong', () => {
      const mem = makeMemory();
      mem.trackConfidenceVsReality('t1', 0.9, { success: false }); // high confidence, but failed
      mem.trackConfidenceVsReality('t2', 0.9, { success: false });
      expect(mem.driftScore).toBe(1);
    });

    it('emits drift_updated event', () => {
      const mem = makeMemory();
      const handler = jest.fn();
      mem.on('drift_updated', handler);
      mem.trackConfidenceVsReality('t1', 0.9, { success: true });
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ score: expect.any(Number) }));
    });
  });

  // ── runReflection ─────────────────────────────────────────────────────────

  describe('runReflection', () => {
    it('returns a reflection object with expected fields', async () => {
      const mem = makeMemory();
      const reflection = await mem.runReflection();
      expect(reflection).toHaveProperty('whatWorked');
      expect(reflection).toHaveProperty('whatFailed');
      expect(reflection).toHaveProperty('recommendations');
      expect(reflection).toHaveProperty('timestamp');
    });

    it('emits reflection_completed event', async () => {
      const mem = makeMemory();
      const handler = jest.fn();
      mem.on('reflection_completed', handler);
      await mem.runReflection();
      expect(handler).toHaveBeenCalled();
    });
  });

  // ── getStatus ─────────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns object with expected shape', () => {
      const status = makeMemory().getStatus();
      expect(status).toHaveProperty('session');
      expect(status).toHaveProperty('reflective');
      expect(status.reflective).toHaveProperty('driftScore');
    });
  });

  // ── reset ─────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears session memory and reflective memory', async () => {
      const mem = makeMemory();
      mem.storeSession('k1', 'v1');
      mem.storeWhatWorked('s1', {}, { success: true });

      await mem.reset();

      expect(mem.sessionMemory.workingMemory.size).toBe(0);
      expect(mem.reflectiveMemory.whatWorked.size).toBe(0);
      expect(mem.driftScore).toBe(0);
    });
  });
});
