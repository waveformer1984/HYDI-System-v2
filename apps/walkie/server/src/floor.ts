import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import { channelIdFromRoom, roomNameFor, type MediaGateway, type WebhookEventLite } from './livekit.js';
import { TalkRateLimiter } from './rate-limit.js';
import type { Lease, Store } from './store/types.js';

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export type TalkGrant = {
  kind: 'granted';
  leaseId: string;
  grantedAt: number;
  renewDeadline: number;
  hardDeadline: number;
  renewEveryMs: number;
  maxMs: number;
};

export type TalkResult =
  | TalkGrant
  | { kind: 'busy'; holderUserId: string; until: number }
  | { kind: 'forbidden' }
  | { kind: 'rate_limited'; retryAfterMs: number }
  | { kind: 'not_connected' }
  | { kind: 'unavailable' };

/**
 * Server-authoritative speaking turn ("floor") per channel.
 *
 * Invariant: a participant may publish microphone audio in a channel's room
 * only while it holds that channel's live lease. The lease lives in the
 * Store (atomic, shared by every backend instance); publishing rights live in
 * LiveKit and are granted only after the lease is won, and revoked whenever
 * the lease ends for any reason — release, renew timeout, max duration,
 * disconnect, removal, block, account deletion. LiveKit unpublishes a
 * participant's tracks when its publish permission is revoked, so a client
 * that ignores the protocol still cannot keep transmitting.
 *
 * Within one process, operations on a channel are serialised so a grant and
 * a revoke for the same participant can never reorder. Across processes,
 * periodic reconcile() repairs any divergence between the Store and LiveKit.
 */
export class FloorService {
  private readonly limiter: TalkRateLimiter;
  private readonly locks = new Map<string, Promise<unknown>>();
  private timers: NodeJS.Timeout[] = [];
  private grantListeners: Array<(channelId: string, lease: Lease) => void> = [];

  constructor(
    private readonly store: Store,
    private readonly media: MediaGateway,
    private readonly cfg: Pick<Config, 'talk' | 'sweepIntervalMs' | 'reconcileIntervalMs'>,
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
  ) {
    this.limiter = new TalkRateLimiter({ minIntervalMs: cfg.talk.minRequestIntervalMs, burst: cfg.talk.burst, windowMs: cfg.talk.burstWindowMs });
  }

  /** Called after a *new* turn is granted (not for a same-user re-request). Listeners must not throw or block. */
  onGranted(fn: (channelId: string, lease: Lease) => void) {
    this.grantListeners.push(fn);
  }

  private withChannel<T>(channelId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(channelId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    this.locks.set(channelId, tail);
    void tail.then(() => {
      if (this.locks.get(channelId) === tail) this.locks.delete(channelId);
    });
    return run;
  }

  private async revoke(channelId: string, userId: string) {
    try {
      await this.media.setCanPublish(roomNameFor(channelId), userId, false);
    } catch (err) {
      // reconcile() will retry; never let this mask the caller's outcome.
      this.log.error({ channelId, userId, err: errMsg(err) }, 'revoke publish failed');
    }
  }

  private async announce(channelId: string, lease: Lease | null) {
    try {
      await this.media.setSpeaker(roomNameFor(channelId), {
        speaker: lease ? { userId: lease.userId, leaseId: lease.leaseId, since: lease.grantedAt, until: lease.hardDeadline } : null,
      });
    } catch (err) {
      this.log.warn({ channelId, err: errMsg(err) }, 'speaker announcement failed');
    }
  }

  requestTalk(userId: string, channelId: string): Promise<TalkResult> {
    return this.withChannel(channelId, async () => {
      if (!(await this.store.getRole(channelId, userId))) return { kind: 'forbidden' } as const;
      const now = this.now();
      const wait = this.limiter.check(`${userId}:${channelId}`, now);
      if (wait > 0) return { kind: 'rate_limited', retryAfterMs: wait } as const;

      const acq = await this.store.acquireFloor({
        channelId,
        userId,
        leaseId: randomUUID(),
        now,
        renewTtlMs: this.cfg.talk.renewTtlMs,
        maxMs: this.cfg.talk.maxMs,
      });
      if (!acq.ok) return { kind: 'busy', holderUserId: acq.holder.userId, until: acq.holder.hardDeadline } as const;
      const lease = acq.lease;

      let granted: 'ok' | 'not_found';
      try {
        granted = await this.media.setCanPublish(roomNameFor(channelId), userId, true);
      } catch (err) {
        this.log.error({ channelId, userId, err: errMsg(err) }, 'grant publish failed');
        await this.store.releaseFloor(channelId, lease.leaseId, userId);
        await this.revoke(channelId, userId);
        return { kind: 'unavailable' } as const;
      }
      if (granted === 'not_found') {
        await this.store.releaseFloor(channelId, lease.leaseId, userId);
        return { kind: 'not_connected' } as const;
      }

      // Another instance's sweeper could have reclaimed the lease while we
      // were talking to LiveKit. If so, take the grant back.
      const still = await this.store.getFloor(channelId, this.now());
      if (!still || still.leaseId !== lease.leaseId) {
        await this.revoke(channelId, userId);
        return still
          ? ({ kind: 'busy', holderUserId: still.userId, until: still.hardDeadline } as const)
          : ({ kind: 'unavailable' } as const);
      }

      if (!acq.reused) {
        await this.announce(channelId, lease);
        for (const fn of this.grantListeners) {
          try {
            fn(channelId, lease);
          } catch (err) {
            this.log.error({ channelId, err: errMsg(err) }, 'grant listener failed');
          }
        }
      }
      this.log.info({ channelId, userId, leaseId: lease.leaseId }, 'floor granted');
      return {
        kind: 'granted',
        leaseId: lease.leaseId,
        grantedAt: lease.grantedAt,
        renewDeadline: still.renewDeadline,
        hardDeadline: lease.hardDeadline,
        renewEveryMs: Math.max(250, Math.floor(this.cfg.talk.renewTtlMs / 3)),
        maxMs: this.cfg.talk.maxMs,
      } as const;
    });
  }

  /** Keep a turn alive. Returns null when the turn is gone; the client must stop transmitting. */
  renew(userId: string, channelId: string, leaseId: string): Promise<Lease | null> {
    return this.withChannel(channelId, async () => {
      const lease = await this.store.renewFloor({ channelId, leaseId, userId, now: this.now(), renewTtlMs: this.cfg.talk.renewTtlMs });
      if (!lease) {
        const cur = await this.store.getFloor(channelId, this.now());
        if (!cur || cur.userId !== userId) await this.revoke(channelId, userId);
      }
      return lease;
    });
  }

  /** End a turn. Idempotent: always revokes the caller's publish right unless they hold a newer turn. */
  release(userId: string, channelId: string, leaseId: string): Promise<boolean> {
    return this.withChannel(channelId, async () => {
      const ended = await this.store.releaseFloor(channelId, leaseId, userId);
      const cur = await this.store.getFloor(channelId, this.now());
      if (!cur || cur.userId !== userId) await this.revoke(channelId, userId);
      if (ended) {
        await this.announce(channelId, null);
        this.log.info({ channelId, userId, leaseId }, 'floor released');
      }
      return Boolean(ended);
    });
  }

  current(channelId: string) {
    return this.store.getFloor(channelId, this.now());
  }

  /**
   * Take a user off the floor and, when `kick`, out of the room with their
   * tokens invalidated. Used for leave, removal, block, account deletion and
   * disconnects.
   */
  dropUser(channelId: string, userId: string, opts: { kick: boolean }): Promise<void> {
    return this.withChannel(channelId, async () => {
      const ended = await this.store.releaseFloorForUser(channelId, userId);
      if (opts.kick) {
        try {
          await this.media.removeParticipant(roomNameFor(channelId), userId);
        } catch (err) {
          this.log.error({ channelId, userId, err: errMsg(err) }, 'remove participant failed');
        }
      } else {
        await this.revoke(channelId, userId);
      }
      if (ended) await this.announce(channelId, null);
    });
  }

  /** Reclaim every lease past its renew or hard deadline. */
  async sweep(): Promise<number> {
    const expired = await this.store.expireFloors(this.now());
    await Promise.all(
      expired.map((l) =>
        this.withChannel(l.channelId, async () => {
          const cur = await this.store.getFloor(l.channelId, this.now());
          if (!cur || cur.userId !== l.userId) await this.revoke(l.channelId, l.userId);
          if (!cur) await this.announce(l.channelId, null);
          this.log.info({ channelId: l.channelId, userId: l.userId, leaseId: l.leaseId }, 'floor expired');
        }),
      ),
    );
    return expired.length;
  }

  /**
   * Make LiveKit match the Store: non-members are removed, only the lease
   * holder may publish, and a lease whose holder has left is reclaimed.
   */
  async reconcile(): Promise<void> {
    const rooms = (await this.media.listActiveRooms()).filter((r) => channelIdFromRoom(r));
    for (const room of rooms) {
      const channelId = channelIdFromRoom(room)!;
      await this.withChannel(channelId, async () => {
        const participants = await this.media.listParticipants(room);
        if (!participants) return;
        const channelExists = Boolean(await this.store.getChannel(channelId));
        const floor = await this.store.getFloor(channelId, this.now());
        for (const p of participants) {
          const role = channelExists ? await this.store.getRole(channelId, p.identity) : null;
          if (!role) {
            this.log.warn({ channelId, userId: p.identity }, 'reconcile: removing non-member');
            await this.media.removeParticipant(room, p.identity);
          } else if (p.canPublish && floor?.userId !== p.identity) {
            this.log.warn({ channelId, userId: p.identity }, 'reconcile: revoking publish from non-holder');
            await this.revoke(channelId, p.identity);
          }
        }
        if (floor && !participants.some((p) => p.identity === floor.userId)) {
          await this.store.releaseFloorForUser(channelId, floor.userId);
          await this.announce(channelId, null);
          this.log.info({ channelId, userId: floor.userId }, 'reconcile: holder not in room, floor reclaimed');
        }
      });
    }
  }

  async handleWebhook(ev: WebhookEventLite): Promise<void> {
    const channelId = ev.room ? channelIdFromRoom(ev.room) : null;
    if (!channelId || !ev.identity) return;
    const userId = ev.identity;
    switch (ev.event) {
      case 'participant_joined': {
        const role = await this.store.getRole(channelId, userId);
        if (!role) {
          this.log.warn({ channelId, userId }, 'non-member joined room; removing');
          await this.dropUser(channelId, userId, { kick: true });
          return;
        }
        if (ev.canPublish) {
          const floor = await this.current(channelId);
          if (floor?.userId !== userId) await this.withChannel(channelId, () => this.revoke(channelId, userId));
        }
        return;
      }
      case 'participant_left':
      case 'participant_connection_aborted':
        await this.dropUser(channelId, userId, { kick: false });
        return;
      case 'track_published': {
        const floor = await this.current(channelId);
        if (floor?.userId !== userId || ev.trackSource !== 'MICROPHONE') {
          this.log.warn({ channelId, userId, source: ev.trackSource }, 'track published without the floor; revoking');
          await this.withChannel(channelId, () => this.revoke(channelId, userId));
        }
        return;
      }
      default:
        return;
    }
  }

  start() {
    const sweep = setInterval(() => {
      this.sweep().catch((err) => this.log.error({ err: errMsg(err) }, 'sweep failed'));
      this.limiter.prune(this.now());
    }, this.cfg.sweepIntervalMs);
    const reconcile = setInterval(() => {
      this.reconcile().catch((err) => this.log.error({ err: errMsg(err) }, 'reconcile failed'));
    }, this.cfg.reconcileIntervalMs);
    sweep.unref();
    reconcile.unref();
    this.timers = [sweep, reconcile];
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }
}

export const errMsg = (err: unknown) => (err instanceof Error ? err.message : 'Unknown error');
