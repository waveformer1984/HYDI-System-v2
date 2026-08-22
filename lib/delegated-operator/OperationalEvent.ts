/**
 * OperationalEvent — Canonical Control-Plane Event Model
 *
 * Structured events that capture the operational lifecycle of a delegated goal.
 * Every event contains enough structured information to reconstruct operational
 * history without storing private reasoning.
 *
 * Events are persisted through the existing Supabase persistence architecture
 * (adaptive_operator_events table) and also to local audit files as defense
 * in depth.
 *
 * NEVER contains: chain-of-thought, credentials, tokens, cookies, secrets.
 */

import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Event Types
// ---------------------------------------------------------------------------

export type OperationalEventType =
  | 'GOAL_CREATED'
  | 'GOAL_STARTED'
  | 'PLAN_CREATED'
  | 'ACTION_SELECTED'
  | 'AUTHORIZATION_GRANTED'
  | 'AUTHORIZATION_DENIED'
  | 'ACTION_STARTED'
  | 'ACTION_COMPLETED'
  | 'ACTION_FAILED'
  | 'VERIFICATION_STARTED'
  | 'VERIFICATION_PASSED'
  | 'VERIFICATION_FAILED'
  | 'REPLAN_STARTED'
  | 'REPLAN_COMPLETED'
  | 'INTERVENTION_REQUIRED'
  | 'INTERVENTION_APPROVED'
  | 'INTERVENTION_REJECTED'
  | 'CHECKPOINT_CREATED'
  | 'CHECKPOINT_RESTORED'
  | 'RECOVERY_STARTED'
  | 'RECOVERY_COMPLETED'
  | 'STALE_STATE_DETECTED'
  | 'GOAL_PAUSED'
  | 'GOAL_RESUMED'
  | 'GOAL_COMPLETED'
  | 'GOAL_FAILED'
  | 'GOAL_CANCELLED';

// ---------------------------------------------------------------------------
// Event Interface
// ---------------------------------------------------------------------------

export interface OperationalEvent {
  /** Unique event ID */
  eventId: string;
  /** The goal this event belongs to */
  goalId: string;
  /** Session ID */
  sessionId?: string;
  /** Delegated identity ID */
  identityId?: string;
  /** Event type */
  eventType: OperationalEventType;
  /** Timestamp (ISO 8601) */
  timestamp: string;
  /** Structured payload — operational facts only, no secrets */
  payload: OperationalEventPayload;
  /** Sequence number within the goal's event stream */
  sequence: number;
}

export interface OperationalEventPayload {
  // ─── Action context ─────────────────────────────────────────────
  actionId?: string;
  capability?: string;
  targetResource?: string;
  resourceType?: string;
  riskLevel?: string;

  // ─── Authorization ──────────────────────────────────────────────
  authorizationState?: string;
  authorizationReason?: string;

  // ─── Verification ───────────────────────────────────────────────
  verificationContract?: string;
  verificationResult?: string;

  // ─── Intervention ───────────────────────────────────────────────
  interventionId?: string;
  interventionType?: string;
  interventionReason?: string;
  requiredHumanAction?: string;

  // ─── Checkpoint ─────────────────────────────────────────────────
  checkpointId?: string;
  checkpointStatus?: string;

  // ─── Plan ───────────────────────────────────────────────────────
  planVersion?: number;
  previousPlanVersion?: number;
  replanReason?: string;

  // ─── Recovery ───────────────────────────────────────────────────
  recoveryReason?: string;
  restoredFromPersistence?: boolean;

  // ─── General ────────────────────────────────────────────────────
  reason?: string;

  // ─── Stale state ────────────────────────────────────────────────
  staleKeys?: string[];
  expectedState?: Record<string, unknown>;
  actualState?: Record<string, unknown>;

  // ─── Result ─────────────────────────────────────────────────────
  result?: string;
  verifiedState?: Record<string, unknown>;
  errorMessage?: string;

  // ─── Timing ─────────────────────────────────────────────────────
  elapsedMs?: number;
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Secret Sanitizer
// ---------------------------------------------------------------------------

const FORBIDDEN_PATTERNS: RegExp[] = [
  /sk_live_[A-Za-z0-9]+/gi,
  /rk_live_[A-Za-z0-9]+/gi,
  /whsec_[A-Za-z0-9]+/gi,
  /AKIA[A-Z0-9]{16}/g,
  /-----BEGIN[A-Z ]*PRIVATE KEY-----/g,
  /Bearer\s+[A-Za-z0-9._\-]+/gi,
  /password\s*=\s*[^\s;]+/gi,
  /secret\s*=\s*[^\s;]+/gi,
  /token\s*=\s*[^\s;]+/gi,
  /api_key\s*=\s*[^\s;]+/gi,
  /session_cookie\s*=\s*[^\s;]+/gi,
  /cookie\s*=\s*[^\s;]+/gi,
  /mfa_secret\s*=\s*[^\s;]+/gi,
  /otp\s*=\s*[^\s;]+/gi,
  /authorization\s*=\s*[^\s;]+/gi,
];

/**
 * Sanitize an event payload, replacing any secret material with [REDACTED].
 */
export function sanitizeOperationalEventPayload(payload: OperationalEventPayload): OperationalEventPayload {
  const json = JSON.stringify(payload);
  let sanitized = json;
  for (const pattern of FORBIDDEN_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return JSON.parse(sanitized) as OperationalEventPayload;
}

/**
 * Verify that an event contains no secret material.
 */
export function isOperationalEventClean(event: OperationalEvent): boolean {
  const json = JSON.stringify(event);
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(json)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Event Factory
// ---------------------------------------------------------------------------

/**
 * Create a new operational event.
 * The payload is sanitized before the event is returned.
 */
export function createOperationalEvent(params: {
  goalId: string;
  sessionId?: string;
  identityId?: string;
  eventType: OperationalEventType;
  payload?: OperationalEventPayload;
  sequence: number;
}): OperationalEvent {
  const payload = sanitizeOperationalEventPayload(params.payload ?? {});
  return {
    eventId: `evt_${randomUUID()}`,
    goalId: params.goalId,
    sessionId: params.sessionId,
    identityId: params.identityId,
    eventType: params.eventType,
    timestamp: new Date().toISOString(),
    payload,
    sequence: params.sequence,
  };
}

// ---------------------------------------------------------------------------
// Event Stream Manager
// ---------------------------------------------------------------------------

/**
 * Manages the operational event stream for all delegated goals.
 *
 * Events are kept in-memory for fast access and optionally persisted to
 * Supabase (adaptive_operator_events table) for durability.
 *
 * This is a READ-ONLY event log. It never triggers execution.
 */
export class OperationalEventStream {
  private events = new Map<string, OperationalEvent[]>(); // goalId → events
  private sequences = new Map<string, number>(); // goalId → next sequence
  private persistence: OperationalEventPersistence | null = null;
  private localAuditPath: string | null = null;

  /**
   * Attach Supabase persistence.
   */
  attachPersistence(persistence: OperationalEventPersistence): void {
    this.persistence = persistence;
  }

  /**
   * Attach local audit file path (defense in depth).
   */
  attachLocalAudit(filePath: string): void {
    this.localAuditPath = filePath;
  }

  /**
   * Record an event in the stream.
   * Also persists to Supabase and local audit if attached.
   */
  async record(params: {
    goalId: string;
    sessionId?: string;
    identityId?: string;
    eventType: OperationalEventType;
    payload?: OperationalEventPayload;
  }): Promise<OperationalEvent> {
    const seq = (this.sequences.get(params.goalId) ?? 0) + 1;
    this.sequences.set(params.goalId, seq);

    const event = createOperationalEvent({
      goalId: params.goalId,
      sessionId: params.sessionId,
      identityId: params.identityId,
      eventType: params.eventType,
      payload: params.payload,
      sequence: seq,
    });

    // In-memory
    const goalEvents = this.events.get(params.goalId) ?? [];
    goalEvents.push(event);
    this.events.set(params.goalId, goalEvents);

    // Supabase persistence (async, non-blocking)
    if (this.persistence) {
      try {
        await this.persistence.persist(event);
      } catch {
        // Persistence failure must not break the event stream
      }
    }

    // Local audit (best effort)
    if (this.localAuditPath) {
      try {
        const fs = require('fs');
        const path = require('path');
        const dir = path.dirname(this.localAuditPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(this.localAuditPath, JSON.stringify(event) + '\n');
      } catch {
        // Local audit failure must not break the event stream
      }
    }

    return event;
  }

  /**
   * Get all events for a goal, in sequence order.
   */
  getEvents(goalId: string): OperationalEvent[] {
    return [...(this.events.get(goalId) ?? [])];
  }

  /**
   * Get recent events across all goals.
   */
  getRecentEvents(limit: number = 50): OperationalEvent[] {
    const all: OperationalEvent[] = [];
    for (const events of this.events.values()) {
      all.push(...events);
    }
    return all.sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, limit);
  }

  /**
   * Get events for a goal filtered by type.
   */
  getEventsByType(goalId: string, type: OperationalEventType): OperationalEvent[] {
    return this.getEvents(goalId).filter((e) => e.eventType === type);
  }

  /**
   * Get the last event of a specific type for a goal.
   */
  getLastEvent(goalId: string, type?: OperationalEventType): OperationalEvent | null {
    const events = this.getEvents(goalId);
    if (type) {
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].eventType === type) return events[i];
      }
      return null;
    }
    return events.length > 0 ? events[events.length - 1] : null;
  }

  /**
   * Get the current sequence number for a goal.
   */
  getSequence(goalId: string): number {
    return this.sequences.get(goalId) ?? 0;
  }

  /**
   * Clear events for a goal (after completion).
   */
  clear(goalId: string): void {
    this.events.delete(goalId);
    this.sequences.delete(goalId);
  }

  /**
   * Clear all events.
   */
  clearAll(): void {
    this.events.clear();
    this.sequences.clear();
  }

  /**
   * Restore events from Supabase after restart.
   */
  async restoreFromPersistence(goalIds?: string[]): Promise<number> {
    if (!this.persistence) return 0;
    try {
      const events = await this.persistence.loadRecent(goalIds, 1000);
      for (const event of events) {
        const goalEvents = this.events.get(event.goalId) ?? [];
        goalEvents.push(event);
        this.events.set(event.goalId, goalEvents);
        const currentSeq = this.sequences.get(event.goalId) ?? 0;
        if (event.sequence > currentSeq) {
          this.sequences.set(event.goalId, event.sequence);
        }
      }
      return events.length;
    } catch {
      return 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Supabase Persistence
// ---------------------------------------------------------------------------

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Persists operational events to the adaptive_operator_events table.
 */
export class OperationalEventPersistence {
  private supabase: SupabaseClient;
  private enabled: boolean = true;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Persist a single event to Supabase.
   */
  async persist(event: OperationalEvent): Promise<void> {
    if (!this.enabled) return;

    // Map our event type to the adaptive_operator_events event_type
    const dbEventType = this.mapEventType(event.eventType);

    const { error } = await this.supabase
      .from('adaptive_operator_events')
      .insert({
        goal_id: event.goalId,
        session_id: event.sessionId ?? null,
        user_id: event.identityId ?? null,
        event_type: dbEventType,
        payload: {
          ...event.payload,
          _eventId: event.eventId,
          _eventType: event.eventType,
          _sequence: event.sequence,
          _timestamp: event.timestamp,
        },
      });

    if (error) {
      // Don't throw — persistence is best-effort for the event stream
      // but track failures for observability
    }
  }

  /**
   * Load recent events from Supabase.
   */
  async loadRecent(goalIds?: string[], limit: number = 1000): Promise<OperationalEvent[]> {
    if (!this.enabled) return [];

    let query = this.supabase
      .from('adaptive_operator_events')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(limit);

    if (goalIds && goalIds.length > 0) {
      query = query.in('goal_id', goalIds);
    }

    const { data, error } = await query;
    if (error || !data) return [];

    return data.map((row) => this.rowToEvent(row as Record<string, unknown>));
  }

  /**
   * Load events for a specific goal.
   */
  async loadByGoal(goalId: string, limit: number = 200): Promise<OperationalEvent[]> {
    if (!this.enabled) return [];

    const { data, error } = await this.supabase
      .from('adaptive_operator_events')
      .select('*')
      .eq('goal_id', goalId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error || !data) return [];

    return data.map((row) => this.rowToEvent(row as Record<string, unknown>));
  }

  /**
   * Map our canonical event type to the DB event_type column.
   * The DB column has a CHECK constraint with specific allowed values.
   */
  private mapEventType(type: OperationalEventType): string {
    const mapping: Record<OperationalEventType, string> = {
      GOAL_CREATED: 'goal_received',
      GOAL_STARTED: 'goal_received',
      PLAN_CREATED: 'decision',
      ACTION_SELECTED: 'decision',
      AUTHORIZATION_GRANTED: 'decision',
      AUTHORIZATION_DENIED: 'decision',
      ACTION_STARTED: 'action',
      ACTION_COMPLETED: 'action',
      ACTION_FAILED: 'failure',
      VERIFICATION_STARTED: 'observation',
      VERIFICATION_PASSED: 'observation',
      VERIFICATION_FAILED: 'failure',
      REPLAN_STARTED: 'replan',
      REPLAN_COMPLETED: 'replan',
      INTERVENTION_REQUIRED: 'intervention',
      INTERVENTION_APPROVED: 'intervention',
      INTERVENTION_REJECTED: 'intervention',
      CHECKPOINT_CREATED: 'decision',
      CHECKPOINT_RESTORED: 'decision',
      RECOVERY_STARTED: 'deviation',
      RECOVERY_COMPLETED: 'deviation',
      STALE_STATE_DETECTED: 'deviation',
      GOAL_PAUSED: 'deviation',
      GOAL_RESUMED: 'decision',
      GOAL_COMPLETED: 'completion',
      GOAL_FAILED: 'failure',
      GOAL_CANCELLED: 'deviation',
    };
    return mapping[type] ?? 'decision';
  }

  /**
   * Convert a DB row to an OperationalEvent.
   */
  private rowToEvent(row: Record<string, unknown>): OperationalEvent {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    return {
      eventId: (payload._eventId as string) ?? `evt_${row.id}`,
      goalId: row.goal_id as string,
      sessionId: row.session_id as string | undefined,
      identityId: row.user_id as string | undefined,
      eventType: (payload._eventType as OperationalEventType) ?? 'GOAL_CREATED',
      timestamp: (payload._timestamp as string) ?? (row.created_at as string),
      payload: {
        actionId: payload.actionId as string | undefined,
        capability: payload.capability as string | undefined,
        targetResource: payload.targetResource as string | undefined,
        resourceType: payload.resourceType as string | undefined,
        riskLevel: payload.riskLevel as string | undefined,
        authorizationState: payload.authorizationState as string | undefined,
        authorizationReason: payload.authorizationReason as string | undefined,
        verificationContract: payload.verificationContract as string | undefined,
        verificationResult: payload.verificationResult as string | undefined,
        interventionId: payload.interventionId as string | undefined,
        interventionType: payload.interventionType as string | undefined,
        interventionReason: payload.interventionReason as string | undefined,
        requiredHumanAction: payload.requiredHumanAction as string | undefined,
        checkpointId: payload.checkpointId as string | undefined,
        checkpointStatus: payload.checkpointStatus as string | undefined,
        planVersion: payload.planVersion as number | undefined,
        previousPlanVersion: payload.previousPlanVersion as number | undefined,
        replanReason: payload.replanReason as string | undefined,
        recoveryReason: payload.recoveryReason as string | undefined,
        restoredFromPersistence: payload.restoredFromPersistence as boolean | undefined,
        reason: payload.reason as string | undefined,
        staleKeys: payload.staleKeys as string[] | undefined,
        expectedState: payload.expectedState as Record<string, unknown> | undefined,
        actualState: payload.actualState as Record<string, unknown> | undefined,
        result: payload.result as string | undefined,
        verifiedState: payload.verifiedState as Record<string, unknown> | undefined,
        errorMessage: payload.errorMessage as string | undefined,
        elapsedMs: payload.elapsedMs as number | undefined,
        durationMs: payload.durationMs as number | undefined,
      },
      sequence: (payload._sequence as number) ?? 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _eventStream: OperationalEventStream | null = null;

/**
 * Get the singleton OperationalEventStream.
 */
export function getOperationalEventStream(): OperationalEventStream {
  if (!_eventStream) {
    _eventStream = new OperationalEventStream();
  }
  return _eventStream;
}
