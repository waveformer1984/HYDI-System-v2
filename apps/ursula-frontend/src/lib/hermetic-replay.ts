// HERMETIC REPLAY ENGINE - Zero memory contamination
// Each replay runs in complete isolation

import { EventSourcedLedger, TaskEvent } from './event-sourced-ledger.js';
import { TaskState, TaskStateProjection } from './task-state-projection.js';

export interface HermeticReplayResult {
  success: boolean;
  eventsProcessed: number;
  tasksReconstructed: number;
  finalStateHash: string;
  executionTimeMs: number;
  memoryFootprint: number;
  contaminationDetected: boolean;
}

export class HermeticReplayEngine {
  private ledger: EventSourcedLedger;

  constructor(ledger: EventSourcedLedger) {
    this.ledger = ledger;
  }

  /**
   * Execute replay in complete isolation - no shared state
   */
  async executeHermeticReplay(fromSequence: number = 0, toSequence?: number): Promise<HermeticReplayResult> {
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;

    // Create entirely new projection - no shared state
    const isolatedProjection = new TaskStateProjection(this.ledger);
    
    try {
      // Load events directly from ledger - no caching
      const events = await this.ledger.replayEvents(fromSequence);
      const targetEvents = toSequence 
        ? events.filter(e => e.sequence_number <= toSequence)
        : events;

      // Apply events in isolation
      let eventsProcessed = 0;
      for (const event of targetEvents) {
        await isolatedProjection.applyEvent(event);
        eventsProcessed++;
      }

      // Calculate state hash
      const stateHash = await this.calculateIsolatedHash(isolatedProjection);

      // Check for contamination
      const endMemory = process.memoryUsage().heapUsed;
      const memoryFootprint = endMemory - startMemory;
      const contaminationDetected = memoryFootprint > 10 * 1024 * 1024; // 10MB threshold

      return {
        success: true,
        eventsProcessed,
        tasksReconstructed: isolatedProjection.getAllTasks().length,
        finalStateHash: stateHash,
        executionTimeMs: Date.now() - startTime,
        memoryFootprint,
        contaminationDetected
      };

    } catch (error) {
      return {
        success: false,
        eventsProcessed: 0,
        tasksReconstructed: 0,
        finalStateHash: '',
        executionTimeMs: Date.now() - startTime,
        memoryFootprint: process.memoryUsage().heapUsed - startMemory,
        contaminationDetected: true
      };
    }
  }

  /**
   * Calculate hash without external dependencies
   */
  private async calculateIsolatedHash(projection: TaskStateProjection): Promise<string> {
    const tasks = projection.getAllTasks();
    
    // Canonical sorting
    const sortedTasks = tasks.sort((a, b) => a.task_id.localeCompare(b.task_id));
    
    // Pure JSON stringification - no replacer functions that could capture scope
    const stateString = JSON.stringify(sortedTasks);
    
    // Use Node.js crypto directly - no external libraries
    const crypto = await import('crypto');
    return crypto.createHash('sha256').update(stateString).digest('hex');
  }

  /**
   * Verify hermetic properties across multiple runs
   */
  async verifyHermeticProperties(iterations: number = 10): Promise<{
    hermetic: boolean;
    consistent: boolean;
    results: HermeticReplayResult[];
    contaminationEvents: string[];
  }> {
    const results: HermeticReplayResult[] = [];
    const contaminationEvents: string[] = [];
    
    for (let i = 0; i < iterations; i++) {
      // Force garbage collection between runs if available
      if (global.gc) {
        global.gc();
      }
      
      const result = await this.executeHermeticReplay();
      results.push(result);
      
      if (result.contaminationDetected) {
        contaminationEvents.push(`Run ${i + 1}: ${result.memoryFootprint} bytes`);
      }
    }
    
    // Check consistency
    const firstHash = results[0]?.finalStateHash;
    const consistent = results.every(r => r.finalStateHash === firstHash);
    
    // Check hermeticity (no memory growth)
    const memoryGrowth = results.map(r => r.memoryFootprint);
    const avgMemory = memoryGrowth.reduce((a, b) => a + b, 0) / memoryGrowth.length;
    const hermetic = memoryGrowth.every(m => m < avgMemory * 2); // Allow 2x variation
    
    return {
      hermetic,
      consistent,
      results,
      contaminationEvents
    };
  }
}
