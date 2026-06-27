/**
 * useCheckpointEcho — Hook Tests
 *
 * Covers lifecycle, checkpoints, auto-save, echo timer, and callbacks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCheckpointEcho } from './useCheckpointEcho';

const storage = new Map<string, string>();

function getKey(taskId: string) {
  return `checkpoint-tracker-${taskId}`;
}

describe('useCheckpointEcho', () => {
  beforeEach(() => {
    storage.clear();
    vi.useFakeTimers();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((...args: unknown[]) => {
      const key = String(args[0] ?? '');
      return storage.get(key) ?? null;
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((...args: unknown[]) => {
      const key = String(args[0] ?? '');
      const value = String(args[1] ?? '');
      storage.set(key, value);
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((...args: unknown[]) => {
      const key = String(args[0] ?? '');
      storage.delete(key);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('initializes tracker with pending status', () => {
    const { result } = renderHook(() =>
      useCheckpointEcho({ taskId: 't1', name: 'Test Task' })
    );

    expect(result.current.tracker).not.toBeNull();
    expect(result.current.tracker?.status).toBe('pending');
    expect(result.current.progress).toBe(0);
  });

  it('creates a checkpoint and starts the task', () => {
    const onProgress = vi.fn();
    const onCheckpoint = vi.fn();

    const { result } = renderHook(() =>
      useCheckpointEcho({ taskId: 't2', name: 'Test', onProgress, onCheckpoint })
    );

    act(() => {
      result.current.checkpoint('Phase 1', 25);
    });

    expect(result.current.tracker?.status).toBe('running');
    expect(result.current.progress).toBe(25);
    expect(result.current.checkpointCount).toBeGreaterThan(0);
    expect(onProgress).toHaveBeenCalledWith(25);
    expect(onCheckpoint).toHaveBeenCalled();
  });

  it('creates a milestone checkpoint', () => {
    const { result } = renderHook(() =>
      useCheckpointEcho({ taskId: 't3', name: 'Milestone Test' })
    );

    act(() => {
      result.current.milestone('Milestone 1', 50);
    });

    const last = result.current.tracker?.checkpoints.at(-1);
    expect(last?.isMilestone).toBe(true);
    expect(result.current.progress).toBe(50);
  });

  it('pauses and resumes a running task', () => {
    const { result } = renderHook(() =>
      useCheckpointEcho({ taskId: 't4', name: 'Pause Test' })
    );

    act(() => {
      result.current.checkpoint('Start', 10);
    });

    act(() => {
      result.current.pause();
    });
    expect(result.current.isPaused).toBe(true);

    act(() => {
      result.current.resume();
    });
    expect(result.current.isRunning).toBe(true);
  });

  it('completes a task and triggers onComplete', () => {
    const onComplete = vi.fn();

    const { result } = renderHook(() =>
      useCheckpointEcho({ taskId: 't5', name: 'Complete Test', onComplete })
    );

    act(() => {
      result.current.checkpoint('Work', 50);
    });

    act(() => {
      result.current.complete();
    });

    expect(result.current.isCompleted).toBe(true);
    expect(result.current.progress).toBe(100);
    expect(onComplete).toHaveBeenCalled();
  });

  it('fails a task and triggers onFail', () => {
    const onFail = vi.fn();

    const { result } = renderHook(() =>
      useCheckpointEcho({ taskId: 't6', name: 'Fail Test', onFail })
    );

    act(() => {
      result.current.fail('boom');
    });

    expect(result.current.isFailed).toBe(true);
    expect(onFail).toHaveBeenCalledWith('boom');
  });

  it('auto-saves to localStorage by default', () => {
    const { result } = renderHook(() =>
      useCheckpointEcho({ taskId: 't7', name: 'AutoSave Test' })
    );

    act(() => {
      result.current.checkpoint('Save', 10);
    });

    const key = getKey('t7');
    expect(storage.has(key)).toBe(true);
  });

  it('does not auto-save when autoSave=false', () => {
    const { result } = renderHook(() =>
      useCheckpointEcho({ taskId: 't8', name: 'No Save', autoSave: false })
    );

    act(() => {
      result.current.checkpoint('No Save', 10);
    });

    const key = getKey('t8');
    expect(storage.has(key)).toBe(false);
  });

  it('clears tracker and localStorage', () => {
    const { result } = renderHook(() =>
      useCheckpointEcho({ taskId: 't9', name: 'Clear Test' })
    );

    act(() => {
      result.current.checkpoint('Save', 10);
    });

    act(() => {
      result.current.clear();
    });

    const key = getKey('t9');
    expect(storage.has(key)).toBe(false);
    expect(result.current.tracker).toBeNull();
    expect(result.current.echo).toBeNull();
  });

  it('loads existing tracker from localStorage', () => {
    const key = getKey('t10');
    const saved = JSON.stringify({
      taskId: 't10',
      name: 'Loaded Task',
      progress: 42,
      embedding: { dimensions: {} },
      checkpoints: [],
      startedAt: new Date().toISOString(),
      completedAt: null,
      status: 'running',
    });

    storage.set(key, saved);

    const { result } = renderHook(() =>
      useCheckpointEcho({ taskId: 't10', name: 'Loaded Task' })
    );

    expect(result.current.tracker?.progress).toBe(42);
    expect(result.current.isRunning).toBe(true);
  });

  it('generates periodic echo updates', () => {
    const { result } = renderHook(() =>
      useCheckpointEcho({ taskId: 't11', name: 'Echo Test', echoInterval: 1000 })
    );

    act(() => {
      result.current.checkpoint('Start', 10);
    });

    const initialEchoTime = result.current.echo?.generatedAt;

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.echo?.generatedAt).not.toBe(initialEchoTime);
  });

  it('triggers onDrift when severity changes', () => {
    const onDrift = vi.fn();

    const { result } = renderHook(() =>
      useCheckpointEcho({ taskId: 't12', name: 'Drift Test', onDrift, echoInterval: 1000 })
    );

    act(() => {
      result.current.checkpoint('Start', 10, { dimensions: { x: 1 } });
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Change embedding enough to trigger drift severity update
    act(() => {
      result.current.checkpoint('Drift', 20, { dimensions: { x: -1 } });
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(onDrift).toHaveBeenCalled();
  });
});
