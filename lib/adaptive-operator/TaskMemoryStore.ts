/**
 * HYDI Task Memory
 *
 * Scoped, persistent memory for a single goal.
 * Records observations, decisions, actions, outcomes, failed approaches,
 * successful approaches, environmental facts, blockers, and human interventions.
 *
 * Secrets are NEVER stored.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { TaskMemory, TaskMemoryEntry, TaskMemoryType } from './AdaptiveOperatorTypes';

export class TaskMemoryStore {
  private memories: Map<string, TaskMemory> = new Map();
  private memoryDir: string;

  constructor(rootDir: string) {
    this.memoryDir = path.resolve(rootDir, '.hydi', 'task-memory');
  }

  /**
   * Create or get task memory for a goal.
   */
  forGoal(goalId: string): TaskMemory {
    let memory = this.memories.get(goalId);
    if (!memory) {
      memory = {
        goalId,
        entries: [],
        maxEntries: 1000,
      };
      this.memories.set(goalId, memory);
    }
    return memory;
  }

  /**
   * Record an entry in task memory.
   */
  record(goalId: string, type: TaskMemoryType, content: unknown, correlationId?: string): TaskMemoryEntry {
    const memory = this.forGoal(goalId);
    const entry: TaskMemoryEntry = {
      entryId: randomUUID(),
      goalId,
      type,
      content,
      timestamp: new Date().toISOString(),
      correlationId,
    };
    memory.entries.push(entry);

    // Trim if exceeding max
    if (memory.entries.length > memory.maxEntries) {
      memory.entries = memory.entries.slice(-memory.maxEntries);
    }

    return entry;
  }

  /**
   * Get entries by type.
   */
  getByType(goalId: string, type: TaskMemoryType): TaskMemoryEntry[] {
    const memory = this.forGoal(goalId);
    return memory.entries.filter((e) => e.type === type);
  }

  /**
   * Get failed approaches for a goal.
   */
  getFailedApproaches(goalId: string): TaskMemoryEntry[] {
    return this.getByType(goalId, 'failed_approach');
  }

  /**
   * Get successful approaches for a goal.
   */
  getSuccessfulApproaches(goalId: string): TaskMemoryEntry[] {
    return this.getByType(goalId, 'successful_approach');
  }

  /**
   * Check if an approach has already been tried and failed.
   */
  hasFailedApproach(goalId: string, approachDescription: string): boolean {
    const failed = this.getFailedApproaches(goalId);
    return failed.some((e) => {
      const content = e.content as { description?: string; capability?: string; target?: string };
      return content.description === approachDescription ||
        content.capability === approachDescription;
    });
  }

  /**
   * Get environmental facts.
   */
  getEnvironmentalFacts(goalId: string): TaskMemoryEntry[] {
    return this.getByType(goalId, 'environmental_fact');
  }

  /**
   * Get all entries for a goal.
   */
  getAll(goalId: string): TaskMemoryEntry[] {
    return this.forGoal(goalId).entries;
  }

  /**
   * Persist task memory to disk.
   */
  async persist(goalId: string): Promise<void> {
    const memory = this.memories.get(goalId);
    if (!memory) return;

    try {
      if (!fs.existsSync(this.memoryDir)) {
        fs.mkdirSync(this.memoryDir, { recursive: true });
      }
      const filePath = path.resolve(this.memoryDir, `${goalId}.json`);
      // Redact any potential secrets before persisting
      const safeEntries = memory.entries.map((e) => ({
        ...e,
        content: this.redactSecrets(e.content),
      }));
      fs.writeFileSync(filePath, JSON.stringify({
        goalId: memory.goalId,
        entries: safeEntries,
        maxEntries: memory.maxEntries,
        persistedAt: new Date().toISOString(),
      }, null, 2));
      memory.persistedPath = filePath;
    } catch {
      // Persistence is best-effort
    }
  }

  /**
   * Load task memory from disk.
   */
  load(goalId: string): TaskMemory | null {
    const filePath = path.resolve(this.memoryDir, `${goalId}.json`);
    try {
      if (!fs.existsSync(filePath)) return null;
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const memory: TaskMemory = {
        goalId: data.goalId,
        entries: data.entries ?? [],
        maxEntries: data.maxEntries ?? 1000,
        persistedPath: filePath,
      };
      this.memories.set(goalId, memory);
      return memory;
    } catch {
      return null;
    }
  }

  /**
   * Clear memory for a goal.
   */
  clear(goalId: string): void {
    this.memories.delete(goalId);
  }

  /**
   * Redact potential secrets from content.
   */
  private redactSecrets(content: unknown): unknown {
    if (typeof content === 'string') {
      // Check for common secret patterns
      if (content.match(/sk_(live|test)_[a-zA-Z0-9]{20,}/)) return '[REDACTED]';
      if (content.match(/Bearer\s+[a-zA-Z0-9._-]{20,}/)) return '[REDACTED]';
      if (content.length > 100 && content.match(/[a-zA-Z0-9+/]{40,}={0,2}/)) return '[REDACTED]';
      return content;
    }
    if (content && typeof content === 'object') {
      const obj = content as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (this.isSecretKey(key)) {
          result[key] = '[REDACTED]';
        } else {
          result[key] = this.redactSecrets(value);
        }
      }
      return result;
    }
    return content;
  }

  private isSecretKey(key: string): boolean {
    const secretPatterns = ['password', 'secret', 'token', 'api_key', 'apikey', 'private_key', 'credential', 'auth'];
    const lower = key.toLowerCase();
    return secretPatterns.some((p) => lower.includes(p));
  }
}
