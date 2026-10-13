/**
 * The same arbitration contract, run against every Store implementation.
 * Postgres runs when WALKIE_TEST_DATABASE_URL points at a disposable database
 * (the walkie schema is dropped and recreated).
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { MemoryStore } from '../src/store/memory.js';
import { PgStore } from '../src/store/pg.js';
import { migrate } from '../src/migrate.js';
import type { Store } from '../src/store/types.js';

const PG_URL = process.env.WALKIE_TEST_DATABASE_URL;

const impls: Array<{ name: string; make: () => Promise<Store>; skip?: string }> = [
  { name: 'MemoryStore', make: async () => new MemoryStore() },
  {
    name: 'PgStore',
    skip: PG_URL ? undefined : 'set WALKIE_TEST_DATABASE_URL to run against Postgres',
    make: async () => {
      const c = new pg.Client({ connectionString: PG_URL });
      await c.connect();
      await c.query('drop schema if exists walkie cascade');
      await c.end();
      await migrate(PG_URL!);
      return new PgStore(PG_URL!);
    },
  },
];

const T0 = 1_700_000_000_000;
const TTL = 5_000;
const MAX = 30_000;

for (const impl of impls) {
  describe(`Store contract: ${impl.name}`, { skip: impl.skip }, () => {
    let store: Store;
    before(async () => {
      store = await impl.make();
    });
    after(async () => {
      await store?.close();
    });

    const newChannel = async () => {
      const owner = randomUUID();
      await store.upsertProfile(owner, 'Owner');
      return { owner, ch: await store.createChannel(owner, 'Ops') };
    };
    const acquire = (channelId: string, userId: string, now = T0) =>
      store.acquireFloor({ channelId, userId, leaseId: randomUUID(), now, renewTtlMs: TTL, maxMs: MAX });

    test('owner is a member with role owner', async () => {
      const { owner, ch } = await newChannel();
      assert.equal(await store.getRole(ch.id, owner), 'owner');
      const list = await store.listChannelsForUser(owner);
      assert.ok(list.some((c) => c.id === ch.id && c.role === 'owner'));
    });

    test('simultaneous floor requests: exactly one winner', async () => {
      const { ch } = await newChannel();
      const users = Array.from({ length: 25 }, () => randomUUID());
      const results = await Promise.all(users.map((u) => acquire(ch.id, u)));
      const winners = results.filter((r) => r.ok);
      assert.equal(winners.length, 1);
      const winner = winners[0]!;
      assert.ok(winner.ok);
      for (const r of results) if (!r.ok) assert.equal(r.holder.userId, winner.lease.userId);
      assert.equal((await store.getFloor(ch.id, T0))?.userId, winner.lease.userId);
    });

    test('same user re-request keeps the lease and never extends the hard deadline', async () => {
      const { ch } = await newChannel();
      const u = randomUUID();
      const a = await acquire(ch.id, u, T0);
      assert.ok(a.ok);
      const b = await acquire(ch.id, u, T0 + 4_000);
      assert.ok(b.ok && b.reused);
      assert.equal(b.lease.leaseId, a.lease.leaseId);
      assert.equal(b.lease.hardDeadline, T0 + MAX);
      assert.equal(b.lease.renewDeadline, T0 + 4_000 + TTL);
    });

    test('renew extends only up to the hard deadline; wrong lease or user cannot renew', async () => {
      const { ch } = await newChannel();
      const u = randomUUID();
      const a = await acquire(ch.id, u);
      assert.ok(a.ok);
      assert.equal(await store.renewFloor({ channelId: ch.id, leaseId: randomUUID(), userId: u, now: T0 + 1000, renewTtlMs: TTL }), null);
      assert.equal(await store.renewFloor({ channelId: ch.id, leaseId: a.lease.leaseId, userId: randomUUID(), now: T0 + 1000, renewTtlMs: TTL }), null);
      let t = T0;
      while (t + 4_000 < T0 + MAX) {
        t += 4_000;
        const r = await store.renewFloor({ channelId: ch.id, leaseId: a.lease.leaseId, userId: u, now: t, renewTtlMs: TTL });
        assert.ok(r, `renew at +${t - T0}`);
        assert.ok(r.renewDeadline <= T0 + MAX);
      }
      assert.equal(await store.renewFloor({ channelId: ch.id, leaseId: a.lease.leaseId, userId: u, now: T0 + MAX, renewTtlMs: TTL }), null);
    });

    test('an unrenewed lease dies after the renew TTL and can be taken over', async () => {
      const { ch } = await newChannel();
      const a = randomUUID();
      const b = randomUUID();
      assert.ok((await acquire(ch.id, a, T0)).ok);
      assert.equal((await acquire(ch.id, b, T0 + TTL - 1)).ok, false);
      const taken = await acquire(ch.id, b, T0 + TTL);
      assert.ok(taken.ok && taken.lease.userId === b);
    });

    test('expireFloors returns dead leases exactly once', async () => {
      const { ch } = await newChannel();
      const u = randomUUID();
      assert.ok((await acquire(ch.id, u, T0)).ok);
      assert.equal((await store.expireFloors(T0 + TTL - 1)).filter((l) => l.channelId === ch.id).length, 0);
      const dead = (await store.expireFloors(T0 + TTL)).filter((l) => l.channelId === ch.id);
      assert.equal(dead.length, 1);
      assert.equal(dead[0]!.userId, u);
      assert.equal((await store.expireFloors(T0 + TTL)).filter((l) => l.channelId === ch.id).length, 0);
      assert.equal(await store.getFloor(ch.id, T0 + TTL), null);
    });

    test('release needs the matching lease id and user', async () => {
      const { ch } = await newChannel();
      const u = randomUUID();
      const a = await acquire(ch.id, u);
      assert.ok(a.ok);
      assert.equal(await store.releaseFloor(ch.id, randomUUID(), u), null);
      assert.equal(await store.releaseFloor(ch.id, a.lease.leaseId, randomUUID()), null);
      assert.equal((await store.releaseFloor(ch.id, a.lease.leaseId, u))?.leaseId, a.lease.leaseId);
      assert.equal(await store.getFloor(ch.id, T0), null);
    });

    test('invites: single use, expiry, block and member cap', async () => {
      const { owner, ch } = await newChannel();
      const alice = randomUUID();
      const bob = randomUUID();
      const carol = randomUUID();
      await store.createInvite(ch.id, owner, 'h-once', T0 + 1000, 1);
      assert.deepEqual(await store.redeemInvite('h-once', alice, T0, 50), { ok: true, channelId: ch.id, alreadyMember: false });
      assert.deepEqual(await store.redeemInvite('h-once', alice, T0, 50), { ok: true, channelId: ch.id, alreadyMember: true });
      assert.deepEqual(await store.redeemInvite('h-once', bob, T0, 50), { ok: false, reason: 'exhausted' });
      await store.createInvite(ch.id, owner, 'h-exp', T0 + 1000, 5);
      assert.deepEqual(await store.redeemInvite('h-exp', bob, T0 + 1000, 50), { ok: false, reason: 'expired' });
      assert.deepEqual(await store.redeemInvite('nope', bob, T0, 50), { ok: false, reason: 'invalid' });
      await store.block(ch.id, bob, owner);
      await store.createInvite(ch.id, owner, 'h-multi', T0 + 1000, 5);
      assert.deepEqual(await store.redeemInvite('h-multi', bob, T0, 50), { ok: false, reason: 'blocked' });
      assert.deepEqual(await store.redeemInvite('h-multi', carol, T0, 2), { ok: false, reason: 'full' });
    });

    test('peekInvite shows only invites that could still be redeemed', async () => {
      const { owner, ch } = await newChannel();
      const h = `h-peek-${ch.id}`;
      await store.createInvite(ch.id, owner, h, T0 + 1000, 1);
      assert.deepEqual(await store.peekInvite(h, T0), { channelId: ch.id, channelName: 'Ops', ownerName: 'Owner', expiresAt: T0 + 1000 });
      assert.equal(await store.peekInvite(h, T0 + 1000), null, 'expired');
      assert.equal(await store.peekInvite('nope', T0), null, 'unknown');
      await store.redeemInvite(h, randomUUID(), T0, 50);
      assert.equal(await store.peekInvite(h, T0), null, 'used up');
      const h2 = `h-peek2-${ch.id}`;
      await store.createInvite(ch.id, owner, h2, T0 + 1000, 1);
      await store.deleteChannel(ch.id);
      assert.equal(await store.peekInvite(h2, T0), null, 'channel deleted');
    });

    test('concurrent redemption of a single-use invite admits one user', async () => {
      const { owner, ch } = await newChannel();
      await store.createInvite(ch.id, owner, `h-race-${ch.id}`, T0 + 10_000, 1);
      const users = Array.from({ length: 10 }, () => randomUUID());
      const rs = await Promise.all(users.map((u) => store.redeemInvite(`h-race-${ch.id}`, u, T0, 50)));
      assert.equal(rs.filter((r) => r.ok).length, 1);
      assert.equal((await store.listMembers(ch.id)).length, 2);
    });

    test('block removes membership; removeMember reports whether anything changed', async () => {
      const { owner, ch } = await newChannel();
      const u = randomUUID();
      await store.createInvite(ch.id, owner, `h-b-${ch.id}`, T0 + 1000, 5);
      await store.redeemInvite(`h-b-${ch.id}`, u, T0, 50);
      assert.equal(await store.getRole(ch.id, u), 'member');
      await store.block(ch.id, u, owner);
      assert.equal(await store.getRole(ch.id, u), null);
      assert.equal(await store.isBlocked(ch.id, u), true);
      assert.equal(await store.removeMember(ch.id, u), false);
      await store.unblock(ch.id, u);
      assert.equal(await store.isBlocked(ch.id, u), false);
    });

    test('PTT tokens: upsert per member, removed with membership, block, channel and by value', async () => {
      const { owner, ch } = await newChannel();
      const u = randomUUID();
      const v = randomUUID();
      await store.createInvite(ch.id, owner, `h-p-${ch.id}`, T0 + 1000, 5);
      await store.redeemInvite(`h-p-${ch.id}`, u, T0, 50);
      await store.redeemInvite(`h-p-${ch.id}`, v, T0, 50);
      await store.setPttToken(ch.id, u, 'aa'.repeat(16), 'sandbox');
      await store.setPttToken(ch.id, u, 'ab'.repeat(16), 'production');
      await store.setPttToken(ch.id, v, 'bb'.repeat(16), 'sandbox');
      await store.setPttToken(ch.id, owner, 'cc'.repeat(16), 'sandbox');
      const byUser = Object.fromEntries((await store.listPttTokens(ch.id)).map((t) => [t.userId, t]));
      assert.deepEqual(byUser[u], { userId: u, token: 'ab'.repeat(16), environment: 'production' });
      await store.removeMember(ch.id, u);
      await store.block(ch.id, v, owner);
      assert.deepEqual((await store.listPttTokens(ch.id)).map((t) => t.userId), [owner]);
      await store.deletePttTokenValue('cc'.repeat(16));
      assert.deepEqual(await store.listPttTokens(ch.id), []);
      await store.setPttToken(ch.id, owner, 'dd'.repeat(16), 'sandbox');
      await store.deleteChannel(ch.id);
      assert.deepEqual(await store.listPttTokens(ch.id), []);
      // Writing a token for a channel that no longer exists is a no-op.
      await store.setPttToken(ch.id, owner, 'ee'.repeat(16), 'sandbox');
      assert.deepEqual(await store.listPttTokens(ch.id), []);
    });

    test('deleteUser removes owned channels, memberships, leases and profile', async () => {
      const { owner: other, ch: theirs } = await newChannel();
      const u = randomUUID();
      await store.upsertProfile(u, 'Leaving');
      const mine = await store.createChannel(u, 'Mine');
      await store.createInvite(theirs.id, other, `h-d-${theirs.id}`, T0 + 1000, 1);
      await store.redeemInvite(`h-d-${theirs.id}`, u, T0, 50);
      assert.ok((await acquire(theirs.id, u)).ok);
      const r = await store.deleteUser(u);
      assert.deepEqual(r.ownedChannelIds, [mine.id]);
      assert.deepEqual(r.memberChannelIds, [theirs.id]);
      assert.equal(await store.getChannel(mine.id), null);
      assert.equal(await store.getRole(theirs.id, u), null);
      assert.equal(await store.getFloor(theirs.id, T0), null);
      assert.equal(await store.getProfile(u), null);
    });
  });
}
