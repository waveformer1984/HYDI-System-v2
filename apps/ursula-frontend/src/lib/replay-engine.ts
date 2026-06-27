// DETERMINISTIC REPLAY ENGINE - The Supreme Court of Truth
// Proves the system is consistent with its own history

import { EventSourcedLedger, TaskEvent } from './event-sourced-ledger.js';
import { TaskStateProjection, TaskState } from './task-state-projection.js';
import { createHash } from 'crypto';

export interface ReplayResult {
  success: boolean;
  eventsProcessed: number;
  tasksReconstructed: number;
  finalStateHash: string;
  expectedStateHash?: string;
  integrityIssues: string[];
  replayTimeMs: number;
}

export interface ForensicCheckpoint {
  checkpoint_id: string;
  sequence_number: number;
  state_hash: string;
  timestamp: string;
  task_count: number;
}

export class DeterministicReplayEngine {
  private ledger: EventSourcedLedger;
  private projection: TaskStateProjection;

  constructor(ledger: EventSourcedLedger) {
    this.ledger = ledger;
    this.projection = new TaskStateProjection(ledger);
  }

  /**
   * The "Empty Room" Test - Wipe and rebuild from pure history
   */
  async executeReplay(fromSequence: number = 0): Promise<ReplayResult> {
    const startTime = Date.now();
    const issues: string[] = [];

    try {
      // Step 1: Validate log integrity before replay
      const integrityCheck = await this.validateLogIntegrity(fromSequence);
      if (!integrityCheck.valid) {
        issues.push(...integrityCheck.issues);
        return {
          success: false,
          eventsProcessed: 0,
          tasksReconstructed: 0,
          finalStateHash: '',
          integrityIssues: issues,
          replayTimeMs: Date.now() - startTime
        };
      }

      // Step 2: Find expected checkpoint before replay (if any)
      const expectedCheckpoint = await this.findCheckpointAtOrBefore(fromSequence);
      const targetSequence = expectedCheckpoint?.sequence_number;

      // Step 3: Wipe current projection (start from empty room)
      await this.projection.rebuild(); // This clears and rebuilds from events

      // Step 4: Stream events and materialize state up to target sequence
      const events = await this.ledger.replayEvents(fromSequence);
      let eventsProcessed = 0;

      for (const event of events) {
        await this.projection.applyEvent(event);
        eventsProcessed++;

        // Stop at target sequence if specified
        if (targetSequence && event.sequence_number >= targetSequence) {
          break;
        }
      }

      // Step 5: Calculate forensic hash of final state
      const finalStateHash = await this.calculateStateHash();
      const expectedStateHash = expectedCheckpoint?.state_hash;

      const tasksReconstructed = this.projection.getAllTasks().length;

      // Step 6: Final verification
      if (expectedStateHash && finalStateHash !== expectedStateHash) {
        issues.push(`State hash mismatch: expected ${expectedStateHash}, got ${finalStateHash}`);
      }

      return {
        success: issues.length === 0,
        eventsProcessed,
        tasksReconstructed,
        finalStateHash,
        expectedStateHash,
        integrityIssues: issues,
        replayTimeMs: Date.now() - startTime
      };

    } catch (error) {
      issues.push(`Replay execution failed: ${error}`);
      return {
        success: false,
        eventsProcessed: 0,
        tasksReconstructed: 0,
        finalStateHash: '',
        integrityIssues: issues,
        replayTimeMs: Date.now() - startTime
      };
    }
  }

  /**
   * Validate log continuity - detect gaps in sequence
   */
  private async validateLogIntegrity(fromSequence: number): Promise<{ valid: boolean; issues: string[] }> {
    const issues: string[] = [];
    const events = await this.ledger.replayEvents(fromSequence);

    if (events.length === 0) {
      return { valid: true, issues: [] };
    }

    // Check sequence continuity
    for (let i = 1; i < events.length; i++) {
      const current = events[i];
      const previous = events[i - 1];

      if (current.sequence_number !== previous.sequence_number + 1) {
        issues.push(
          `Sequence gap detected: event ${previous.sequence_number} -> ${current.sequence_number}`
        );
      }
    }

    // Validate event structure
    for (const event of events) {
      if (!event.event_id || !event.event_type || !event.task_id) {
        issues.push(`Malformed event at sequence ${event.sequence_number}`);
      }
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }

  /**
   * Calculate forensic hash of entire state
   */
  private async calculateStateHash(): Promise<string> {
    const tasks = this.projection.getAllTasks();

    // Sort tasks by ID for deterministic ordering
    const sortedTasks = tasks.sort((a, b) => a.task_id.localeCompare(b.task_id));

    // Create canonical JSON representation
    const stateString = JSON.stringify(sortedTasks, null, 2);

    return createHash('sha256').update(stateString).digest('hex');
  }

  /**
   * Find checkpoint at or before sequence number (the most recent checkpoint not past the sequence)
   */
  private async findCheckpointAtOrBefore(sequence: number): Promise<ForensicCheckpoint | null> {
    const fs = await import('fs/promises');

    try {
      const data = await fs.readFile('./data/checkpoints.log', 'utf-8');
      const lines = data.trim().split('\n').filter(line => line.length > 0);

      let latestCheckpoint: ForensicCheckpoint | null = null;

      for (const line of lines) {
        try {
          const checkpoint = JSON.parse(line) as ForensicCheckpoint;
          if (checkpoint.sequence_number <= sequence) {
            if (!latestCheckpoint || checkpoint.sequence_number > latestCheckpoint.sequence_number) {
              latestCheckpoint = checkpoint;
            }
          }
        } catch {
          // Skip malformed checkpoint lines
        }
      }

      return latestCheckpoint;
    } catch {
      // No checkpoints file exists
    }

    return null;
  }

  /**
   * Create a checkpoint of current state at exact sequence boundary
   */
  async createCheckpoint(atSequence?: number): Promise<ForensicCheckpoint> {
    const events = await this.ledger.replayEvents();
    const lastSequence = atSequence ?? (events.length > 0 ? events[events.length - 1].sequence_number : 0);

    // If atSequence specified, rebuild projection to that exact point
    if (atSequence !== undefined) {
      await this.projection.rebuild();
      const eventsToSequence = events.filter(e => e.sequence_number <= atSequence);
      for (const event of eventsToSequence) {
        await this.projection.applyEvent(event);
      }
    }

    const stateHash = await this.calculateStateHash();

    const checkpoint: ForensicCheckpoint = {
      checkpoint_id: `ckpt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sequence_number: lastSequence,
      state_hash: stateHash,
      timestamp: new Date().toISOString(),
      task_count: this.projection.getAllTasks().length
    };

    // Append to checkpoints log
    const fs = await import('fs/promises');
    await fs.appendFile('./data/checkpoints.log', JSON.stringify(checkpoint) + '\n');

    return checkpoint;
  }

  /**
   * Fork timeline at specific event for debugging
   */
  async forkTimeline(atSequence: number): Promise<TaskState[]> {
    // Create temporary projection for fork
    const forkProjection = new TaskStateProjection(this.ledger);
    await forkProjection.rebuild();

    const events = await this.ledger.replayEvents(0);
    const forkEvents = events.filter(e => e.sequence_number <= atSequence);

    for (const event of forkEvents) {
      await forkProjection.applyEvent(event);
    }

    return forkProjection.getAllTasks();
  }

  /**
   * Verify deterministic replay multiple times
   */
  async verifyDeterminism(iterations: number = 3): Promise<{ deterministic: boolean; results: ReplayResult[] }> {
    const results: ReplayResult[] = [];

    for (let i = 0; i < iterations; i++) {
      const result = await this.executeReplay();
      results.push(result);

      if (!result.success) {
        return { deterministic: false, results };
      }
    }

    // Check if all results produced the same hash
    const firstHash = results[0].finalStateHash;
    const allSameHash = results.every(r => r.finalStateHash === firstHash);

    return {
      deterministic: allSameHash,
      results
    };
  }
}
