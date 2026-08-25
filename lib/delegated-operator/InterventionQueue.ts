/**
 * HYDI Persistent Intervention Queue
 *
 * Each request represents a point where HYDI cannot continue without
 * human action. The queue is persisted to Supabase so interventions
 * survive restarts and are visible through the API/UI.
 */

import { randomUUID } from 'crypto';
import type { HumanInterventionRequest } from '../human-action/HumanActionTypes';
import type { InterventionPersistence } from './InterventionPersistence';

// ---------------------------------------------------------------------------
// Persistent Intervention Request
// ---------------------------------------------------------------------------

/**
 * A human intervention request with full context for resumption.
 */
export interface PersistentInterventionRequest {
  /** Unique request ID */
  requestId: string;
  /** The goal this intervention belongs to */
  goalId: string;
  /** The delegated identity that was acting */
  identityId: string;
  /** The user the goal is for */
  userId: string;
  /** The current objective when the intervention was triggered */
  currentObjective: string;
  /** What blocker was hit */
  blocker: string;
  /** What the human needs to do */
  requiredHumanAction: string;
  /** Why human action is required (not bypassable) */
  whyRequired: string;
  /** What state is expected after the human acts */
  expectedResultingState: string;
  /** When the intervention was requested */
  requestedAt: string;
  /** When the intervention expires (goal may be abandoned) */
  expiresAt: string;
  /** The resume condition — what HYDI will check before continuing */
  resumeCondition: string;
  /** The audit ID linking to the action journal */
  auditId: string;
  /** The intervention type (MFA, CAPTCHA, etc.) */
  interventionType: string;
  /** Current status */
  status: 'pending' | 'resolved' | 'expired' | 'cancelled';
  /** When the human resolved it (if resolved) */
  resolvedAt?: string;
  /** How the human resolved it (free text) */
  resolutionNote?: string;
  /** The underlying HumanInterventionRequest from HumanActionEngine */
  originalRequest: HumanInterventionRequest;
}

// ---------------------------------------------------------------------------
// Intervention Queue
// ---------------------------------------------------------------------------

/**
 * Manages pending human intervention requests.
 *
 * In-memory for fast access, with optional Supabase persistence
 * for durability across restarts.
 */
export class InterventionQueue {
  private queue = new Map<string, PersistentInterventionRequest>();
  private goalIndex = new Map<string, string[]>();
  private listeners: Array<(request: PersistentInterventionRequest) => void> = [];
  private persistence: InterventionPersistence | null = null;

  /**
   * Attach Supabase persistence. After attaching, all enqueue/resolve/cancel
   * operations are also written to Supabase, surviving restart.
   */
  attachPersistence(persistence: InterventionPersistence): void {
    this.persistence = persistence;
  }

  /**
   * Add a new intervention request to the queue.
   * Also persists to Supabase if persistence is attached.
   */
  enqueue(request: Omit<PersistentInterventionRequest, 'requestId' | 'requestedAt' | 'status'>): PersistentInterventionRequest {
    const requestId = `intervention_${randomUUID()}`;
    const requestedAt = new Date().toISOString();

    const entry: PersistentInterventionRequest = {
      ...request,
      requestId,
      requestedAt,
      status: 'pending',
    };

    this.queue.set(requestId, entry);
    const goalEntries = this.goalIndex.get(request.goalId) ?? [];
    goalEntries.push(requestId);
    this.goalIndex.set(request.goalId, goalEntries);

    // Persist to Supabase (fire-and-forget — non-fatal if it fails)
    if (this.persistence) {
      this.persistence.create(entry).catch(() => { /* non-fatal */ });
    }

    // Notify listeners
    for (const listener of this.listeners) {
      try { listener(entry); } catch { /* ignore */ }
    }

    return entry;
  }

  /**
   * Mark an intervention as resolved.
   * Also persists the resolution to Supabase if persistence is attached.
   */
  resolve(requestId: string, resolutionNote: string): boolean {
    const entry = this.queue.get(requestId);
    if (!entry) return false;
    if (entry.status !== 'pending') return false;

    entry.status = 'resolved';
    entry.resolvedAt = new Date().toISOString();
    entry.resolutionNote = resolutionNote;

    if (this.persistence) {
      this.persistence.complete(requestId, resolutionNote).catch(() => { /* non-fatal */ });
    }

    return true;
  }

  /**
   * Async resolve — awaits persistence before returning.
   * Use this when the caller needs the resolution to be durable
   * before proceeding (e.g. before a restart or verification).
   */
  async resolveAsync(requestId: string, resolutionNote: string): Promise<boolean> {
    const entry = this.queue.get(requestId);
    if (!entry) return false;
    if (entry.status !== 'pending') return false;

    entry.status = 'resolved';
    entry.resolvedAt = new Date().toISOString();
    entry.resolutionNote = resolutionNote;

    if (this.persistence) {
      try {
        await this.persistence.complete(requestId, resolutionNote);
      } catch {
        /* non-fatal — in-memory state is already resolved */
      }
    }

    return true;
  }

  /**
   * Cancel an intervention (e.g. goal was cancelled).
   * Also persists the cancellation to Supabase if persistence is attached.
   */
  cancel(requestId: string): boolean {
    const entry = this.queue.get(requestId);
    if (!entry) return false;
    if (entry.status !== 'pending') return false;
    entry.status = 'cancelled';

    if (this.persistence) {
      this.persistence.cancel(requestId).catch(() => { /* non-fatal */ });
    }

    return true;
  }

  /**
   * Async cancel — awaits persistence before returning.
   * Use this when the caller needs the cancellation to be durable
   * before proceeding (e.g. before a restart or verification).
   */
  async cancelAsync(requestId: string): Promise<boolean> {
    const entry = this.queue.get(requestId);
    if (!entry) return false;
    if (entry.status !== 'pending') return false;
    entry.status = 'cancelled';

    if (this.persistence) {
      try {
        await this.persistence.cancel(requestId);
      } catch {
        /* non-fatal — in-memory state is already cancelled */
      }
    }

    return true;
  }

  /**
   * Get a specific intervention by ID.
   */
  get(requestId: string): PersistentInterventionRequest | null {
    return this.queue.get(requestId) ?? null;
  }

  /**
   * Get all pending interventions.
   */
  getPending(): PersistentInterventionRequest[] {
    return Array.from(this.queue.values()).filter((e) => e.status === 'pending');
  }

  /**
   * Get all interventions for a goal.
   */
  getByGoal(goalId: string): PersistentInterventionRequest[] {
    const ids = this.goalIndex.get(goalId) ?? [];
    return ids
      .map((id) => this.queue.get(id))
      .filter((e): e is PersistentInterventionRequest => e !== null);
  }

  /**
   * Get pending interventions for a specific goal.
   */
  getPendingByGoal(goalId: string): PersistentInterventionRequest[] {
    return this.getByGoal(goalId).filter((e) => e.status === 'pending');
  }

  /**
   * Expire interventions that have passed their expiry time.
   * Also persists expirations to Supabase if persistence is attached.
   */
  expireStale(): number {
    const now = Date.now();
    let expired = 0;
    for (const entry of this.queue.values()) {
      if (entry.status !== 'pending') continue;
      if (new Date(entry.expiresAt).getTime() < now) {
        entry.status = 'expired';
        expired++;
      }
    }
    // Also expire in Supabase
    if (this.persistence && expired > 0) {
      this.persistence.expireStale().catch(() => { /* non-fatal */ });
    }
    return expired;
  }

  /**
   * Restore pending interventions from Supabase persistence.
   * Called on daemon startup to recover interventions that survived restart.
   */
  async restoreFromPersistence(): Promise<number> {
    if (!this.persistence) return 0;

    try {
      // First expire stale interventions in Supabase
      await this.persistence.expireStale();

      // Then load all pending interventions
      const pending = await this.persistence.listPending();

      for (const entry of pending) {
        // Don't overwrite in-memory entries that may have been added
        // during this session before restore was called
        if (!this.queue.has(entry.requestId)) {
          this.queue.set(entry.requestId, entry);
          const goalEntries = this.goalIndex.get(entry.goalId) ?? [];
          goalEntries.push(entry.requestId);
          this.goalIndex.set(entry.goalId, goalEntries);
        }
      }

      return pending.length;
    } catch {
      return 0;
    }
  }

  /**
   * Register a listener for new intervention requests.
   */
  onEnqueue(listener: (request: PersistentInterventionRequest) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Serialize the queue for persistence.
   */
  serialize(): PersistentInterventionRequest[] {
    return Array.from(this.queue.values());
  }

  /**
   * Restore the queue from persistence.
   */
  restore(entries: PersistentInterventionRequest[]): void {
    this.queue.clear();
    this.goalIndex.clear();
    for (const entry of entries) {
      this.queue.set(entry.requestId, entry);
      const goalEntries = this.goalIndex.get(entry.goalId) ?? [];
      goalEntries.push(entry.requestId);
      this.goalIndex.set(entry.goalId, goalEntries);
    }
  }
}
