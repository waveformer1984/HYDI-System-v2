# Vector Checkpoint Echo System

Echo-based progress tracking for long-duration tasks using vector embeddings.

## Overview

This system provides checkpoint creation, vector similarity comparison, and echo feedback for tracking progress through complex, long-running operations.

### Key Concepts

- **Checkpoint**: A snapshot of task state at a specific point in time
- **Vector Embedding**: Numerical representation of task state for similarity comparison
- **Echo**: Periodic feedback showing checkpoint history and progress drift

## Architecture

```
src/
├── lib/
│   └── vector-checkpoint.ts     # Core utilities and types
├── hooks/
│   ├── index.ts                 # Export all hooks
│   └── useCheckpointEcho.ts     # React hook for checkpoint tracking
└── components/
    └── modules/
        └── CheckpointEchoModule.tsx  # Visual dashboard
```

## Usage

### Basic Usage with React Hook

```typescript
import { useCheckpointEcho } from '@/hooks/useCheckpointEcho';

function MyLongTask() {
  const { tracker, progress, echo, checkpoint, complete } = useCheckpointEcho({
    taskId: 'build-process',
    name: 'Full System Build',
    onProgress: (p) => console.log('Progress:', p),
    onDrift: (severity) => console.log('Drift:', severity),
  });

  // During task execution:
  checkpoint('Dependencies installed', 15, { deps: 1 });
  checkpoint('Type checking passed', 25, { types: 1 });
  milestone('Build complete', 100);

  // Complete task:
  complete({ finalEmbedding });
}
```

### Direct API Usage

```typescript
import {
  createTaskTracker,
  addCheckpoint,
  completeTask,
  generateEcho,
  cosineSimilarity,
} from '@/lib/vector-checkpoint';

// Create tracker
const tracker = createTaskTracker('task-1', 'My Task');

// Add checkpoints
tracker = addCheckpoint(tracker, { 
  label: 'Phase 1', 
  progress: 25,
  embedding: { dimensions: { phase: 1 } },
  isMilestone: true,
});

// Generate echo report
const echo = generateEcho(tracker);
console.log(echo.progress); // 25
console.log(echo.driftAnalysis); // Drift analysis

// Check similarity
const similarity = cosineSimilarity(embeddingA, embeddingB);
```

### Vector Similarity

```typescript
import { cosineSimilarity, euclideanDistance } from '@/lib/vector-checkpoint';

const embeddingA = { dimensions: { x: 1, y: 2 } };
const embeddingB = { dimensions: { x: 2, y: 4 } };

const similarity = cosineSimilarity(embeddingA, embeddingB); // 1.0 (identical)
const distance = euclideanDistance(embeddingA, embeddingB); // ~2.24
```

## API Reference

### Core Functions

| Function | Description |
|----------|-------------|
| `createTaskTracker(taskId, name, embedding?, config?)` | Create a new task tracker |
| `startTask(tracker)` | Change status from pending to running |
| `addCheckpoint(tracker, options)` | Add a checkpoint with progress |
| `completeTask(tracker, embedding?)` | Mark task as completed |
| `failTask(tracker, error)` | Mark task as failed |
| `pauseTask(tracker)` | Pause a running task |
| `resumeTask(tracker)` | Resume a paused task |
| `generateEcho(tracker)` | Generate progress echo report |
| `cosineSimilarity(a, b)` | Calculate similarity between embeddings |
| `euclideanDistance(a, b)` | Calculate distance between embeddings |

### Hook Return Values

| Property | Type | Description |
|----------|------|-------------|
| `tracker` | `TaskState \| null` | Current task state |
| `progress` | `number` | Current progress (0-100) |
| `echo` | `EchoReport \| null` | Latest echo report |
| `isRunning` | `boolean` | Task is running |
| `isPaused` | `boolean` | Task is paused |
| `isCompleted` | `boolean` | Task completed |
| `checkpointCount` | `number` | Total checkpoints |
| `checkpoint(label, progress, embedding?, notes?)` | Function | Add checkpoint |
| `milestone(label, progress, embedding?, notes?)` | Function | Add milestone |
| `pause()`, `resume()`, `complete()`, `fail(error)` | Functions | State control |
| `clear()` | Function | Delete tracker |

### Types

```typescript
interface VectorEmbedding {
  dimensions: Record<string, number>;
  metadata?: Record<string, unknown>;
}

interface Checkpoint {
  id: string;
  taskId: string;
  sequence: number;
  label: string;
  progress: number;
  embedding: VectorEmbedding;
  timestamp: string;
  duration: number;
  isMilestone: boolean;
  notes?: string;
}

interface EchoReport {
  taskId: string;
  totalCheckpoints: number;
  milestones: number;
  progress: number;
  velocity: number;
  driftAnalysis: DriftAnalysis;
  history: CheckpointSummary[];
  estimatedTimeRemaining: number | null;
  generatedAt: string;
}

interface DriftAnalysis {
  initialSimilarity: number;
  previousSimilarity: number;
  totalChange: number;
  hasDrift: boolean;
  severity: 'none' | 'low' | 'medium' | 'high';
}
```

## Features

### Drift Detection

The system tracks state drift using vector similarity:

- **None**: >95% similarity
- **Low**: >80% similarity
- **Medium**: >60% similarity
- **High**: <60% similarity

### Auto-Save

Trackers automatically persist to localStorage:

```typescript
const tracker = useCheckpointEcho({
  taskId: 'my-task',
  name: 'Task',
  autoSave: true, // Default
});
```

### Progress Velocity

The echo report calculates progress velocity:

```typescript
echo.velocity // progress per minute
```

### Estimated Time Remaining

Based on current velocity:

```typescript
echo.estimatedTimeRemaining // in seconds
```

## UI Module

The `CheckpointEchoModule` provides a visual dashboard:

1. Progress bar with milestones
2. Checkpoint timeline
3. Drift analysis indicator
4. Velocity metrics
5. Time estimates
6. Pause/resume/complete controls

## Configuration

```typescript
interface TaskTrackerConfig {
  autoCheckpoint?: boolean;
  minProgressDelta?: number;
  enableDriftDetection?: boolean;
  driftThreshold?: number;
  maxCheckpoints?: number;
}
```

## Best Practices

1. **Add meaningful embeddings**: Track relevant state metrics
2. **Use milestones**: Mark significant achievements
3. **Check drift**: Monitor for unexpected state changes
4. **Set intervals**: Balance between detail and noise
5. **Handle failures**: Use `fail()` for error tracking

## Example: Multi-Phase Task

```typescript
const { checkpoint, milestone, complete } = useCheckpointEcho({
  taskId: 'data-pipeline',
  name: 'Data Processing Pipeline',
});

async function runPipeline() {
  // Phase 1
  await loadData();
  checkpoint('Data loaded', 20, { rows: 1000000 });
  
  // Phase 2
  await cleanData();
  checkpoint('Data cleaned', 40, { cleanRows: 950000 });
  
  // Phase 3
  await transformData();
  checkpoint('Data transformed', 60, { features: 500 });
  
  // Phase 4
  await trainModel();
  milestone('Model trained', 80, { accuracy: 0.95 });
  
  // Phase 5
  await evaluate();
  complete({ finalEmbedding: { metrics: ... } });
}
```