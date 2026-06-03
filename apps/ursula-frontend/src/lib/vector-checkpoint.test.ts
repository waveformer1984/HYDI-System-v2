/**
 * Vector Checkpoint System — Unit Tests
 *
 * Tests core checkpoint lifecycle, vector math, drift detection,
 * echo report generation, and serialization.
 *
 * Run: npm test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTaskTracker,
  startTask,
  addCheckpoint,
  completeTask,
  failTask,
  pauseTask,
  resumeTask,
  createEmptyEmbedding,
  embeddingFromState,
  cosineSimilarity,
  euclideanDistance,
  magnitude,
  detectDrift,
  generateEcho,
  serializeTracker,
  deserializeTracker,
  formatDuration,
  formatVelocity,
  calculateProgress,
  TaskState,
  VectorEmbedding,
} from './vector-checkpoint';

// ============================================================================
// Task Lifecycle
// ============================================================================

describe('Task Lifecycle', () => {
  let tracker: TaskState;

  beforeEach(() => {
    tracker = createTaskTracker('test-1', 'Test Task');
  });

  it('creates a tracker with correct defaults', () => {
    expect(tracker.taskId).toBe('test-1');
    expect(tracker.name).toBe('Test Task');
    expect(tracker.progress).toBe(0);
    expect(tracker.status).toBe('pending');
    expect(tracker.checkpoints).toHaveLength(0);
    expect(tracker.completedAt).toBeNull();
  });

  it('creates a tracker with initial embedding', () => {
    const embedding: VectorEmbedding = { dimensions: { x: 1, y: 2 } };
    const t = createTaskTracker('test-2', 'With Embedding', embedding);
    expect(t.embedding.dimensions.x).toBe(1);
    expect(t.embedding.dimensions.y).toBe(2);
  });

  it('creates a tracker with config', () => {
    const t = createTaskTracker('test-3', 'With Config', undefined, {
      maxCheckpoints: 5,
      driftThreshold: 0.2,
    });
    expect(t.maxCheckpoints).toBe(5);
  });

  it('starts a pending task', () => {
    const started = startTask(tracker);
    expect(started.status).toBe('running');
    expect(started.checkpoints).toHaveLength(1);
    expect(started.checkpoints[0].label).toBe('Task Started');
    expect(started.checkpoints[0].isMilestone).toBe(true);
  });

  it('throws when starting a running task', () => {
    const started = startTask(tracker);
    expect(() => startTask(started)).toThrow('Cannot start task in status: running');
  });

  it('throws when starting a completed task', () => {
    const completed = completeTask(tracker);
    expect(() => startTask(completed)).toThrow('Cannot start task in status: completed');
  });

  it('pauses a running task', () => {
    const started = startTask(tracker);
    const paused = pauseTask(started);
    expect(paused.status).toBe('paused');
  });

  it('throws when pausing a non-running task', () => {
    expect(() => pauseTask(tracker)).toThrow('Cannot pause task in status: pending');
  });

  it('resumes a paused task', () => {
    const started = startTask(tracker);
    const paused = pauseTask(started);
    const resumed = resumeTask(paused);
    expect(resumed.status).toBe('running');
  });

  it('throws when resuming a non-paused task', () => {
    const started = startTask(tracker);
    expect(() => resumeTask(started)).toThrow('Cannot resume task in status: running');
  });

  it('completes a task', () => {
    const completed = completeTask(tracker);
    expect(completed.status).toBe('completed');
    expect(completed.progress).toBe(100);
    expect(completed.completedAt).toBeTruthy();
    expect(completed.totalDuration).toBeGreaterThanOrEqual(0);
    const last = completed.checkpoints[completed.checkpoints.length - 1];
    expect(last.label).toBe('Task Completed');
    expect(last.progress).toBe(100);
    expect(last.isMilestone).toBe(true);
  });

  it('completes a task already at 100% without extra checkpoint', () => {
    let t = startTask(tracker);
    t = addCheckpoint(t, { label: 'Done', progress: 100 });
    const completed = completeTask(t);
    const completedLabels = completed.checkpoints.map(c => c.label);
    expect(completedLabels.filter(l => l === 'Task Completed')).toHaveLength(0);
  });

  it('fails a task with error message', () => {
    const failed = failTask(tracker, 'Something broke');
    expect(failed.status).toBe('failed');
    expect(failed.completedAt).toBeTruthy();
    const last = failed.checkpoints[failed.checkpoints.length - 1];
    expect(last.label).toBe('Task Failed');
    expect(last.notes).toBe('Something broke');
    expect(last.isMilestone).toBe(false);
  });

  it('can start a paused task', () => {
    const started = startTask(tracker);
    const paused = pauseTask(started);
    const restarted = startTask(paused);
    expect(restarted.status).toBe('running');
  });
});

// ============================================================================
// Checkpoints
// ============================================================================

describe('Checkpoints', () => {
  let tracker: TaskState;

  beforeEach(() => {
    tracker = startTask(createTaskTracker('cp-test', 'Checkpoint Test'));
  });

  it('adds a checkpoint with progress', () => {
    const updated = addCheckpoint(tracker, { label: 'Step 1', progress: 25 });
    expect(updated.progress).toBe(25);
    expect(updated.checkpoints).toHaveLength(2);
    const last = updated.checkpoints[updated.checkpoints.length - 1];
    expect(last.label).toBe('Step 1');
    expect(last.progress).toBe(25);
    expect(last.sequence).toBe(1);
  });

  it('adds checkpoint with embedding', () => {
    const embedding: VectorEmbedding = { dimensions: { phase: 1 } };
    const updated = addCheckpoint(tracker, { label: 'With Embed', progress: 50, embedding });
    expect(updated.embedding.dimensions.phase).toBe(1);
  });

  it('adds checkpoint with notes', () => {
    const updated = addCheckpoint(tracker, { label: 'Noted', progress: 30, notes: 'Some detail' });
    const last = updated.checkpoints[updated.checkpoints.length - 1];
    expect(last.notes).toBe('Some detail');
  });

  it('adds milestone checkpoint', () => {
    const updated = addCheckpoint(tracker, { label: 'Big Win', progress: 75, isMilestone: true });
    const last = updated.checkpoints[updated.checkpoints.length - 1];
    expect(last.isMilestone).toBe(true);
  });

  it('increments sequence numbers', () => {
    let t = tracker;
    t = addCheckpoint(t, { label: 'A', progress: 10 });
    t = addCheckpoint(t, { label: 'B', progress: 20 });
    t = addCheckpoint(t, { label: 'C', progress: 30 });
    const sequences = t.checkpoints.map(c => c.sequence);
    expect(sequences).toEqual([0, 1, 2, 3]);
  });

  it('enforces maxCheckpoints limit', () => {
    let t = createTaskTracker('limit-test', 'Limit', undefined, { maxCheckpoints: 3 });
    t = startTask(t);
    for (let i = 1; i <= 10; i++) {
      t = addCheckpoint(t, { label: `Step ${i}`, progress: i * 10 });
    }
    expect(t.checkpoints).toHaveLength(3);
    expect(t.checkpoints[t.checkpoints.length - 1].label).toBe('Step 10');
  });

  it('generates default label when none provided', () => {
    const updated = addCheckpoint(tracker, { progress: 50 });
    const last = updated.checkpoints[updated.checkpoints.length - 1];
    expect(last.label).toMatch(/Checkpoint \d+/);
  });

  it('records duration from task start', () => {
    const updated = addCheckpoint(tracker, { label: 'Timed', progress: 50 });
    const last = updated.checkpoints[updated.checkpoints.length - 1];
    expect(last.duration).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// Vector Operations
// ============================================================================

describe('Vector Operations', () => {
  describe('createEmptyEmbedding', () => {
    it('creates embedding with empty dimensions', () => {
      const e = createEmptyEmbedding();
      expect(e.dimensions).toEqual({});
    });
  });

  describe('embeddingFromState', () => {
    it('wraps state object into embedding', () => {
      const e = embeddingFromState({ x: 1, y: 2, z: 3 });
      expect(e.dimensions).toEqual({ x: 1, y: 2, z: 3 });
    });
  });

  describe('cosineSimilarity', () => {
    it('returns 1 for identical vectors', () => {
      const a = embeddingFromState({ x: 3, y: 4 });
      const b = embeddingFromState({ x: 3, y: 4 });
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);
    });

    it('returns 1 for parallel vectors (different magnitude)', () => {
      const a = embeddingFromState({ x: 1, y: 2 });
      const b = embeddingFromState({ x: 2, y: 4 });
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);
    });

    it('returns 0 for orthogonal vectors', () => {
      const a = embeddingFromState({ x: 1, y: 0 });
      const b = embeddingFromState({ x: 0, y: 1 });
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
    });

    it('returns -1 for opposite vectors', () => {
      const a = embeddingFromState({ x: 1, y: 0 });
      const b = embeddingFromState({ x: -1, y: 0 });
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
    });

    it('returns 0 when one vector is zero', () => {
      const a = embeddingFromState({ x: 1, y: 2 });
      const b = createEmptyEmbedding();
      expect(cosineSimilarity(a, b)).toBe(0);
    });

    it('handles sparse vectors with different keys', () => {
      const a = embeddingFromState({ x: 1 });
      const b = embeddingFromState({ y: 1 });
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
    });

    it('handles partially overlapping keys', () => {
      const a = embeddingFromState({ x: 1, y: 1 });
      const b = embeddingFromState({ y: 1, z: 1 });
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.5);
    });
  });

  describe('euclideanDistance', () => {
    it('returns 0 for identical vectors', () => {
      const a = embeddingFromState({ x: 3, y: 4 });
      expect(euclideanDistance(a, a)).toBeCloseTo(0);
    });

    it('calculates correct distance', () => {
      const a = embeddingFromState({ x: 0, y: 0 });
      const b = embeddingFromState({ x: 3, y: 4 });
      expect(euclideanDistance(a, b)).toBeCloseTo(5.0);
    });

    it('handles sparse vectors', () => {
      const a = embeddingFromState({ x: 3 });
      const b = embeddingFromState({ y: 4 });
      expect(euclideanDistance(a, b)).toBeCloseTo(5.0);
    });
  });

  describe('magnitude', () => {
    it('returns 0 for empty embedding', () => {
      expect(magnitude(createEmptyEmbedding())).toBe(0);
    });

    it('calculates correct magnitude', () => {
      const e = embeddingFromState({ x: 3, y: 4 });
      expect(magnitude(e)).toBeCloseTo(5.0);
    });
  });

  describe('detectDrift', () => {
    it('reports no drift for identical embeddings', () => {
      const a = embeddingFromState({ x: 1, y: 2 });
      const drift = detectDrift(a, a);
      expect(drift.hasDrift).toBe(false);
      expect(drift.severity).toBe('none');
      expect(drift.initialSimilarity).toBeCloseTo(1.0);
    });

    it('reports high drift for opposite embeddings', () => {
      const a = embeddingFromState({ x: 1 });
      const b = embeddingFromState({ x: -1 });
      const drift = detectDrift(a, b);
      expect(drift.hasDrift).toBe(true);
      expect(drift.severity).toBe('high');
    });

    it('reports no drift for slightly different embeddings', () => {
      const a = embeddingFromState({ x: 10, y: 10 });
      const b = embeddingFromState({ x: 10, y: 11 });
      const drift = detectDrift(a, b);
      expect(drift.severity).toBe('none');
    });

    it('respects custom threshold', () => {
      // cos({1,0}, {1,1}) = 1/sqrt(2) ~ 0.707
      const a = embeddingFromState({ x: 1, y: 0 });
      const b = embeddingFromState({ x: 1, y: 1 });
      // threshold 0.2 -> hasDrift if sim < 0.8 -> 0.707 < 0.8 -> true
      const drift = detectDrift(a, b, 0.2);
      expect(drift.hasDrift).toBe(true);
    });

    it('classifies medium drift correctly', () => {
      const a = embeddingFromState({ x: 1, y: 0 });
      const b = embeddingFromState({ x: 0.5, y: 0.866 });
      const drift = detectDrift(a, b);
      expect(['medium', 'high']).toContain(drift.severity);
    });
  });
});

// ============================================================================
// Echo Reports
// ============================================================================

describe('Echo Reports', () => {
  it('generates echo for empty tracker', () => {
    const tracker = createTaskTracker('echo-1', 'Echo Test');
    const echo = generateEcho(tracker);
    expect(echo.taskId).toBe('echo-1');
    expect(echo.totalCheckpoints).toBe(0);
    expect(echo.milestones).toBe(0);
    expect(echo.progress).toBe(0);
    expect(echo.velocity).toBe(0);
    expect(echo.estimatedTimeRemaining).toBeNull();
  });

  it('generates echo with checkpoints', () => {
    let t = startTask(createTaskTracker('echo-2', 'Echo With CP'));
    t = addCheckpoint(t, { label: 'Step 1', progress: 25 });
    t = addCheckpoint(t, { label: 'Step 2', progress: 50, isMilestone: true });
    const echo = generateEcho(t);
    expect(echo.totalCheckpoints).toBe(3);
    expect(echo.milestones).toBe(2);
    expect(echo.progress).toBe(50);
    expect(echo.history).toHaveLength(3);
  });

  it('calculates velocity when checkpoints exist', () => {
    let t = startTask(createTaskTracker('echo-3', 'Velocity Test'));
    t = addCheckpoint(t, { label: 'Progress', progress: 50 });
    const echo = generateEcho(t);
    expect(echo.velocity).toBeGreaterThanOrEqual(0);
  });

  it('returns null ETA for completed tasks', () => {
    let t = createTaskTracker('echo-5', 'Done Test');
    t = completeTask(t);
    const echo = generateEcho(t);
    expect(echo.estimatedTimeRemaining).toBeNull();
  });

  it('includes drift analysis', () => {
    let t = startTask(createTaskTracker('echo-6', 'Drift Echo'));
    t = addCheckpoint(t, {
      label: 'Drifted',
      progress: 50,
      embedding: embeddingFromState({ x: 10 }),
    });
    const echo = generateEcho(t);
    expect(echo.driftAnalysis).toBeDefined();
    expect(echo.driftAnalysis).toHaveProperty('severity');
    expect(echo.driftAnalysis).toHaveProperty('hasDrift');
    expect(echo.driftAnalysis).toHaveProperty('totalChange');
  });
});

// ============================================================================
// Serialization
// ============================================================================

describe('Serialization', () => {
  it('round-trips a tracker through JSON', () => {
    let t = startTask(createTaskTracker('serial-1', 'Serialize Test'));
    t = addCheckpoint(t, { label: 'Step', progress: 42 });
    const json = serializeTracker(t);
    const restored = deserializeTracker(json);
    expect(restored.taskId).toBe('serial-1');
    expect(restored.name).toBe('Serialize Test');
    expect(restored.progress).toBe(42);
    expect(restored.checkpoints).toHaveLength(2);
    expect(restored.status).toBe('running');
  });

  it('preserves embedding data through serialization', () => {
    const embedding = embeddingFromState({ x: 1.5, y: 2.5 });
    let t = createTaskTracker('serial-2', 'Embed Serial', embedding);
    t = startTask(t);
    const json = serializeTracker(t);
    const restored = deserializeTracker(json);
    expect(restored.embedding.dimensions.x).toBe(1.5);
    expect(restored.embedding.dimensions.y).toBe(2.5);
  });
});

// ============================================================================
// Utility Functions
// ============================================================================

describe('Utility Functions', () => {
  describe('formatDuration', () => {
    it('formats milliseconds', () => {
      expect(formatDuration(500)).toBe('500ms');
    });
    it('formats seconds', () => {
      expect(formatDuration(5000)).toBe('5.0s');
    });
    it('formats minutes', () => {
      expect(formatDuration(120000)).toBe('2.0m');
    });
    it('formats hours', () => {
      expect(formatDuration(7200000)).toBe('2.0h');
    });
  });

  describe('formatVelocity', () => {
    it('formats near-zero velocity', () => {
      expect(formatVelocity(0.05)).toBe('~0%');
    });
    it('formats normal velocity', () => {
      expect(formatVelocity(1.5)).toBe('1.5%/min');
    });
  });

  describe('calculateProgress', () => {
    it('returns 0 for empty checkpoints', () => {
      expect(calculateProgress([])).toBe(0);
    });
    it('returns last checkpoint progress', () => {
      const checkpoints = [
        { id: '1', taskId: 't', sequence: 0, label: 'A', progress: 25, embedding: { dimensions: {} }, timestamp: '', duration: 0, isMilestone: false },
        { id: '2', taskId: 't', sequence: 1, label: 'B', progress: 75, embedding: { dimensions: {} }, timestamp: '', duration: 0, isMilestone: false },
      ];
      expect(calculateProgress(checkpoints)).toBe(75);
    });
  });
});
