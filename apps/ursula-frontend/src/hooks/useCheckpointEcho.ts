/**
 * useCheckpointEcho — React Hook for Vector Checkpoint Progress Tracking
 * 
 * Provides an easy-to-use hook for tracking long-duration tasks with
 * vector-based checkpoints and generating echo reports.
 * 
 * Features:
 * - Auto-save to localStorage
 * - Periodic echo generation
 * - Progress callbacks
 * - Drift detection callbacks
 * - Task state management
 * 
 * Usage:
 *  const { tracker, progress, echo, checkpoint, complete } = useCheckpointEcho({
 *    taskId: 'my-task',
 *    name: 'Long Running Process',
 *    onProgress: (p) => console.log('Progress:', p),
 *  });
 * 
 *  // During task:
 *  checkpoint('Phase 1 complete', 25, { phase: 1 });
 *  checkpoint('Phase 2 complete', 50, { phase: 2 });
 * 
 *  // When done:
 *  complete({ finalState: {...} });
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
    createTaskTracker,
    startTask,
    addCheckpoint,
    completeTask,
    failTask,
    pauseTask,
    resumeTask,
    generateEcho,
    saveTracker,
    loadTracker,
    deleteTracker,
    TaskState,
    Checkpoint,
    EchoReport,
    VectorEmbedding,
    TaskTrackerConfig,
} from '@/lib/vector-checkpoint';

export interface UseCheckpointEchoOptions {
    /** Unique task identifier */
    taskId: string;
    /** Human-readable task name */
    name: string;
    /** Initial embedding state for the task */
    initialEmbedding?: VectorEmbedding;
    /** Configuration options */
    config?: TaskTrackerConfig;
    /** Callback when progress changes */
    onProgress?: (progress: number) => void;
    /** Callback when a checkpoint is added */
    onCheckpoint?: (checkpoint: Checkpoint) => void;
    /** Callback when task completes */
    onComplete?: (echo: EchoReport) => void;
    /** Callback when task fails */
    onFail?: (error: string) => void;
    /** Callback when drift is detected */
    onDrift?: (severity: 'none' | 'low' | 'medium' | 'high') => void;
    /** Auto-save to localStorage (default: true) */
    autoSave?: boolean;
    /** Echo report generation interval in ms (default: 5000) */
    echoInterval?: number;
}

export interface UseCheckpointEchoReturn {
    /** Current task state */
    tracker: TaskState | null;
    /** Current progress percentage (0-100) */
    progress: number;
    /** Current echo report (updated periodically) */
    echo: EchoReport | null;
    /** Whether the task is currently running */
    isRunning: boolean;
    /** Whether the task is paused */
    isPaused: boolean;
    /** Whether the task is completed */
    isCompleted: boolean;
    /** Whether the task has failed */
    isFailed: boolean;
    /** Total checkpoints recorded */
    checkpointCount: number;
    /** Add a checkpoint and update progress */
    checkpoint: (
        label: string,
        progress: number,
        embedding?: VectorEmbedding,
        notes?: string
    ) => void;
    /** Add a milestone checkpoint */
    milestone: (
        label: string,
        progress: number,
        embedding?: VectorEmbedding,
        notes?: string
    ) => void;
    /** Mark task as paused */
    pause: () => void;
    /** Resume a paused task */
    resume: () => void;
    /** Complete the task successfully */
    complete: (finalEmbedding?: VectorEmbedding) => void;
    /** Mark task as failed */
    fail: (error: string) => void;
    /** Force generate a new echo report */
    refreshEcho: () => void;
    /** Clear/delete the tracker */
    clear: () => void;
}

export function useCheckpointEcho(options: UseCheckpointEchoOptions): UseCheckpointEchoReturn {
    const {
        taskId,
        name,
        initialEmbedding,
        config,
        onProgress,
        onCheckpoint,
        onComplete,
        onFail,
        onDrift,
        autoSave = true,
        echoInterval = 5000,
    } = options;

    const [tracker, setTracker] = useState<TaskState | null>(null);
    const [echo, setEcho] = useState<EchoReport | null>(null);
    const echoTimerRef = useRef<NodeJS.Timeout | null>(null);
    const previousDriftRef = useRef<string>('none');

    // Initialize tracker
    useEffect(() => {
        const saved = loadTracker(taskId);
        if (saved) {
            setTracker(saved);
            setEcho(generateEcho(saved));
        } else {
            const initial = createTaskTracker(taskId, name, initialEmbedding, config);
            setTracker(initial);
        }
        return () => {
            if (echoTimerRef.current) {
                clearInterval(echoTimerRef.current);
            }
        };
    }, [taskId, name, initialEmbedding, config]);

    // Start echo timer when running
    useEffect(() => {
        if (tracker?.status === 'running' && !echoTimerRef.current) {
            echoTimerRef.current = setInterval(() => {
                if (tracker) {
                    const newEcho = generateEcho(tracker);
                    setEcho(newEcho);

                    // Check for drift changes
                    if (newEcho.driftAnalysis.severity !== previousDriftRef.current) {
                        onDrift?.(newEcho.driftAnalysis.severity);
                        previousDriftRef.current = newEcho.driftAnalysis.severity;
                    }
                }
            }, echoInterval);
        } else if (tracker?.status !== 'running' && echoTimerRef.current) {
            clearInterval(echoTimerRef.current);
            echoTimerRef.current = null;
        }
    }, [tracker?.status, echoInterval, tracker, onDrift]);

    // Auto-save effect
    useEffect(() => {
        if (autoSave && tracker) {
            saveTracker(tracker);
        }
    }, [tracker, autoSave]);

    const checkpoint = useCallback(
        (label: string, progress: number, embedding?: VectorEmbedding, notes?: string) => {
            if (!tracker || (tracker.status !== 'running' && tracker.status !== 'pending')) {
                console.warn('Cannot add checkpoint: task not running');
                return;
            }

            let updated = tracker;
            if (tracker.status === 'pending') {
                updated = startTask(tracker);
            }

            const next = addCheckpoint(updated, { label, progress, embedding, notes });
            setTracker(next);
            onProgress?.(progress);
            onCheckpoint?.(next.checkpoints[next.checkpoints.length - 1]);

            if (next.checkpoints.length === 1) {
                setEcho(generateEcho(next));
            }
        },
        [tracker, onProgress, onCheckpoint]
    );

    const milestone = useCallback(
        (label: string, progress: number, embedding?: VectorEmbedding, notes?: string) => {
            if (!tracker || (tracker.status !== 'running' && tracker.status !== 'pending')) {
                return;
            }

            let updated = tracker;
            if (tracker.status === 'pending') {
                updated = startTask(tracker);
            }

            const next = addCheckpoint(updated, { label, progress, embedding, notes, isMilestone: true });
            setTracker(next);
            onProgress?.(progress);
            onCheckpoint?.(next.checkpoints[next.checkpoints.length - 1]);
        },
        [tracker, onProgress, onCheckpoint]
    );

    const pause = useCallback(() => {
        if (!tracker) return;
        const next = pauseTask(tracker);
        setTracker(next);
    }, [tracker]);

    const resume = useCallback(() => {
        if (!tracker) return;
        const next = resumeTask(tracker);
        setTracker(next);
    }, [tracker]);

    const complete = useCallback(
        (finalEmbedding?: VectorEmbedding) => {
            if (!tracker) return;
            const next = completeTask(tracker, finalEmbedding);
            setTracker(next);
            const finalEcho = generateEcho(next);
            setEcho(finalEcho);
            onComplete?.(finalEcho);
        },
        [tracker, onComplete]
    );

    const fail = useCallback(
        (error: string) => {
            if (!tracker) return;
            const next = failTask(tracker, error);
            setTracker(next);
            setEcho(generateEcho(next));
            onFail?.(error);
        },
        [tracker, onFail]
    );

    const refreshEcho = useCallback(() => {
        if (tracker) {
            setEcho(generateEcho(tracker));
        }
    }, [tracker]);

    const clear = useCallback(() => {
        if (echoTimerRef.current) {
            clearInterval(echoTimerRef.current);
            echoTimerRef.current = null;
        }
        deleteTracker(taskId);
        setTracker(null);
        setEcho(null);
        previousDriftRef.current = 'none';
    }, [taskId]);

    return {
        tracker,
        progress: tracker?.progress ?? 0,
        echo: echo ?? (tracker ? generateEcho(tracker) : null),
        isRunning: tracker?.status === 'running',
        isPaused: tracker?.status === 'paused',
        isCompleted: tracker?.status === 'completed',
        isFailed: tracker?.status === 'failed',
        checkpointCount: tracker?.checkpoints.length ?? 0,
        checkpoint,
        milestone,
        pause,
        resume,
        complete,
        fail,
        refreshEcho,
        clear,
    };
}

// ============================================================================
// Convenience Hooks
// ============================================================================

/**
 * Create a quick checkpoint tracker for simple progress tracking
 */
export function useProgressTracker(
    taskId: string,
    totalSteps: number,
    callbacks?: {
        onComplete?: () => void;
        onStep?: (step: number) => void;
    }
) {
    const [currentStep, setCurrentStep] = useState(0);

    const echo = useCheckpointEcho({
        taskId: `${taskId}-progress`,
        name: `Progress: ${taskId}`,
        onComplete: () => callbacks?.onComplete?.(),
    });

    const advance = useCallback(
        (stepLabel?: string) => {
            const nextStep = currentStep + 1;
            const progress = Math.round((nextStep / totalSteps) * 100);
            echo.checkpoint(stepLabel || `Step ${nextStep}/${totalSteps}`, progress);
            setCurrentStep(nextStep);
            callbacks?.onStep?.(nextStep);
        },
        [currentStep, totalSteps, echo, callbacks]
    );

    return {
        ...echo,
        currentStep,
        totalSteps,
        progress: Math.round((currentStep / totalSteps) * 100),
        advance,
        isComplete: currentStep >= totalSteps,
    };
}

/**
 * Multi-task checkpoint manager
 */
export function useCheckpointManager() {
    const [trackers, setTrackers] = useState<Map<string, TaskState>>(new Map());
    const [echos, setEchos] = useState<Map<string, EchoReport>>(new Map());

    const create = useCallback((taskId: string, name: string) => {
        const tracker = createTaskTracker(taskId, name);
        setTrackers(prev => new Map(prev).set(taskId, tracker));
        setEchos(prev => new Map(prev).set(taskId, generateEcho(tracker)));
        return tracker;
    }, []);

    const get = useCallback((taskId: string) => {
        const saved = loadTracker(taskId);
        if (saved) {
            setTrackers(prev => new Map(prev).set(taskId, saved));
            setEchos(prev => new Map(prev).set(taskId, generateEcho(saved)));
            return saved;
        }
        return trackers.get(taskId) ?? null;
    }, [trackers]);

    const checkpoint = useCallback(
        (taskId: string, label: string, progress: number, embedding?: VectorEmbedding) => {
            const existing = trackers.get(taskId) || loadTracker(taskId);
            if (!existing) return;

            const running = existing.status === 'pending' ? startTask(existing) : existing;
            const next = addCheckpoint(running, { label, progress, embedding });

            setTrackers(prev => new Map(prev).set(taskId, next));
            setEchos(prev => new Map(prev).set(taskId, generateEcho(next)));
            saveTracker(next);
        },
        [trackers]
    );

    const remove = useCallback((taskId: string) => {
        deleteTracker(taskId);
        setTrackers(prev => {
            const next = new Map(prev);
            next.delete(taskId);
            return next;
        });
        setEchos(prev => {
            const next = new Map(prev);
            next.delete(taskId);
            return next;
        });
    }, []);

    return {
        trackers: Object.fromEntries(trackers),
        echos: Object.fromEntries(echos),
        create,
        get,
        checkpoint,
        remove,
    };
}