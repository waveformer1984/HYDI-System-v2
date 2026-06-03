/**
 * Vector Checkpoint System — Echo-based Progress Tracking for Long Duration Tasks
 * 
 * Provides checkpoint creation, vector similarity comparison, and echo feedback
 * for tracking progress through complex, long-running operations.
 * 
 * Concepts:
 * - Checkpoint: A snapshot of task state at a specific point in time
 * - Vector Embedding: Numerical representation of task state for similarity comparison
 * - Echo: Periodic feedback showing checkpoint history and progress drift
 * 
 * Usage:
 * 1. Create a task tracker: const tracker = createTaskTracker('task-id')
 * 2. Add checkpoints as task progresses
 * 3. Use vector similarity to detect state drift
 * 4. Generate echo reports for user feedback
 */

/**
 * Generate a unique ID using crypto.randomUUID
 */
function generateId(): string {
    return typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================================================
// Types
// ============================================================================

export interface VectorEmbedding {
    /** Embedding dimensions - simplified numeric representation */
    dimensions: Record<string, number>;
    /** Optional metadata about the embedding source */
    metadata?: Record<string, unknown>;
}

export interface Checkpoint {
    /** Unique checkpoint identifier */
    id: string;
    /** Task/operation this checkpoint belongs to */
    taskId: string;
    /** Sequential checkpoint number within task */
    sequence: number;
    /** Human-readable label for this checkpoint */
    label: string;
    /** Current progress percentage (0-100) */
    progress: number;
    /** State embedding at this checkpoint */
    embedding: VectorEmbedding;
    /** Timestamp when checkpoint was created */
    timestamp: string;
    /** Optional notes or status message */
    notes?: string;
    /** Duration in milliseconds from task start */
    duration: number;
    /** Whether this checkpoint represents a milestone */
    isMilestone: boolean;
}

export interface TaskState {
    /** Task identifier */
    taskId: string;
    /** Human-readable task name */
    name: string;
    /** Current overall progress (0-100) */
    progress: number;
    /** Current state embedding */
    embedding: VectorEmbedding;
    /** Checkpoints recorded for this task */
    checkpoints: Checkpoint[];
    /** When the task started */
    startedAt: string;
    /** When the task completed (null if in progress) */
    completedAt: string | null;
    /** Task status */
    status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
    /** Total duration when completed */
    totalDuration?: number;
    /** Maximum number of checkpoints to retain */
    maxCheckpoints?: number;
}

export interface EchoReport {
    /** Task being reported on */
    taskId: string;
    /** Total checkpoints recorded */
    totalCheckpoints: number;
    /** Milestones reached */
    milestones: number;
    /** Overall progress percentage */
    progress: number;
    /** Current velocity (progress per minute) */
    velocity: number;
    /** Drift analysis from initial state */
    driftAnalysis: DriftAnalysis;
    /** Checkpoint history for display */
    history: CheckpointSummary[];
    /** Estimated time remaining in seconds */
    estimatedTimeRemaining: number | null;
    /** Timestamp of this report */
    generatedAt: string;
}

export interface CheckpointSummary {
    id: string;
    sequence: number;
    label: string;
    progress: number;
    isMilestone: boolean;
    timestamp: string;
    notes?: string;
}

export interface DriftAnalysis {
    /** Cosine similarity from initial checkpoint */
    initialSimilarity: number;
    /** Similarity from previous checkpoint */
    previousSimilarity: number;
    /** Total state change magnitude */
    totalChange: number;
    /** Whether significant drift was detected */
    hasDrift: boolean;
    /** Drift severity level */
    severity: 'none' | 'low' | 'medium' | 'high';
}

export interface TaskTrackerConfig {
    /** Enable automatic checkpoint on progress change */
    autoCheckpoint?: boolean;
    /** Minimum progress delta before auto-checkpoint */
    minProgressDelta?: number;
    /** Enable drift detection */
    enableDriftDetection?: boolean;
    /** Drift threshold for alert (0-1, lower = more sensitive) */
    driftThreshold?: number;
    /** Maximum checkpoints to retain (FIFO when exceeded) */
    maxCheckpoints?: number;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Create a new task tracker with initial state
 */
export function createTaskTracker(
    taskId: string,
    name: string,
    initialEmbedding?: VectorEmbedding,
    config?: TaskTrackerConfig
): TaskState {
    const now = new Date().toISOString();

    return {
        taskId,
        name,
        progress: 0,
        embedding: initialEmbedding || createEmptyEmbedding(),
        checkpoints: [],
        startedAt: now,
        completedAt: null,
        status: 'pending',
        ...config,
    };
}

/**
 * Start a task (change from pending to running)
 */
export function startTask(tracker: TaskState): TaskState {
    if (tracker.status !== 'pending' && tracker.status !== 'paused') {
        throw new Error(`Cannot start task in status: ${tracker.status}`);
    }

    return {
        ...tracker,
        status: 'running',
        checkpoints: tracker.checkpoints.length > 0
            ? tracker.checkpoints
            : [createInitialCheckpoint(tracker)],
    };
}

/**
 * Create the initial checkpoint for a task
 */
function createInitialCheckpoint(tracker: TaskState): Checkpoint {
    const now = new Date().toISOString();
    const duration = 0;

    return {
        id: generateId(),
        taskId: tracker.taskId,
        sequence: 0,
        label: 'Task Started',
        progress: 0,
        embedding: { ...tracker.embedding },
        timestamp: now,
        duration,
        isMilestone: true,
    };
}

/**
 * Add a checkpoint to track progress
 */
export function addCheckpoint(
    tracker: TaskState,
    options: {
        label?: string;
        progress: number;
        embedding?: VectorEmbedding;
        notes?: string;
        isMilestone?: boolean;
    }
): TaskState {
    const now = new Date();
    const startedAt = new Date(tracker.startedAt);
    const duration = now.getTime() - startedAt.getTime();

    const lastCheckpoint = tracker.checkpoints[tracker.checkpoints.length - 1];
    const sequence = lastCheckpoint ? lastCheckpoint.sequence + 1 : 0;

    const checkpoint: Checkpoint = {
        id: generateId(),
        taskId: tracker.taskId,
        sequence,
        label: options.label || `Checkpoint ${sequence}`,
        progress: options.progress,
        embedding: options.embedding || { ...tracker.embedding },
        timestamp: now.toISOString(),
        notes: options.notes,
        duration,
        isMilestone: options.isMilestone || false,
    };

    const checkpoints = [...tracker.checkpoints, checkpoint];

    // Apply max checkpoints limit
    const maxCheckpoints = tracker.maxCheckpoints ?? 100;
    if (checkpoints.length > maxCheckpoints) {
        checkpoints.splice(0, checkpoints.length - maxCheckpoints);
    }

    return {
        ...tracker,
        progress: options.progress,
        embedding: options.embedding || tracker.embedding,
        checkpoints,
    };
}

/**
 * Complete a task
 */
export function completeTask(tracker: TaskState, finalEmbedding?: VectorEmbedding): TaskState {
    const now = new Date();
    const startedAt = new Date(tracker.startedAt);
    const totalDuration = now.getTime() - startedAt.getTime();

    // Add final checkpoint if not already at 100%
    let checkpoints = tracker.checkpoints;
    if (tracker.progress < 100) {
        checkpoints = [
            ...checkpoints,
            {
                id: generateId(),
                taskId: tracker.taskId,
                sequence: checkpoints.length,
                label: 'Task Completed',
                progress: 100,
                embedding: finalEmbedding || { ...tracker.embedding },
                timestamp: now.toISOString(),
                duration: totalDuration,
                isMilestone: true,
            },
        ];
    }

    return {
        ...tracker,
        progress: 100,
        embedding: finalEmbedding || tracker.embedding,
        checkpoints,
        status: 'completed',
        completedAt: now.toISOString(),
        totalDuration,
    };
}

/**
 * Mark a task as failed
 */
export function failTask(tracker: TaskState, error: string): TaskState {
    const now = new Date();
    const startedAt = new Date(tracker.startedAt);
    const totalDuration = now.getTime() - startedAt.getTime();

    return {
        ...tracker,
        status: 'failed',
        completedAt: now.toISOString(),
        totalDuration,
        checkpoints: [
            ...tracker.checkpoints,
            {
                id: generateId(),
                taskId: tracker.taskId,
                sequence: tracker.checkpoints.length,
                label: 'Task Failed',
                progress: tracker.progress,
                embedding: { ...tracker.embedding },
                timestamp: now.toISOString(),
                notes: error,
                duration: totalDuration,
                isMilestone: false,
            },
        ],
    };
}

/**
 * Pause a task
 */
export function pauseTask(tracker: TaskState): TaskState {
    if (tracker.status !== 'running') {
        throw new Error(`Cannot pause task in status: ${tracker.status}`);
    }

    return {
        ...tracker,
        status: 'paused',
    };
}

/**
 * Resume a paused task
 */
export function resumeTask(tracker: TaskState): TaskState {
    if (tracker.status !== 'paused') {
        throw new Error(`Cannot resume task in status: ${tracker.status}`);
    }

    return {
        ...tracker,
        status: 'running',
    };
}

// ============================================================================
// Vector Operations
// ============================================================================

/**
 * Create an empty embedding with zero values
 */
export function createEmptyEmbedding(): VectorEmbedding {
    return { dimensions: {} };
}

/**
 * Create an embedding from a state object
 * Converts flat object to dimension map
 */
export function embeddingFromState(state: Record<string, number>): VectorEmbedding {
    return { dimensions: state };
}

/**
 * Calculate cosine similarity between two embeddings
 * Returns value between -1 and 1 (1 = identical)
 */
export function cosineSimilarity(a: VectorEmbedding, b: VectorEmbedding): number {
    const allKeys = new Set([...Object.keys(a.dimensions), ...Object.keys(b.dimensions)]);

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (const key of allKeys) {
        const valA = a.dimensions[key] || 0;
        const valB = b.dimensions[key] || 0;

        dotProduct += valA * valB;
        normA += valA * valA;
        normB += valB * valB;
    }

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Calculate Euclidean distance between two embeddings
 */
export function euclideanDistance(a: VectorEmbedding, b: VectorEmbedding): number {
    const allKeys = new Set([...Object.keys(a.dimensions), ...Object.keys(b.dimensions)]);

    let sumSquaredDiff = 0;
    for (const key of allKeys) {
        const diff = (a.dimensions[key] || 0) - (b.dimensions[key] || 0);
        sumSquaredDiff += diff * diff;
    }

    return Math.sqrt(sumSquaredDiff);
}

/**
 * Calculate magnitude (L2 norm) of an embedding
 */
export function magnitude(embedding: VectorEmbedding): number {
    let sumSquared = 0;
    for (const val of Object.values(embedding.dimensions)) {
        sumSquared += val * val;
    }
    return Math.sqrt(sumSquared);
}

/**
 * Detect drift between two embeddings
 */
export function detectDrift(
    current: VectorEmbedding,
    previous: VectorEmbedding,
    threshold: number = 0.1
): DriftAnalysis {
    const similarity = cosineSimilarity(current, previous);
    const distance = euclideanDistance(current, previous);

    // Normalize distance to a 0-1 scale based on typical magnitudes
    const normalizedChange = Math.min(distance / 10, 1);

    let severity: DriftAnalysis['severity'];
    if (similarity > 0.95) {
        severity = 'none';
    } else if (similarity > 0.8) {
        severity = 'low';
    } else if (similarity > 0.6) {
        severity = 'medium';
    } else {
        severity = 'high';
    }

    return {
        initialSimilarity: similarity,
        previousSimilarity: similarity,
        totalChange: normalizedChange,
        hasDrift: similarity < (1 - threshold),
        severity,
    };
}

// ============================================================================
// Echo Report Generation
// ============================================================================

/**
 * Generate an echo report for a task
 */
export function generateEcho(tracker: TaskState): EchoReport {
    const checkpoints = tracker.checkpoints;
    const now = new Date();

    // Calculate velocity (progress per minute)
    let velocity = 0;
    if (checkpoints.length >= 2) {
        const first = checkpoints[0];
        const last = checkpoints[checkpoints.length - 1];
        const firstTime = new Date(first.timestamp).getTime();
        const lastTime = new Date(last.timestamp).getTime();
        const durationMinutes = (lastTime - firstTime) / 60000;

        if (durationMinutes > 0) {
            velocity = (last.progress - first.progress) / durationMinutes;
        }
    }

    // Estimate time remaining
    let estimatedTimeRemaining: number | null = null;
    if (tracker.status === 'running' && velocity > 0) {
        const remaining = 100 - tracker.progress;
        estimatedTimeRemaining = Math.ceil((remaining / velocity) * 60); // in seconds
    }

    // Drift analysis from initial state
    const initialEmbedding = checkpoints[0]?.embedding || tracker.embedding;
    const currentEmbedding = tracker.embedding;
    const driftAnalysis = detectDrift(currentEmbedding, initialEmbedding, 0.1);

    // Generate checkpoint history summary
    const history: CheckpointSummary[] = checkpoints.map(cp => ({
        id: cp.id,
        sequence: cp.sequence,
        label: cp.label,
        progress: cp.progress,
        isMilestone: cp.isMilestone,
        timestamp: cp.timestamp,
        notes: cp.notes,
    }));

    return {
        taskId: tracker.taskId,
        totalCheckpoints: checkpoints.length,
        milestones: checkpoints.filter(cp => cp.isMilestone).length,
        progress: tracker.progress,
        velocity,
        driftAnalysis,
        history,
        estimatedTimeRemaining,
        generatedAt: now.toISOString(),
    };
}

// ============================================================================
// Serialization / Persistence
// ============================================================================

/**
 * Serialize a task tracker to JSON
 */
export function serializeTracker(tracker: TaskState): string {
    return JSON.stringify(tracker);
}

/**
 * Deserialize a task tracker from JSON
 */
export function deserializeTracker(json: string): TaskState {
    return JSON.parse(json) as TaskState;
}

/**
 * Save tracker to localStorage
 */
export function saveTracker(tracker: TaskState): void {
    if (typeof window === 'undefined') return;

    const key = `checkpoint-tracker-${tracker.taskId}`;
    localStorage.setItem(key, serializeTracker(tracker));
}

/**
 * Load tracker from localStorage
 */
export function loadTracker(taskId: string): TaskState | null {
    if (typeof window === 'undefined') return null;

    const key = `checkpoint-tracker-${taskId}`;
    const json = localStorage.getItem(key);
    if (!json) return null;

    try {
        return deserializeTracker(json);
    } catch {
        return null;
    }
}

/**
 * Delete tracker from localStorage
 */
export function deleteTracker(taskId: string): void {
    if (typeof window === 'undefined') return;

    const key = `checkpoint-tracker-${taskId}`;
    localStorage.removeItem(key);
}

/**
 * List all saved tracker IDs
 */
export function listTrackerIds(): string[] {
    if (typeof window === 'undefined') return [];

    const ids: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('checkpoint-tracker-')) {
            ids.push(key.replace('checkpoint-tracker-', ''));
        }
    }
    return ids;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format duration in milliseconds to human readable string
 */
export function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * Format velocity (progress per minute) to readable string
 */
export function formatVelocity(progressPerMinute: number): string {
    if (progressPerMinute < 0.1) return '~0%';
    return `${progressPerMinute.toFixed(1)}%/min`;
}

/**
 * Calculate total progress percentage from checkpoints
 */
export function calculateProgress(checkpoints: Checkpoint[]): number {
    if (checkpoints.length === 0) return 0;

    const last = checkpoints[checkpoints.length - 1];
    return last.progress;
}