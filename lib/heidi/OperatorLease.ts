/**
 * OPERATOR LEASE — durable single-holder claim, backed by
 * `heidi_operator_lease` (migration 20261012173000).
 *
 * The daemon's file lock proves exclusivity to things sharing its
 * filesystem. This lease proves it to anything reading the database:
 * one row per operator, claimed atomically, expired by time alone.
 *
 * Semantics:
 *   claim()     — conditional upsert. Held: the row becomes ours.
 *                 Refused: a live (unexpired, unreleased) lease exists —
 *                 0 rows back, no exception, no race. Callers decide what
 *                 refusal means; this class never silently pretends.
 *   heartbeat() — owner-scoped renewal. A superseded holder's heartbeat
 *                 writes 0 rows and returns false: that is how a dead-
 *                 walking holder learns it lost the lease.
 *   release()   — voluntary release; marks released_at rather than
 *                 deleting, so "clean handoff" is distinguishable from
 *                 "expired while held" (stale) in the same row.
 *
 * Everything is owner-scoped: owner_id is a fresh token per process boot,
 * so pid reuse or an abandoned row can never be written by the wrong
 * holder.
 */
import type { Pool } from 'pg';
import * as os from 'os';
import { randomUUID } from 'crypto';

export interface LeaseRow {
  id: string;
  operator: string;
  owner_id: string;
  host: string | null;
  pid: number | null;
  claimed_at: string;
  heartbeat_at: string;
  expires_at: string;
  released_at: string | null;
}

export type ClaimResult =
  | { held: true; leaseId: string; expiresAt: string }
  | { held: false; currentOwner: Pick<LeaseRow, 'owner_id' | 'host' | 'pid' | 'heartbeat_at' | 'expires_at'> | null };

export interface OperatorLeaseOptions {
  operator?: string;
  /** Lease lifetime. Default 120s — matches the documented lease TTL. */
  ttlMs?: number;
  /** Unique identity for this holder. Defaults to a fresh UUID. */
  ownerId?: string;
  host?: string;
  pid?: number;
}

export class OperatorLease {
  private readonly pool: Pool;
  private readonly operator: string;
  private readonly ttlMs: number;
  readonly ownerId: string;
  private leaseId: string | null = null;

  constructor(pool: Pool, opts: OperatorLeaseOptions = {}) {
    this.pool = pool;
    this.operator = opts.operator ?? 'heidi-daemon';
    this.ttlMs = opts.ttlMs ?? 120_000;
    this.ownerId = opts.ownerId ?? randomUUID();
    this.host = opts.host ?? os.hostname();
    this.pid = opts.pid ?? process.pid;
  }
  private readonly host: string;
  private readonly pid: number;

  /**
   * Attempt the claim. Single statement — the WHERE on DO UPDATE is the
   * gate: a live lease means Postgres evaluates the update to 0 rows for
   * this statement, atomically. There is no read-then-write window.
   */
  async claim(): Promise<ClaimResult> {
    const { rows } = await this.pool.query<{ id: string; expires_at: string }>(
      `INSERT INTO public.heidi_operator_lease (operator, owner_id, host, pid, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5 || ' milliseconds')::interval)
       ON CONFLICT (operator) DO UPDATE SET
         owner_id     = EXCLUDED.owner_id,
         host         = EXCLUDED.host,
         pid          = EXCLUDED.pid,
         claimed_at   = now(),
         heartbeat_at = now(),
         expires_at   = EXCLUDED.expires_at,
         released_at  = NULL
       WHERE public.heidi_operator_lease.expires_at < now()
          OR public.heidi_operator_lease.released_at IS NOT NULL
       RETURNING id, expires_at`,
      [this.operator, this.ownerId, this.host, this.pid, String(this.ttlMs)],
    );

    if (rows.length > 0) {
      this.leaseId = rows[0].id;
      return { held: true, leaseId: rows[0].id, expiresAt: rows[0].expires_at };
    }

    const current = await this.pool.query<LeaseRow>(
      `SELECT owner_id, host, pid, heartbeat_at, expires_at
       FROM public.heidi_operator_lease WHERE operator = $1`,
      [this.operator],
    );
    return { held: false, currentOwner: current.rows[0] ?? null };
  }

  /**
   * Renew. Returns false when the update touched 0 rows — we are not the
   * recorded holder anymore (released, superseded, or never claimed).
   * `expires_at` also moves forward so the lease can't silently stale.
   */
  async heartbeat(): Promise<boolean> {
    if (!this.leaseId) return false;
    const { rowCount } = await this.pool.query(
      `UPDATE public.heidi_operator_lease
       SET heartbeat_at = now(), expires_at = now() + ($3 || ' milliseconds')::interval
       WHERE id = $1 AND owner_id = $2 AND released_at IS NULL`,
      [this.leaseId, this.ownerId, String(this.ttlMs)],
    );
    return (rowCount ?? 0) > 0;
  }

  /** Voluntary release. Idempotent; silent when we are not the holder. */
  async release(): Promise<void> {
    if (!this.leaseId) return;
    await this.pool.query(
      `UPDATE public.heidi_operator_lease
       SET released_at = now()
       WHERE id = $1 AND owner_id = $2 AND released_at IS NULL`,
      [this.leaseId, this.ownerId],
    );
    this.leaseId = null;
  }

  /** Read the current lease row for an operator (held or stale). */
  static async readCurrent(pool: Pool, operator = 'heidi-daemon'): Promise<LeaseRow | null> {
    const { rows } = await pool.query<LeaseRow>(
      `SELECT * FROM public.heidi_operator_lease WHERE operator = $1`,
      [operator],
    );
    return rows[0] ?? null;
  }

  /**
   * Stale = held past expiry with no release. These are the rows a
   * supervisor answers "who is supposed to be running?" against — a stale
   * lease means the recorded operator is presumed dead, not merely quiet.
   */
  static async findStale(pool: Pool): Promise<LeaseRow[]> {
    const { rows } = await pool.query<LeaseRow>(
      `SELECT * FROM public.heidi_operator_lease
       WHERE released_at IS NULL AND expires_at < now()`,
    );
    return rows;
  }
}

export interface OperatorLeaseSupervisorDeps {
  /** Injectable lease factory — tests substitute a stubbed OperatorLease. */
  createLease?: () => OperatorLease;
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
}

/**
 * Owns the daemon's lease lifecycle across ticks: claim when unheld,
 * heartbeat when held. The startup-only claim used to leave a daemon
 * leaseless for its whole run when a restart raced a predecessor's
 * not-yet-expired row — the supervisor re-attempts every tick instead.
 * `held` is the unattended-authority gate's input: acting unattended
 * with no live lease means acting with no recorded operator, so the
 * gate refuses on it (NO_OPERATOR_LEASE).
 */
export class OperatorLeaseSupervisor {
  private readonly pool: Pool;
  private readonly ttlMs: number;
  private readonly makeLease: () => OperatorLease;
  private readonly log: (msg: string) => void;
  private readonly warn: (msg: string) => void;
  private readonly error: (msg: string) => void;
  private lease: OperatorLease | null = null;
  private candidate: OperatorLease | null = null;
  private everHeld = false;
  private inFlight = false;
  private lastBlock: string | null = null;

  constructor(pool: Pool, opts: { ttlMs?: number } = {}, deps: OperatorLeaseSupervisorDeps = {}) {
    this.pool = pool;
    this.ttlMs = opts.ttlMs ?? 120_000;
    this.makeLease = deps.createLease ?? (() => new OperatorLease(this.pool, { ttlMs: this.ttlMs }));
    this.log = deps.log ?? ((m) => console.log(m));
    this.warn = deps.warn ?? ((m) => console.warn(m));
    this.error = deps.error ?? ((m) => console.error(m));
  }

  /** Whether this process currently holds a live lease. */
  get held(): boolean {
    return this.lease !== null;
  }

  /**
   * One supervision step. Held → heartbeat; a superseded heartbeat clears
   * the hold so the NEXT tick re-claims. Unheld → claim; refusals and
   * unavailability log on state change only, so a long-lived holder
   * elsewhere doesn't spam the log every tick.
   */
  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      if (this.lease) {
        const lease = this.lease;
        try {
          const ok = await lease.heartbeat();
          if (!ok) {
            this.lease = null;
            this.error('[daemon] operator lease LOST — this process is no longer the recorded holder');
          }
        } catch {
          /* transient DB error — the TTL absorbs one miss */
        }
        return;
      }
      if (!this.candidate) this.candidate = this.makeLease();
      const candidate = this.candidate;
      try {
        const claim = await candidate.claim();
        if (claim.held) {
          const retried = this.everHeld || this.lastBlock !== null;
          this.lease = candidate;
          this.lastBlock = null;
          this.log(retried
            ? `[daemon] operator lease acquired on retry (owner=${candidate.ownerId.slice(0, 8)}… expires=${claim.expiresAt})`
            : `[daemon] operator lease held (owner=${candidate.ownerId.slice(0, 8)}… expires=${claim.expiresAt})`);
          this.everHeld = true;
        } else {
          const key = `refused:${JSON.stringify(claim.currentOwner)}`;
          if (key !== this.lastBlock) {
            this.lastBlock = key;
            this.error(`[daemon] operator lease REFUSED — live holder: ${JSON.stringify(claim.currentOwner)}`);
          }
        }
      } catch (e: unknown) {
        const key = `unavailable:${e instanceof Error ? e.message : 'unknown'}`;
        if (key !== this.lastBlock) {
          this.lastBlock = key;
          this.warn(`[daemon] operator lease unavailable (table missing or DB down): ${e instanceof Error ? e.message : 'unknown'}`);
        }
      }
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Voluntary release at shutdown. A failure is logged, not swallowed —
   * released_at staying NULL is the difference between "clean handoff"
   * and "presumed dead" in the evidence trail. The hold clears either
   * way: the process is leaving.
   */
  async release(): Promise<void> {
    const lease = this.lease;
    this.lease = null;
    if (!lease) return;
    try {
      await lease.release();
    } catch (e: unknown) {
      this.warn(`[daemon] operator lease release failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }
}
