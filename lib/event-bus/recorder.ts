import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'fs';
import { dirname, join } from 'path';
import type { BusEvent, EventHistoryQuery, EventHandler } from './types';
import type { EventBus } from './EventBus';

export interface EventRecorderConfig {
  /** Directory or file path. If a directory, writes to `event-fabric.ndjson` inside it. */
  path?: string;
  /** Maximum in-memory buffer events. Older events are dropped from RAM but remain on disk. */
  maxMemory?: number;
  /** Rotate log when it exceeds this many bytes. */
  maxSizeBytes?: number;
  /** Keep this many rotated files. */
  maxFiles?: number;
  /** Flush interval in ms. 0 disables periodic flush (write immediately). */
  flushIntervalMs?: number;
}

interface PendingEvent {
  line: string;
  event: BusEvent;
}

/**
 * Persistent, ring-buffered recorder for the Event Fabric.
 *
 * Attaches to a bus, keeps a bounded in-memory copy for fast replay,
 * and appends every event to an NDJSON log on disk. Consumers can
 * query recent events, traces, and causation chains; the buffer is
 * automatically back-filled from disk on construction so restarts
 * preserve continuity.
 */
export class EventRecorder {
  private bus: EventBus;
  private buffer: BusEvent[] = [];
  private maxMemory: number;
  private logPath: string;
  private maxSizeBytes: number;
  private maxFiles: number;
  private pending: PendingEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private subscriptionId: string | null = null;

  constructor(bus: EventBus, config: EventRecorderConfig = {}) {
    this.bus = bus;
    this.maxMemory = config.maxMemory ?? 5000;
    this.maxSizeBytes = config.maxSizeBytes ?? 50 * 1024 * 1024;
    this.maxFiles = config.maxFiles ?? 5;

    const basePath = config.path ?? join(process.cwd(), /*turbopackIgnore: true*/ 'logs/event-fabric');
    try {
      mkdirSync(/*turbopackIgnore: true*/ basePath, { recursive: true });
      this.logPath = join(/*turbopackIgnore: true*/ basePath, /*turbopackIgnore: true*/ 'event-fabric.ndjson');
    } catch {
      // If path is a file, use it directly.
      this.logPath = basePath;
      mkdirSync(/*turbopackIgnore: true*/ dirname(this.logPath), { recursive: true });
    }

    this.rehydrate();
    this.subscribe();

    const flushIntervalMs = config.flushIntervalMs ?? 1000;
    if (flushIntervalMs > 0) {
      this.flushTimer = setInterval(() => this.flush(), flushIntervalMs);
      (this.flushTimer as any).unref?.();
    }
  }

  stop(): void {
    if (this.subscriptionId) {
      this.bus.unsubscribe(this.subscriptionId);
      this.subscriptionId = null;
    }
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  getBuffer(): BusEvent[] {
    return [...this.buffer];
  }

  getRecent(limit = 100): BusEvent[] {
    return this.buffer.slice(-limit).reverse();
  }

  getTrace(traceId: string): BusEvent[] {
    return this.buffer.filter((e) => e.traceId === traceId);
  }

  getCausationChain(eventId: string): BusEvent[] {
    const byId = new Map(this.buffer.map((e) => [e.id, e]));
    const chain: BusEvent[] = [];
    const seen = new Set<string>();

    let current = byId.get(eventId);
    while (current && !seen.has(current.id)) {
      chain.push(current);
      seen.add(current.id);
      current = current.causationId ? byId.get(current.causationId) : undefined;
    }

    return chain;
  }

  async replay(query: EventHistoryQuery, handler: EventHandler): Promise<number> {
    const events = this.query(query).reverse(); // chronological
    for (const event of events) {
      await handler({ ...event });
    }
    return events.length;
  }

  query(query: EventHistoryQuery = {}): BusEvent[] {
    let result = [...this.buffer].reverse();

    if (query.type) {
      result = result.filter((e) => e.type === query.type);
    }
    if (query.source) {
      result = result.filter((e) => e.source === query.source);
    }
    if (query.priority) {
      result = result.filter((e) => e.priority === query.priority);
    }
    if (query.since) {
      const since = query.since;
      result = result.filter((e) => e.timestamp >= since);
    }
    if (query.limit && query.limit > 0) {
      result = result.slice(0, query.limit);
    }

    return result;
  }

  private subscribe(): void {
    this.subscriptionId = this.bus.subscribe<BusEvent>('*', (event) => {
      this.buffer.push(event);
      if (this.buffer.length > this.maxMemory) {
        this.buffer.shift();
      }

      const line = JSON.stringify(event) + '\n';
      this.pending.push({ line, event });

      if (this.flushTimer === null) {
        this.flush();
      }
    });
  }

  private rehydrate(): void {
    try {
      if (!existsSync(/*turbopackIgnore: true*/ this.logPath)) return;
      const data = readFileSync(/*turbopackIgnore: true*/ this.logPath, 'utf8');
      const lines = data.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as BusEvent;
          // Backfill fields added by the Phase 3 event-versioning work so old
          // NDJSON records remain valid BusEvents.
          (event as any).version = event.version ?? 1;
          (event as any).source = event.source ?? 'unknown';
          this.buffer.push(event);
          if (this.buffer.length > this.maxMemory) {
            this.buffer.shift();
          }
        } catch {
          // Skip corrupt lines.
        }
      }
    } catch {
      // Rehydration is best-effort.
    }
  }

  private flush(): void {
    if (this.pending.length === 0) return;

    try {
      this.rotateIfNeeded();
      let buffer = '';
      for (const { line } of this.pending) {
        buffer += line;
      }
      appendFileSync(/*turbopackIgnore: true*/ this.logPath, buffer, 'utf8');
      this.pending = [];
    } catch (error) {
      console.error('[EventRecorder] Failed to flush events:', error);
    }
  }

  private rotateIfNeeded(): void {
    try {
      if (!existsSync(/*turbopackIgnore: true*/ this.logPath)) return;
      const stats = statSync(/*turbopackIgnore: true*/ this.logPath);
      if (stats.size < this.maxSizeBytes) return;

      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const src = `${this.logPath}.${i}`;
        const dst = `${this.logPath}.${i + 1}`;
        if (existsSync(/*turbopackIgnore: true*/ src)) {
          renameSync(/*turbopackIgnore: true*/ src, /*turbopackIgnore: true*/ dst);
        }
      }
      renameSync(/*turbopackIgnore: true*/ this.logPath, `${this.logPath}.1`);
    } catch (error) {
      console.error('[EventRecorder] Failed to rotate log:', error);
    }
  }
}
