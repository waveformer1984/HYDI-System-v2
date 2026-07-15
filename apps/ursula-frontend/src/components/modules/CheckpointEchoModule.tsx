/**
 * CheckpointEchoModule — Visual Dashboard for Vector Checkpoint Progress
 * 
 * Displays checkpoint history, drift analysis, and echo reports
 * for tracking long-duration tasks.
 * 
 * TEST mode: Shows demo data with sample checkpoints.
 * LIVE mode: Connects to actual checkpoint trackers.
 */

'use client';

import { useState, useEffect } from 'react';
import {
    Radio,
    Activity,
    Clock,
    AlertTriangle,
    CheckCircle2,
    TrendingUp,
    History,
    Play,
    Pause,
    Square,
    Trash2,
    RefreshCw,
} from 'lucide-react';
import { useMode } from '@/lib/mode-context';
import {
    useCheckpointEcho,
    useCheckpointManager,
    UseCheckpointEchoReturn,
} from '@/hooks/useCheckpointEcho';
import {
    createTaskTracker,
    generateEcho,
    formatDuration,
    formatVelocity,
    Checkpoint,
    EchoReport,
    TaskState,
} from '@/lib/vector-checkpoint';

// ============================================================================
// Demo Data
// ============================================================================

const DEMO_TRACKER: TaskState = {
    taskId: 'demo-build',
    name: 'Full System Build',
    progress: 67,
    embedding: { dimensions: { phase: 2.5, complexity: 8, stability: 0.85 } },
    startedAt: new Date(Date.now() - 3600000).toISOString(),
    completedAt: null,
    status: 'running',
    checkpoints: [
        { id: 'cp-1', taskId: 'demo-build', sequence: 0, label: 'Build Started', progress: 0, timestamp: new Date(Date.now() - 3600000).toISOString(), duration: 0, isMilestone: true, embedding: { dimensions: {} } },
        { id: 'cp-2', taskId: 'demo-build', sequence: 1, label: 'Dependencies Installed', progress: 15, timestamp: new Date(Date.now() - 3000000).toISOString(), duration: 600000, isMilestone: true, embedding: { dimensions: { deps: 1 } } },
        { id: 'cp-3', taskId: 'demo-build', sequence: 2, label: 'Type Checking', progress: 25, timestamp: new Date(Date.now() - 2400000).toISOString(), duration: 1200000, isMilestone: false, embedding: { dimensions: { types: 1 } } },
        { id: 'cp-4', taskId: 'demo-build', sequence: 3, label: 'Linting Passed', progress: 35, timestamp: new Date(Date.now() - 1800000).toISOString(), duration: 1800000, isMilestone: true, embedding: { dimensions: { lint: 1 } } },
        { id: 'cp-5', taskId: 'demo-build', sequence: 4, label: 'Core Modules Compiled', progress: 55, timestamp: new Date(Date.now() - 900000).toISOString(), duration: 2700000, isMilestone: false, embedding: { dimensions: { core: 1 } } },
        { id: 'cp-6', taskId: 'demo-build', sequence: 5, label: 'Integration Tests', progress: 67, timestamp: new Date().toISOString(), duration: 3600000, isMilestone: true, embedding: { dimensions: { integration: 1 } } },
    ],
};

function generateDemoEcho(tracker: TaskState): EchoReport {
    return {
        taskId: tracker.taskId,
        totalCheckpoints: tracker.checkpoints.length,
        milestones: tracker.checkpoints.filter(cp => cp.isMilestone).length,
        progress: tracker.progress,
        velocity: 1.2,
        driftAnalysis: {
            initialSimilarity: 0.72,
            previousSimilarity: 0.89,
            totalChange: 0.28,
            hasDrift: false,
            severity: 'low',
        },
        history: tracker.checkpoints.map(cp => ({
            id: cp.id,
            sequence: cp.sequence,
            label: cp.label,
            progress: cp.progress,
            isMilestone: cp.isMilestone,
            timestamp: cp.timestamp,
        })),
        estimatedTimeRemaining: 1800,
        generatedAt: new Date().toISOString(),
    };
}

// ============================================================================
// Components
// ============================================================================

function ProgressBar({ value, color = '#58a6ff' }: { value: number; color?: string }) {
    return (
        <div className="h-2 rounded-full overflow-hidden" style={{ background: '#21262d' }}>
            <div
                className="h-full transition-all duration-300"
                style={{ width: `${value}%`, background: color }}
            />
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    const styles: Record<string, { color: string; bg: string }> = {
        running: { color: '#3fb950', bg: '#3fb95015' },
        paused: { color: '#d29922', bg: '#d2992215' },
        completed: { color: '#58a6ff', bg: '#58a6ff15' },
        failed: { color: '#f85149', bg: '#f8514915' },
        pending: { color: '#8b949e', bg: '#8b949e15' },
    };
    const s = styles[status] || styles.pending;

    return (
        <span
            className="text-[10px] font-mono px-2 py-0.5 rounded"
            style={{ color: s.color, background: s.bg }}
        >
            {status.toUpperCase()}
        </span>
    );
}

function DriftIndicator({ echo }: { echo: EchoReport }) {
    const { severity, hasDrift, totalChange } = echo.driftAnalysis;

    const colors: Record<string, string> = {
        none: '#3fb950',
        low: '#58a6ff',
        medium: '#d29922',
        high: '#f85149',
    };

    const icons: Record<string, typeof AlertTriangle> = {
        none: CheckCircle2,
        low: Activity,
        medium: AlertTriangle,
        high: AlertTriangle,
    };

    const Icon = icons[severity];
    const color = colors[severity];

    return (
        <div className="flex items-center gap-2 p-2 rounded border" style={{ background: `${color}10`, borderColor: `${color}30` }}>
            <Icon size={14} style={{ color }} />
            <div className="flex-1">
                <div className="text-xs font-medium" style={{ color }}>
                    {severity.toUpperCase()} DRIFT
                </div>
                <div className="text-[10px]" style={{ color: '#8b949e' }}>
                    {hasDrift ? 'State deviation detected' : 'Stable execution'}
                </div>
            </div>
            <div className="text-xs font-mono" style={{ color }}>
                {(totalChange * 100).toFixed(1)}%
            </div>
        </div>
    );
}

function CheckpointTimeline({ checkpoints }: { checkpoints: Checkpoint[] }) {
    return (
        <div className="space-y-2">
            {checkpoints.slice().reverse().map((cp, idx) => (
                <div key={cp.id} className="flex items-start gap-3">
                    <div className="flex flex-col items-center">
                        <div
                            className="w-3 h-3 rounded-full"
                            style={{
                                background: cp.isMilestone ? '#d29922' : '#58a6ff',
                            }}
                        />
                        {idx < checkpoints.length - 1 && (
                            <div className="w-0.5 h-8" style={{ background: '#30363d' }} />
                        )}
                    </div>
                    <div className="flex-1 p-2 rounded border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium" style={{ color: 'var(--text-active)' }}>
                                {cp.label}
                            </span>
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-mono" style={{ color: '#58a6ff' }}>
                                    {cp.progress}%
                                </span>
                                {cp.isMilestone && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#d2992215', color: '#d29922' }}>
                                        MILESTONE
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="text-[10px] font-mono mt-1" style={{ color: 'var(--text-secondary)' }}>
                            {new Date(cp.timestamp).toLocaleTimeString()} • {formatDuration(cp.duration)}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

function ActiveTaskPanel({ tracker, echo, actions }: {
    tracker: TaskState;
    echo: EchoReport;
    actions: Partial<UseCheckpointEchoReturn>;
}) {
    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Activity size={20} style={{ color: '#58a6ff' }} />
                    <div>
                        <h2 className="font-bold" style={{ color: 'var(--text-active)' }}>
                            {tracker.name}
                        </h2>
                        <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                            {tracker.taskId}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge status={tracker.status} />
                </div>
            </div>

            {/* Progress */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium" style={{ color: 'var(--text-active)' }}>
                        Overall Progress
                    </span>
                    <span className="text-lg font-bold font-mono" style={{ color: '#58a6ff' }}>
                        {tracker.progress}%
                    </span>
                </div>
                <ProgressBar value={tracker.progress} />
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-2">
                <div className="p-3 rounded border text-center" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
                    <div className="flex justify-center mb-1" style={{ color: '#3fb950' }}>
                        <CheckCircle2 size={16} />
                    </div>
                    <div className="text-lg font-bold font-mono" style={{ color: '#3fb950' }}>
                        {echo.milestones}
                    </div>
                    <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                        Milestones
                    </div>
                </div>
                <div className="p-3 rounded border text-center" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
                    <div className="flex justify-center mb-1" style={{ color: '#58a6ff' }}>
                        <History size={16} />
                    </div>
                    <div className="text-lg font-bold font-mono" style={{ color: '#58a6ff' }}>
                        {echo.totalCheckpoints}
                    </div>
                    <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                        Checkpoints
                    </div>
                </div>
                <div className="p-3 rounded border text-center" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
                    <div className="flex justify-center mb-1" style={{ color: '#d29922' }}>
                        <TrendingUp size={16} />
                    </div>
                    <div className="text-lg font-bold font-mono" style={{ color: '#d29922' }}>
                        {formatVelocity(echo.velocity)}
                    </div>
                    <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                        Velocity
                    </div>
                </div>
            </div>

            {/* Drift Analysis */}
            <DriftIndicator echo={echo} />

            {/* Time Estimate */}
            {echo.estimatedTimeRemaining && (
                <div className="flex items-center gap-2 p-3 rounded border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
                    <Clock size={16} style={{ color: '#58a6ff' }} />
                    <span className="text-sm" style={{ color: 'var(--text-active)' }}>
                        Estimated time remaining
                    </span>
                    <span className="text-sm font-mono ml-auto" style={{ color: '#58a6ff' }}>
                        {Math.floor(echo.estimatedTimeRemaining / 60)}m {echo.estimatedTimeRemaining % 60}s
                    </span>
                </div>
            )}

            {/* Checkpoint Timeline */}
            <div>
                <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-active)' }}>
                    Checkpoint History
                </h3>
                <CheckpointTimeline checkpoints={tracker.checkpoints} />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
                {tracker.status === 'running' ? (
                    <button
                        onClick={actions.pause}
                        className="flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors"
                        style={{ background: '#d2992215', color: '#d29922' }}
                    >
                        <Pause size={14} />
                        Pause
                    </button>
                ) : tracker.status === 'paused' ? (
                    <button
                        onClick={actions.resume}
                        className="flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors"
                        style={{ background: '#3fb95015', color: '#3fb950' }}
                    >
                        <Play size={14} />
                        Resume
                    </button>
                ) : null}

                <button
                    onClick={() => actions.complete?.()}
                    className="flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors"
                    style={{ background: '#3fb95015', color: '#3fb950' }}
                >
                    <Square size={14} />
                    Complete
                </button>

                <button
                    onClick={actions.refreshEcho}
                    className="flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors"
                    style={{ background: '#58a6ff15', color: '#58a6ff' }}
                >
                    <RefreshCw size={14} />
                    Refresh
                </button>

                <button
                    onClick={actions.clear}
                    className="flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors ml-auto"
                    style={{ background: '#f8514915', color: '#f85149' }}
                >
                    <Trash2 size={14} />
                    Clear
                </button>
            </div>
        </div>
    );
}

function DemoModePanel() {
    const demoEcho = generateDemoEcho(DEMO_TRACKER);

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 rounded border" style={{ background: '#58a6ff10', borderColor: '#58a6ff30' }}>
                <Radio size={14} style={{ color: '#58a6ff' }} />
                <span className="text-sm" style={{ color: 'var(--text-active)' }}>
                    Demo Mode — Showing sample checkpoint data
                </span>
            </div>

            <ActiveTaskPanel
                tracker={DEMO_TRACKER}
                echo={demoEcho}
                actions={{}}
            />
        </div>
    );
}

// ============================================================================
// Main Component
// ============================================================================

export default function CheckpointEchoModule() {
    const { isLive } = useMode();
    const [taskId, setTaskId] = useState('my-long-task');
    const [taskName, setTaskName] = useState('Long Running Process');

    // Use actual tracker in live mode
    const tracker = useCheckpointEcho({
        taskId,
        name: taskName,
        autoSave: true,
        echoInterval: 3000,
    });

    // In demo mode, show demo data
    if (!isLive) {
        return (
            <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
                <div className="flex items-center gap-3 mb-6">
                    <Activity size={20} style={{ color: '#58a6ff' }} />
                    <h1 className="text-lg font-bold" style={{ color: 'var(--text-active)' }}>
                        Checkpoint Echo
                    </h1>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: '#8b949e20', color: '#8b949e' }}>
                        TEST
                    </span>
                </div>
                <DemoModePanel />
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <Activity size={20} style={{ color: '#58a6ff' }} />
                <h1 className="text-lg font-bold" style={{ color: 'var(--text-active)' }}>
                    Checkpoint Echo
                </h1>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: '#3fb95015', color: '#3fb950' }}>
                    LIVE
                </span>
            </div>

            {/* Task Creator */}
            {!tracker.tracker && (
                <div className="p-4 rounded border mb-6" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
                    <h3 className="text-sm font-medium mb-4" style={{ color: 'var(--text-active)' }}>
                        Create New Task Tracker
                    </h3>
                    <div className="space-y-3">
                        <div>
                            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                                Task ID
                            </label>
                            <input
                                type="text"
                                value={taskId}
                                onChange={(e) => setTaskId(e.target.value)}
                                className="w-full px-3 py-2 rounded text-sm"
                                style={{ background: 'var(--bg-editor)', borderColor: 'var(--border-color)', color: 'var(--text-active)' }}
                                placeholder="unique-task-id"
                            />
                        </div>
                        <div>
                            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                                Task Name
                            </label>
                            <input
                                type="text"
                                value={taskName}
                                onChange={(e) => setTaskName(e.target.value)}
                                className="w-full px-3 py-2 rounded text-sm"
                                style={{ background: 'var(--bg-editor)', borderColor: 'var(--border-color)', color: 'var(--text-active)' }}
                                placeholder="Long running process"
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Active Task */}
            {tracker.tracker && tracker.echo ? (
                <ActiveTaskPanel
                    tracker={tracker.tracker}
                    echo={tracker.echo}
                    actions={tracker}
                />
            ) : (
                <div className="text-center py-12" style={{ color: 'var(--text-secondary)' }}>
                    <Activity size={48} style={{ opacity: 0.3 }} />
                    <p className="mt-4">No active task tracker</p>
                    <p className="text-xs mt-1">Create a new task above to start tracking</p>
                </div>
            )}
        </div>
    );
}