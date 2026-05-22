/**
 * HYDI Self-Reflection Engine  (Phase 4 — Observable Distributed Intelligence)
 *
 * Runs as a high-priority background loop that continuously scrapes
 * localhost:3003/metrics, evaluates system invariants, and publishes
 * operational course-corrections back onto the Redis control stream
 * so the self-heal-worker can actuate them without external intervention.
 *
 * Invariants monitored:
 *   1. Poison-Pill / DLQ accumulation   → CRITICAL_DLQ_GROWTH
 *   2. Socket handle exhaustion          → RESOURCE_EXHAUSTION_RISK
 *   3. Consumer-loop processing stall    → PIPELINE_STALL_DETECTED
 *
 * False-positive guard (Invariant 3):
 *   A single unchanged poll counter is normal during idle periods.
 *   The engine requires STALL_THRESHOLD consecutive unchanged readings
 *   (default 3 × 5s = 15s window) before raising PIPELINE_STALL_DETECTED.
 */

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { RedisStreamBroker } from '../../infrastructure/broker/RedisStreamBroker.js';

// ── Types ──────────────────────────────────────────────────────────────────────

interface SubstrateState {
  consumerPolls:       number;   // hydi_consumer_polls_total
  deadLetterCount:     number;   // hydi_broker_dlq_total
  gcDurationSum:       number;   // hydi_nodejs_nodejs_gc_duration_seconds_sum (all kinds)
  activeSockets:       number;   // hydi_nodejs_nodejs_active_handles{type="Socket"}
  pendingQueueDepth:   number;   // hydi_supabase_queue_depth
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STALL_THRESHOLD       = 3;     // consecutive identical poll counts before raising stall
const SOCKET_EXHAUSTION_CAP = 150;   // active socket handles above this triggers GC directive

// ── Engine ────────────────────────────────────────────────────────────────────

export class SelfReflectionEngine {
  private broker:        RedisStreamBroker;
  private metricsUrl:    string;
  private intervalMs:    number;
  private lastState:     SubstrateState | null = null;
  private stallStreak:   number = 0;        // consecutive checks with no poll increment
  private running:       boolean = false;
  private _abortCtrl:    AbortController = new AbortController();

  constructor(metricsUrl: string, redisUrl: string, intervalMs = 5_000) {
    this.metricsUrl = metricsUrl;
    this.intervalMs = intervalMs;
    this.broker     = new RedisStreamBroker(redisUrl);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  public async initialize(): Promise<void> {
    await this.broker.connect();
    this.running = true;
    console.log('[reflection] 🧠 Self-Awareness Module active — introspecting system invariants every', this.intervalMs, 'ms');
    this._loop();   // fire-and-forget; errors are caught inside
  }

  public async shutdown(): Promise<void> {
    this.running = false;
    this._abortCtrl.abort();
    await this.broker.disconnect();
    console.log('[reflection] Self-Reflection Engine stopped.');
  }

  public snapshot() {
    return {
      running:    this.running,
      stallStreak: this.stallStreak,
      lastState:  this.lastState,
    };
  }

  // ── Main loop ──────────────────────────────────────────────────────────────

  private async _loop(): Promise<void> {
    while (this.running) {
      try {
        const state = await this._scrapeMetrics();
        await this._evaluateInvariants(state);
        this.lastState = state;
      } catch (err) {
        console.error('[reflection] ⚠️  Loop interrupted:', String(err));
      }
      await this._sleep(this.intervalMs);
    }
    this.running = false;
    console.log('[reflection] Loop exited.');
  }

  // ── Metrics scrape ─────────────────────────────────────────────────────────

  private async _scrapeMetrics(): Promise<SubstrateState> {
    const { data } = await axios.get<string>(this.metricsUrl, { timeout: 4_000 });

    return {
      consumerPolls:     this._parse(data, 'hydi_consumer_polls_total'),
      deadLetterCount:   this._parse(data, 'hydi_broker_dlq_total'),
      gcDurationSum:     this._parseSum(data, 'hydi_nodejs_nodejs_gc_duration_seconds_sum'),
      activeSockets:     this._parse(data, 'hydi_nodejs_nodejs_active_handles', 'type="Socket"'),
      pendingQueueDepth: this._parse(data, 'hydi_supabase_queue_depth'),
    };
  }

  /** Extract the value of a single-valued metric line, optionally filtered by label substring. */
  private _parse(raw: string, name: string, labelFilter?: string): number {
    for (const line of raw.split('\n')) {
      if (line.startsWith('#')) continue;
      if (!line.includes(name)) continue;
      if (labelFilter && !line.includes(labelFilter)) continue;
      const parts = line.trim().split(/\s+/);
      const v = parseFloat(parts[parts.length - 1]);
      return isNaN(v) ? 0 : v;
    }
    return 0;
  }

  /**
   * Sum all matching metric lines (e.g. gc_duration_seconds_sum has one line per GC kind).
   * Used for GC pressure where we want total across minor/major/incremental.
   */
  private _parseSum(raw: string, name: string): number {
    let total = 0;
    for (const line of raw.split('\n')) {
      if (line.startsWith('#')) continue;
      if (!line.includes(name)) continue;
      const parts = line.trim().split(/\s+/);
      const v = parseFloat(parts[parts.length - 1]);
      if (!isNaN(v)) total += v;
    }
    return total;
  }

  // ── Invariant evaluation ───────────────────────────────────────────────────

  private async _evaluateInvariants(state: SubstrateState): Promise<void> {
    if (!this.lastState) return;   // need at least one prior reading

    // ── Invariant 1: DLQ growth (poison-pill accumulation) ─────────────────
    if (state.deadLetterCount > this.lastState.deadLetterCount) {
      const delta = state.deadLetterCount - this.lastState.deadLetterCount;
      await this._broadcast('CRITICAL_DLQ_GROWTH', {
        message:        `Poison pill detected — DLQ expanded by ${delta} item(s). Total: ${state.deadLetterCount}`,
        actionRequired: 'ISOLATE_UPSTREAM_INGRESS_ROUTE',
        delta,
        total:          state.deadLetterCount,
      });
    }

    // ── Invariant 2: Socket handle exhaustion ──────────────────────────────
    if (state.activeSockets > SOCKET_EXHAUSTION_CAP) {
      await this._broadcast('RESOURCE_EXHAUSTION_RISK', {
        message:        `High socket count (${state.activeSockets} active handles). Risk of TIME_WAIT starvation.`,
        actionRequired: 'FORCE_GARBAGE_COLLECTION_AND_SOCKET_REAP',
        activeSockets:  state.activeSockets,
        threshold:      SOCKET_EXHAUSTION_CAP,
      });
    }

    // ── Invariant 3: Consumer-loop processing stall ────────────────────────
    // Guard: only flag after STALL_THRESHOLD consecutive unchanged readings
    // AND only when there is actual pending work to process.
    const pollsUnchanged = state.consumerPolls === this.lastState.consumerPolls;
    const hasActiveSockets = state.activeSockets > 0;
    const hasPendingWork   = state.pendingQueueDepth > 0;

    if (pollsUnchanged && hasActiveSockets && hasPendingWork) {
      this.stallStreak++;
      console.warn(`[reflection] ⚠️  Consumer stall streak: ${this.stallStreak}/${STALL_THRESHOLD}`);
    } else {
      this.stallStreak = 0;   // reset on healthy poll or idle queue
    }

    if (this.stallStreak >= STALL_THRESHOLD) {
      this.stallStreak = 0;   // reset so we don't spam directives
      await this._broadcast('PIPELINE_STALL_DETECTED', {
        message:          `Consumer poll counter frozen for ${STALL_THRESHOLD} consecutive checks (${STALL_THRESHOLD * this.intervalMs / 1000}s window) with ${state.pendingQueueDepth} pending events.`,
        actionRequired:   'RECYCLE_CONSUMER_POOL_CONTEXT',
        pendingQueueDepth: state.pendingQueueDepth,
        stallWindowMs:    STALL_THRESHOLD * this.intervalMs,
      });
    }
  }

  // ── Directive broadcast ────────────────────────────────────────────────────

  private async _broadcast(
    directiveType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    console.warn(`[reflection] 📡 [${directiveType}]: ${payload['message']}`);

    // Conform to HYDIEvent — broker assigns `id`; we supply the rest.
    await this.broker.publish('hydi:tasks:routing', {
      id:            '',             // broker will overwrite
      correlationId: `tx-self-heal-${Date.now()}-${uuidv4().slice(0, 8)}`,
      component:     'SelfReflectionEngine',
      timestamp:     new Date().toISOString(),
      payload: {
        type:      'self-heal',      // routable domain used by self-heal-worker
        directive: directiveType,
        meta:      payload,
      },
    } as any);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
