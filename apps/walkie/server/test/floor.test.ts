import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { FloorService } from '../src/floor.js';
import { roomNameFor } from '../src/livekit.js';
import { MemoryStore } from '../src/store/memory.js';
import { FakeClock, FakeMedia, silentLog, testConfig } from './helpers.js';

describe('FloorService', () => {
  let store: MemoryStore;
  let media: FakeMedia;
  let clock: FakeClock;
  let floor: FloorService;
  let channelId: string;
  let room: string;
  let alice: string;
  let bob: string;
  const cfg = testConfig();

  beforeEach(async () => {
    store = new MemoryStore();
    media = new FakeMedia();
    clock = new FakeClock();
    floor = new FloorService(store, media, cfg, silentLog, clock.now);
    alice = randomUUID();
    bob = randomUUID();
    const ch = await store.createChannel(alice, 'Ops');
    channelId = ch.id;
    room = roomNameFor(channelId);
    await store.createInvite(channelId, alice, 'h', clock.t + 1e6, 5);
    await store.redeemInvite('h', bob, clock.t, 50);
    media.connect(room, alice);
    media.connect(room, bob);
  });

  test('nobody can publish on join; a grant enables exactly the winner', async () => {
    assert.deepEqual(media.publishers(room), []);
    const r = await floor.requestTalk(alice, channelId);
    assert.equal(r.kind, 'granted');
    assert.deepEqual(media.publishers(room), [alice]);
    assert.equal(media.metadata.get(room)?.speaker?.userId, alice);
  });

  test('simultaneous presses: one speaker, the other is told busy', async () => {
    const [a, b] = await Promise.all([floor.requestTalk(alice, channelId), floor.requestTalk(bob, channelId)]);
    const kinds = [a.kind, b.kind].sort();
    assert.deepEqual(kinds, ['busy', 'granted']);
    assert.equal(media.publishers(room).length, 1);
  });

  test('release revokes publishing and clears the speaker', async () => {
    const r = await floor.requestTalk(alice, channelId);
    assert.equal(r.kind, 'granted');
    if (r.kind !== 'granted') return;
    assert.equal(await floor.release(alice, channelId, r.leaseId), true);
    assert.deepEqual(media.publishers(room), []);
    assert.equal(media.metadata.get(room)?.speaker, null);
    clock.advance(300);
    assert.equal((await floor.requestTalk(bob, channelId)).kind, 'granted');
  });

  test('a stale or foreign lease id cannot release someone else’s turn', async () => {
    const r = await floor.requestTalk(alice, channelId);
    assert.equal(r.kind, 'granted');
    assert.equal(await floor.release(bob, channelId, r.kind === 'granted' ? r.leaseId : ''), false);
    assert.deepEqual(media.publishers(room), [alice]);
  });

  test('missed renewals (lost connectivity) reclaim the floor and revoke publishing', async () => {
    const r = await floor.requestTalk(alice, channelId);
    assert.equal(r.kind, 'granted');
    clock.advance(cfg.talk.renewTtlMs - 1);
    assert.equal(await floor.sweep(), 0);
    assert.deepEqual(media.publishers(room), [alice]);
    clock.advance(1);
    assert.equal(await floor.sweep(), 1);
    assert.deepEqual(media.publishers(room), []);
    assert.equal(media.metadata.get(room)?.speaker, null);
    assert.equal((await floor.requestTalk(bob, channelId)).kind, 'granted');
  });

  test('renewing keeps the turn, but never past the configured maximum duration', async () => {
    const r = await floor.requestTalk(alice, channelId);
    assert.equal(r.kind, 'granted');
    if (r.kind !== 'granted') return;
    let renewed = 0;
    while (clock.t + r.renewEveryMs < r.hardDeadline) {
      clock.advance(r.renewEveryMs);
      assert.ok(await floor.renew(alice, channelId, r.leaseId));
      await floor.sweep();
      renewed++;
    }
    assert.ok(renewed > 10);
    assert.deepEqual(media.publishers(room), [alice]);
    clock.t = r.hardDeadline;
    await floor.sweep();
    assert.deepEqual(media.publishers(room), []);
    assert.equal(await floor.renew(alice, channelId, r.leaseId), null);
  });

  test('renewing a lost turn returns null and revokes', async () => {
    const r = await floor.requestTalk(alice, channelId);
    if (r.kind !== 'granted') throw new Error('expected grant');
    clock.advance(cfg.talk.renewTtlMs);
    assert.equal(await floor.renew(alice, channelId, r.leaseId), null);
    assert.deepEqual(media.publishers(room), []);
  });

  test('rapid repeated requests are rate limited', async () => {
    const first = await floor.requestTalk(alice, channelId);
    assert.equal(first.kind, 'granted');
    const again = await floor.requestTalk(alice, channelId);
    assert.equal(again.kind, 'rate_limited');
    // Burst cap: 6 requests per 10 s even when spaced past the min interval.
    let limited = 0;
    for (let i = 0; i < 10; i++) {
      clock.advance(300);
      if ((await floor.requestTalk(bob, channelId)).kind === 'rate_limited') limited++;
    }
    assert.ok(limited >= 4, `expected the burst cap to bite, got ${limited}`);
  });

  test('non-members are refused and nothing is granted', async () => {
    const mallory = randomUUID();
    media.connect(room, mallory);
    assert.equal((await floor.requestTalk(mallory, channelId)).kind, 'forbidden');
    assert.deepEqual(media.publishers(room), []);
  });

  test('a member not connected to the room gets not_connected and the floor stays free', async () => {
    media.disconnect(room, bob);
    assert.equal((await floor.requestTalk(bob, channelId)).kind, 'not_connected');
    assert.equal(await floor.current(channelId), null);
  });

  test('LiveKit failure during grant leaves no lease and no publish right', async () => {
    media.failNextGrant = true;
    assert.equal((await floor.requestTalk(alice, channelId)).kind, 'unavailable');
    assert.equal(await floor.current(channelId), null);
    assert.deepEqual(media.publishers(room), []);
  });

  test('release racing an in-flight grant ends with publishing revoked', async () => {
    let releasePromise: Promise<boolean> | undefined;
    media.onGrant = async () => {
      media.onGrant = undefined;
      const lease = await store.getFloor(channelId, clock.t);
      // The client lets go while the server is still talking to LiveKit.
      releasePromise = floor.release(alice, channelId, lease!.leaseId);
    };
    const r = await floor.requestTalk(alice, channelId);
    assert.equal(r.kind, 'granted');
    await releasePromise;
    assert.deepEqual(media.publishers(room), []);
    assert.equal(await floor.current(channelId), null);
  });

  test('if the lease is reclaimed during the grant, the grant is taken back', async () => {
    media.onGrant = async () => {
      media.onGrant = undefined;
      // Simulates another backend instance's sweeper + a new winner.
      clock.advance(cfg.talk.renewTtlMs);
      await store.expireFloors(clock.t);
      await store.acquireFloor({ channelId, userId: bob, leaseId: randomUUID(), now: clock.t, renewTtlMs: 5000, maxMs: 30000 });
    };
    const r = await floor.requestTalk(alice, channelId);
    assert.equal(r.kind, 'busy');
    assert.equal(media.canPublish(room, alice), false);
  });

  test('dropping the speaker (removal/block/leave) kicks them and frees the floor', async () => {
    assert.equal((await floor.requestTalk(bob, channelId)).kind, 'granted');
    await store.removeMember(channelId, bob);
    await floor.dropUser(channelId, bob, { kick: true });
    assert.deepEqual(media.removed, [{ room, identity: bob }]);
    assert.equal(await floor.current(channelId), null);
    assert.equal(media.metadata.get(room)?.speaker, null);
  });

  test('webhook: speaker leaving the room frees the floor immediately', async () => {
    assert.equal((await floor.requestTalk(bob, channelId)).kind, 'granted');
    media.disconnect(room, bob);
    await floor.handleWebhook({ event: 'participant_left', room, identity: bob });
    assert.equal(await floor.current(channelId), null);
  });

  test('webhook: a non-member who joins is removed', async () => {
    const mallory = randomUUID();
    media.connect(room, mallory);
    await floor.handleWebhook({ event: 'participant_joined', room, identity: mallory, canPublish: false });
    assert.deepEqual(media.removed, [{ room, identity: mallory }]);
  });

  test('webhook: a member who joins with publish rights but no floor is revoked', async () => {
    media.rooms.get(room)!.get(bob)!.canPublish = true;
    await floor.handleWebhook({ event: 'participant_joined', room, identity: bob, canPublish: true });
    assert.equal(media.canPublish(room, bob), false);
  });

  test('webhook: a track published without the floor is revoked', async () => {
    media.rooms.get(room)!.get(bob)!.canPublish = true;
    await floor.handleWebhook({ event: 'track_published', room, identity: bob, trackSource: 'MICROPHONE' });
    assert.equal(media.canPublish(room, bob), false);
  });

  test('reconcile repairs LiveKit to match the store', async () => {
    const mallory = randomUUID();
    media.connect(room, mallory);
    media.rooms.get(room)!.get(bob)!.canPublish = true; // publisher without a lease
    assert.equal((await floor.requestTalk(alice, channelId)).kind, 'granted');
    media.disconnect(room, alice); // holder vanished without a webhook
    await floor.reconcile();
    assert.ok(media.removed.some((r) => r.identity === mallory));
    assert.equal(media.canPublish(room, bob), false);
    assert.equal(await floor.current(channelId), null);
  });

  test('reconcile empties the room of a deleted channel', async () => {
    await store.deleteChannel(channelId);
    await floor.reconcile();
    assert.deepEqual(media.rooms.get(room)?.size, 0);
  });
});
