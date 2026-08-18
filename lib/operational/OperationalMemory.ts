/**
 * HYDI Operational Memory — Durable Event Store
 *
 * Records operational events to a local JSON file so they survive restarts.
 * This is NOT user memory — it is machine operational history.
 *
 * The store answers:
 *   - What happened?
 *   - Why did HYDI believe it happened?
 *   - What did HYDI do?
 *   - Did the recovery actually work?
 *
 * The store is append-only (events are never modified or deleted).
 * It rotates when the file exceeds a size threshold to prevent unbounded growth.
 */

import fs from 'fs';
import path from 'path';
import type { OperationalEvent } from './types';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_EVENTS_IN_MEMORY = 5000;

export class OperationalMemory {
  private filePath: string;
  private events: OperationalEvent[] = [];
  private writeQueue: OperationalEvent[] = [];
  private writeTimer: NodeJS.Timeout | null = null;
  private flushIntervalMs = 5000; // batch writes every 5s
  private destroyed = false;

  constructor(root: string) {
    const dataDir = path.resolve(root, '.hydi-operational');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.filePath = path.resolve(dataDir, 'operational-events.jsonl');
    this.loadExistingEvents();
  }

  /**
   * Record an operational event. The event is queued and flushed to disk
   * in batches to minimize I/O overhead.
   */
  record(event: OperationalEvent): void {
    if (this.destroyed) return;
    this.events.push(event);
    if (this.events.length > MAX_EVENTS_IN_MEMORY) {
      this.events.shift();
    }
    this.writeQueue.push(event);
    this.scheduleFlush();
  }

  /**
   * Get recent events from memory.
   */
  getRecent(limit = 100): OperationalEvent[] {
    return this.events.slice(-limit);
  }

  /**
   * Get events by correlation ID.
   */
  getByCorrelationId(correlationId: string): OperationalEvent[] {
    return this.events.filter((e) => e.correlationId === correlationId);
  }

  /**
   * Get events by component.
   */
  getByComponent(component: string): OperationalEvent[] {
    return this.events.filter((e) => e.component === component);
  }

  /**
   * Get events by type.
   */
  getByType(type: OperationalEvent['type']): OperationalEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  /**
   * Get all events in memory.
   */
  getAll(): OperationalEvent[] {
    return [...this.events];
  }

  /**
   * Flush pending writes to disk immediately.
   */
  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    await this.writePending();
  }

  /**
   * Destroy the store, flushing any pending writes.
   */
  async destroy(): Promise<void> {
    this.destroyed = true;
    await this.flush();
  }

  private scheduleFlush(): void {
    if (this.writeTimer || this.destroyed) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.writePending().catch(() => { /* best effort */ });
    }, this.flushIntervalMs);
  }

  private async writePending(): Promise<void> {
    if (this.writeQueue.length === 0) return;
    const toWrite = this.writeQueue.splice(0);
    const lines = toWrite.map((e) => JSON.stringify(e)).join('\n') + '\n';

    try {
      // Check file size and rotate if needed
      if (fs.existsSync(this.filePath)) {
        const stats = fs.statSync(this.filePath);
        if (stats.size > MAX_FILE_SIZE_BYTES) {
          this.rotate();
        }
      }
      fs.appendFileSync(this.filePath, lines);
    } catch (e) {
      // If write fails, put events back in the queue for retry
      this.writeQueue.unshift(...toWrite);
    }
  }

  private rotate(): void {
    try {
      const backupPath = this.filePath.replace('.jsonl', `.${Date.now()}.jsonl`);
      fs.renameSync(this.filePath, backupPath);
    } catch { /* best effort */ }
  }

  private loadExistingEvents(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const content = fs.readFileSync(this.filePath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      // Load the most recent events (up to MAX_EVENTS_IN_MEMORY)
      const start = Math.max(0, lines.length - MAX_EVENTS_IN_MEMORY);
      for (let i = start; i < lines.length; i++) {
        try {
          const event = JSON.parse(lines[i]);
          this.events.push(event);
        } catch { /* skip malformed lines */ }
      }
    } catch { /* file may not exist yet */ }
  }
}
