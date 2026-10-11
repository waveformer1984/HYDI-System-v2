import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { AcquireResult, Channel, Lease, Member, Profile, RedeemResult, Role, Store } from './types.js';

type Row = Record<string, unknown>;

const toLease = (r: Row): Lease => ({
  channelId: r.channel_id as string,
  leaseId: r.lease_id as string,
  userId: r.user_id as string,
  grantedAt: Number(r.granted_at),
  renewDeadline: Number(r.renew_deadline),
  hardDeadline: Number(r.hard_deadline),
});

const toChannel = (r: Row): Channel => ({
  id: r.id as string,
  name: r.name as string,
  ownerId: r.owner_id as string,
  createdAt: new Date(r.created_at as string).getTime(),
});

/**
 * Postgres-backed store. Arbitration is done by single statements or
 * row-locking transactions, so several backend processes can share one
 * database safely.
 */
export class PgStore implements Store {
  readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10 });
  }

  private async tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const out = await fn(c);
      await c.query('commit');
      return out;
    } catch (err) {
      await c.query('rollback').catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  }

  async getProfile(userId: string): Promise<Profile | null> {
    const { rows } = await this.pool.query('select user_id, display_name from walkie.profiles where user_id = $1', [userId]);
    return rows[0] ? { userId: rows[0].user_id, displayName: rows[0].display_name } : null;
  }

  async upsertProfile(userId: string, displayName: string): Promise<Profile> {
    await this.pool.query(
      `insert into walkie.profiles (user_id, display_name) values ($1, $2)
       on conflict (user_id) do update set display_name = excluded.display_name, updated_at = now()`,
      [userId, displayName],
    );
    return { userId, displayName };
  }

  async createChannel(ownerId: string, name: string): Promise<Channel> {
    const id = randomUUID();
    return this.tx(async (c) => {
      const { rows } = await c.query('insert into walkie.channels (id, name, owner_id) values ($1, $2, $3) returning *', [id, name, ownerId]);
      await c.query(`insert into walkie.members (channel_id, user_id, role) values ($1, $2, 'owner')`, [id, ownerId]);
      return toChannel(rows[0]);
    });
  }

  async getChannel(channelId: string) {
    const { rows } = await this.pool.query('select * from walkie.channels where id = $1', [channelId]);
    return rows[0] ? toChannel(rows[0]) : null;
  }

  async deleteChannel(channelId: string) {
    await this.pool.query('delete from walkie.channels where id = $1', [channelId]);
  }

  async listChannelsForUser(userId: string) {
    const { rows } = await this.pool.query(
      `select c.*, m.role from walkie.channels c join walkie.members m on m.channel_id = c.id
       where m.user_id = $1 order by c.created_at`,
      [userId],
    );
    return rows.map((r) => ({ ...toChannel(r), role: r.role as Role }));
  }

  async getRole(channelId: string, userId: string) {
    const { rows } = await this.pool.query('select role from walkie.members where channel_id = $1 and user_id = $2', [channelId, userId]);
    return (rows[0]?.role as Role) ?? null;
  }

  async listMembers(channelId: string): Promise<Member[]> {
    const { rows } = await this.pool.query(
      `select m.user_id, m.role, m.joined_at, p.display_name from walkie.members m
       left join walkie.profiles p on p.user_id = m.user_id
       where m.channel_id = $1 order by m.joined_at`,
      [channelId],
    );
    return rows.map((r) => ({ userId: r.user_id, role: r.role, joinedAt: new Date(r.joined_at).getTime(), displayName: r.display_name ?? null }));
  }

  async removeMember(channelId: string, userId: string) {
    const { rowCount } = await this.pool.query('delete from walkie.members where channel_id = $1 and user_id = $2', [channelId, userId]);
    return (rowCount ?? 0) > 0;
  }

  async block(channelId: string, userId: string, blockedBy: string) {
    await this.tx(async (c) => {
      await c.query(
        `insert into walkie.blocks (channel_id, user_id, blocked_by) values ($1, $2, $3)
         on conflict (channel_id, user_id) do nothing`,
        [channelId, userId, blockedBy],
      );
      await c.query('delete from walkie.members where channel_id = $1 and user_id = $2', [channelId, userId]);
    });
  }

  async unblock(channelId: string, userId: string) {
    await this.pool.query('delete from walkie.blocks where channel_id = $1 and user_id = $2', [channelId, userId]);
  }

  async isBlocked(channelId: string, userId: string) {
    const { rowCount } = await this.pool.query('select 1 from walkie.blocks where channel_id = $1 and user_id = $2', [channelId, userId]);
    return (rowCount ?? 0) > 0;
  }

  async listBlocks(channelId: string) {
    const { rows } = await this.pool.query(
      `select b.user_id, b.blocked_at, p.display_name from walkie.blocks b
       left join walkie.profiles p on p.user_id = b.user_id where b.channel_id = $1 order by b.blocked_at`,
      [channelId],
    );
    return rows.map((r) => ({ userId: r.user_id, blockedAt: new Date(r.blocked_at).getTime(), displayName: r.display_name ?? null }));
  }

  async createInvite(channelId: string, createdBy: string, codeHash: string, expiresAt: number, maxUses: number) {
    await this.pool.query(
      'insert into walkie.invites (code_hash, channel_id, created_by, expires_at, max_uses) values ($1, $2, $3, to_timestamp($4 / 1000.0), $5)',
      [codeHash, channelId, createdBy, expiresAt, maxUses],
    );
  }

  async redeemInvite(codeHash: string, userId: string, now: number, maxMembers: number): Promise<RedeemResult> {
    return this.tx(async (c) => {
      const inv = await c.query('select channel_id, expires_at, max_uses, uses from walkie.invites where code_hash = $1 for update', [codeHash]);
      if (!inv.rows[0]) return { ok: false, reason: 'invalid' } as const;
      const { channel_id: channelId, expires_at, max_uses, uses } = inv.rows[0];
      // Serialise joins per channel so the member cap holds under concurrency.
      const ch = await c.query('select 1 from walkie.channels where id = $1 for update', [channelId]);
      if (!ch.rows[0]) return { ok: false, reason: 'invalid' } as const;
      const existing = await c.query('select 1 from walkie.members where channel_id = $1 and user_id = $2', [channelId, userId]);
      if (existing.rows[0]) return { ok: true, channelId, alreadyMember: true } as const;
      if (now >= new Date(expires_at).getTime()) return { ok: false, reason: 'expired' } as const;
      if (uses >= max_uses) return { ok: false, reason: 'exhausted' } as const;
      const blocked = await c.query('select 1 from walkie.blocks where channel_id = $1 and user_id = $2', [channelId, userId]);
      if (blocked.rows[0]) return { ok: false, reason: 'blocked' } as const;
      const count = await c.query('select count(*)::int as n from walkie.members where channel_id = $1', [channelId]);
      if (count.rows[0].n >= maxMembers) return { ok: false, reason: 'full' } as const;
      await c.query('update walkie.invites set uses = uses + 1 where code_hash = $1', [codeHash]);
      await c.query(`insert into walkie.members (channel_id, user_id, role) values ($1, $2, 'member')`, [channelId, userId]);
      return { ok: true, channelId, alreadyMember: false } as const;
    });
  }

  async acquireFloor({ channelId, userId, leaseId, now, renewTtlMs, maxMs }: { channelId: string; userId: string; leaseId: string; now: number; renewTtlMs: number; maxMs: number }): Promise<AcquireResult> {
    // One statement: insert, or take over the row only if the current lease
    // is dead or already belongs to this user. ON CONFLICT locks the row, so
    // concurrent callers (in any process) are serialised and at most one wins.
    const live = 'f.renew_deadline > $4::bigint and f.hard_deadline > $4::bigint and f.user_id = excluded.user_id';
    for (let attempt = 0; attempt < 3; attempt++) {
      const { rows } = await this.pool.query(
        `insert into walkie.floor_leases as f (channel_id, lease_id, user_id, granted_at, renew_deadline, hard_deadline)
         values ($1, $2, $3, $4::bigint, $4::bigint + $5::bigint, $4::bigint + $6::bigint)
         on conflict (channel_id) do update set
           lease_id       = case when ${live} then f.lease_id else excluded.lease_id end,
           granted_at     = case when ${live} then f.granted_at else excluded.granted_at end,
           hard_deadline  = case when ${live} then f.hard_deadline else excluded.hard_deadline end,
           renew_deadline = case when ${live} then least($4::bigint + $5::bigint, f.hard_deadline) else excluded.renew_deadline end,
           user_id        = excluded.user_id
         where f.renew_deadline <= $4::bigint or f.hard_deadline <= $4::bigint or f.user_id = excluded.user_id
         returning *`,
        [channelId, leaseId, userId, now, renewTtlMs, maxMs],
      );
      if (rows[0]) {
        const lease = toLease(rows[0]);
        return { ok: true, lease, reused: lease.leaseId !== leaseId };
      }
      const holder = await this.getFloor(channelId, now);
      if (holder) return { ok: false, holder };
      // The holder's lease died between the two statements; try again.
    }
    throw new Error('acquireFloor: could not settle floor state');
  }

  async renewFloor({ channelId, leaseId, userId, now, renewTtlMs }: { channelId: string; leaseId: string; userId: string; now: number; renewTtlMs: number }) {
    const { rows } = await this.pool.query(
      `update walkie.floor_leases set renew_deadline = least($4::bigint + $5::bigint, hard_deadline)
       where channel_id = $1 and lease_id = $2 and user_id = $3 and renew_deadline > $4::bigint and hard_deadline > $4::bigint
       returning *`,
      [channelId, leaseId, userId, now, renewTtlMs],
    );
    return rows[0] ? toLease(rows[0]) : null;
  }

  async releaseFloor(channelId: string, leaseId: string, userId: string) {
    const { rows } = await this.pool.query(
      'delete from walkie.floor_leases where channel_id = $1 and lease_id = $2 and user_id = $3 returning *',
      [channelId, leaseId, userId],
    );
    return rows[0] ? toLease(rows[0]) : null;
  }

  async releaseFloorForUser(channelId: string, userId: string) {
    const { rows } = await this.pool.query('delete from walkie.floor_leases where channel_id = $1 and user_id = $2 returning *', [channelId, userId]);
    return rows[0] ? toLease(rows[0]) : null;
  }

  async getFloor(channelId: string, now: number) {
    const { rows } = await this.pool.query(
      'select * from walkie.floor_leases where channel_id = $1 and renew_deadline > $2 and hard_deadline > $2',
      [channelId, now],
    );
    return rows[0] ? toLease(rows[0]) : null;
  }

  async expireFloors(now: number) {
    const { rows } = await this.pool.query('delete from walkie.floor_leases where renew_deadline <= $1 or hard_deadline <= $1 returning *', [now]);
    return rows.map(toLease);
  }

  async deleteUser(userId: string) {
    return this.tx(async (c) => {
      const owned = await c.query('delete from walkie.channels where owner_id = $1 returning id', [userId]);
      const member = await c.query('delete from walkie.members where user_id = $1 returning channel_id', [userId]);
      await c.query('delete from walkie.floor_leases where user_id = $1', [userId]);
      await c.query('delete from walkie.blocks where user_id = $1', [userId]);
      await c.query('delete from walkie.profiles where user_id = $1', [userId]);
      return {
        ownedChannelIds: owned.rows.map((r) => r.id as string),
        memberChannelIds: member.rows.map((r) => r.channel_id as string),
      };
    });
  }

  async close() {
    await this.pool.end();
  }
}
