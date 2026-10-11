/**
 * End-to-end against a REAL LiveKit server with real WebRTC media.
 *
 * Two (or three) headless clients built on @livekit/rtc-node play the role of
 * phones: they sign in, fetch join tokens from the walkie backend, connect to
 * LiveKit, and publish a generated 440 Hz tone as microphone audio. This
 * proves the enforcement lives in the media server (publish permission), not
 * in a UI. It does NOT exercise phone microphones, speakers, radios, audio
 * routing or React Native — see docs/DEVICE_TEST_CHECKLIST.md for those.
 *
 * Requires:
 *   - LiveKit at ws://127.0.0.1:7880 started with ../livekit/livekit.dev.yaml
 *     (its webhook points at http://127.0.0.1:8787/livekit/webhook)
 *   - WALKIE_TEST_LIVEKIT=1
 *   - optional WALKIE_TEST_DATABASE_URL to use Postgres instead of memory
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  dispose,
  type RemoteTrack,
} from '@livekit/rtc-node';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { DevVerifier } from '../src/auth.js';
import { LiveKitGateway, roomNameFor } from '../src/livekit.js';
import { MemoryStore } from '../src/store/memory.js';
import { PgStore } from '../src/store/pg.js';
import { migrate } from '../src/migrate.js';
import type { FloorService } from '../src/floor.js';
import type { Store } from '../src/store/types.js';
import { DEV_SECRET, testConfig } from './helpers.js';

const ENABLED = process.env.WALKIE_TEST_LIVEKIT === '1';
const LK_URL = process.env.WALKIE_TEST_LIVEKIT_URL ?? 'ws://127.0.0.1:7880';
const LK_KEY = process.env.WALKIE_TEST_LIVEKIT_KEY ?? 'walkie-dev-key';
const LK_SECRET = process.env.WALKIE_TEST_LIVEKIT_SECRET ?? 'walkie-dev-secret-change-me-0123456789abcdef';
const PORT = 8787;
const BASE = `http://127.0.0.1:${PORT}`;
const RENEW_TTL = 2000;
const MAX_MS = 6000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function waitFor<T>(what: string, ms: number, fn: (resolve: (v: T) => void) => void | (() => void)): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let cleanup: void | (() => void);
    const t = setTimeout(() => {
      if (cleanup) cleanup();
      reject(new Error(`timed out after ${ms} ms waiting for ${what}`));
    }, ms);
    cleanup = fn((v) => {
      clearTimeout(t);
      if (cleanup) cleanup();
      resolve(v);
    });
  });
}

function on<E extends RoomEvent>(room: Room, ev: E, handler: (...args: any[]) => void) {
  room.on(ev, handler as never);
  return () => room.off(ev, handler as never);
}

type Phone = {
  name: string;
  userId: string;
  token: string;
  room?: Room;
  api: (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any }>;
};

async function phone(name: string): Promise<Phone> {
  const s = await (await fetch(`${BASE}/v1/dev/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: name }) })).json();
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { authorization: `Bearer ${s.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  await api('PUT', '/v1/me', { displayName: name });
  return { name, userId: s.userId, token: s.token, api };
}

async function connect(p: Phone, channelId: string) {
  const c = await p.api('POST', `/v1/channels/${channelId}/connection`);
  assert.equal(c.status, 200, `${p.name} connection: ${JSON.stringify(c.json)}`);
  const room = new Room();
  await room.connect(c.json.url, c.json.token, { autoSubscribe: true, dynacast: false });
  p.room = room;
  return { room, lkToken: c.json.token as string, url: c.json.url as string };
}

/** A tone generator standing in for a microphone. */
class Tone {
  readonly source = new AudioSource(48000, 1);
  private running = false;
  private phase = 0;
  start() {
    this.running = true;
    void (async () => {
      while (this.running) {
        const n = 480; // 10 ms
        const data = new Int16Array(n);
        for (let i = 0; i < n; i++) data[i] = Math.round(8000 * Math.sin((2 * Math.PI * 440 * (this.phase + i)) / 48000));
        this.phase += n;
        try {
          await this.source.captureFrame(new AudioFrame(data, 48000, 1, n));
        } catch {
          await sleep(10);
        }
      }
    })();
  }
  stop() {
    this.running = false;
  }
}

/** Resolves with the time the first audible (non-silent) frame arrives from `fromIdentity`. */
function firstAudibleFrom(listener: Room, fromIdentity: string, timeoutMs: number) {
  return waitFor<number>(`audio from ${fromIdentity}`, timeoutMs, (resolve) => {
    let stopped = false;
    const consume = async (track: RemoteTrack) => {
      const stream = new AudioStream(track, 48000, 1);
      const reader = stream.getReader();
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done || !value) return;
        let sum = 0;
        for (const s of value.data) sum += s * s;
        if (Math.sqrt(sum / value.data.length) > 1000) {
          resolve(performance.now());
          reader.releaseLock();
          return;
        }
      }
    };
    for (const rp of listener.remoteParticipants.values()) {
      if (rp.identity !== fromIdentity) continue;
      for (const pub of rp.trackPublications.values()) if (pub.track && pub.kind === TrackKind.KIND_AUDIO) void consume(pub.track as RemoteTrack);
    }
    const off = on(listener, RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: unknown, participant: { identity: string }) => {
      if (participant.identity === fromIdentity && track.kind === TrackKind.KIND_AUDIO) void consume(track);
    });
    return () => {
      stopped = true;
      off();
    };
  });
}

function trackGoneFrom(listener: Room, fromIdentity: string, timeoutMs: number) {
  return waitFor<number>(`track from ${fromIdentity} to disappear`, timeoutMs, (resolve) => {
    const h = (_x: unknown, _pub: unknown, participant: { identity: string }) => {
      if (participant.identity === fromIdentity) resolve(performance.now());
    };
    const off1 = on(listener, RoomEvent.TrackUnsubscribed, h);
    const off2 = on(listener, RoomEvent.TrackUnpublished, (_pub: unknown, participant: { identity: string }) => h(null, null, participant));
    return () => {
      off1();
      off2();
    };
  });
}

const micOptions = () => new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE });

const results: Record<string, unknown> = {};

describe('walkie ↔ real LiveKit', { skip: ENABLED ? undefined : 'set WALKIE_TEST_LIVEKIT=1 with a local LiveKit running' }, () => {
  let app: FastifyInstance;
  let floor: FloorService;
  let store: Store;
  let alice: Phone;
  let bob: Phone;
  let mallory: Phone;
  let carol: Phone;
  let channelId: string;

  before(async () => {
    const cfg = testConfig({
      livekit: { url: LK_URL, apiUrl: LK_URL.replace(/^ws/, 'http'), apiKey: LK_KEY, apiSecret: LK_SECRET },
      talk: { maxMs: MAX_MS, renewTtlMs: RENEW_TTL, minRequestIntervalMs: 100, burst: 50, burstWindowMs: 10_000 },
      sweepIntervalMs: 100,
      reconcileIntervalMs: 2000,
      logLevel: 'warn',
    });
    if (process.env.WALKIE_TEST_DATABASE_URL) {
      await migrate(process.env.WALKIE_TEST_DATABASE_URL);
      store = new PgStore(process.env.WALKIE_TEST_DATABASE_URL);
    } else {
      store = new MemoryStore();
    }
    ({ app, floor } = await buildApp({ config: cfg, store, media: new LiveKitGateway(cfg.livekit), verifier: new DevVerifier(DEV_SECRET), deleteAuthUser: async () => false }));
    floor.start();
    await app.listen({ host: '127.0.0.1', port: PORT });

    alice = await phone(`alice${Date.now()}`);
    bob = await phone(`bob${Date.now()}`);
    mallory = await phone(`mallory${Date.now()}`);
    carol = await phone(`carol${Date.now()}`);
    channelId = (await alice.api('POST', '/v1/channels', { name: 'Integration' })).json.id;
    const inv = await alice.api('POST', `/v1/channels/${channelId}/invites`, { maxUses: 2 });
    assert.equal((await bob.api('POST', '/v1/invites/redeem', { code: inv.json.code })).status, 200);
    assert.equal((await carol.api('POST', '/v1/invites/redeem', { code: inv.json.code })).status, 200);
    await connect(alice, channelId);
    await connect(bob, channelId);
    results.store = process.env.WALKIE_TEST_DATABASE_URL ? 'postgres' : 'memory';
    results.livekit = LK_URL;
  });

  after(async () => {
    for (const p of [alice, bob, mallory, carol]) await p?.room?.disconnect().catch(() => {});
    floor?.stop();
    await app?.close();
    await store?.close();
    if (process.env.WALKIE_RESULTS_FILE) writeFileSync(process.env.WALKIE_RESULTS_FILE, JSON.stringify(results, null, 2));
    await dispose();
  });

  test('a non-member cannot get room credentials', async () => {
    assert.equal((await mallory.api('POST', `/v1/channels/${channelId}/connection`)).status, 404);
    assert.equal((await mallory.api('POST', `/v1/channels/${channelId}/talk`)).status, 404);
  });

  test('a forged LiveKit token is rejected by the media server', async () => {
    const { AccessToken } = await import('livekit-server-sdk');
    const at = new AccessToken(LK_KEY, 'not-the-real-secret-not-the-real-secret', { identity: mallory.userId });
    at.addGrant({ room: roomNameFor(channelId), roomJoin: true, canPublish: true });
    const room = new Room();
    await assert.rejects(room.connect(LK_URL, await at.toJwt(), { autoSubscribe: false, dynacast: false }));
  });

  test('joining does not publish; publishing without the floor is refused by LiveKit', async () => {
    // A separate member (carol) makes the attempt: a refused publish never
    // settles in the client SDK, so it would wedge that client for later tests.
    const { room } = await connect(carol, channelId);
    assert.equal(room.localParticipant!.trackPublications.size, 0);
    const tone = new Tone();
    const track = LocalAudioTrack.createAudioTrack('mic', tone.source);
    tone.start();
    const heard = firstAudibleFrom(bob.room!, carol.userId, 4000).then(
      () => true,
      () => false,
    );
    const outcome = await Promise.race([
      room.localParticipant!.publishTrack(track, micOptions()).then(
        () => 'published',
        (e: Error) => `rejected: ${e.message}`,
      ),
      sleep(5000).then(() => 'no publish acknowledgement within 5 s'),
    ]);
    tone.stop();
    assert.notEqual(outcome, 'published', 'LiveKit accepted a publish without permission');
    assert.equal(await heard, false, 'listener received audio from a participant without the floor');
    const parts = await new LiveKitGateway({ url: LK_URL, apiUrl: LK_URL.replace(/^ws/, 'http'), apiKey: LK_KEY, apiSecret: LK_SECRET }).listParticipants(roomNameFor(channelId));
    assert.deepEqual(parts!.find((x) => x.identity === carol.userId)?.publishedTrackSids, []);
    results.unauthorizedPublish = outcome;
    await room.disconnect();
    carol.room = undefined;
  });

  test('press → grant → audible at the other phone; measure latency', async () => {
    const samples: Array<Record<string, number>> = [];
    for (let i = 0; i < 5; i++) {
      const tone = new Tone();
      const track = LocalAudioTrack.createAudioTrack('mic', tone.source);
      tone.start();
      const heard = firstAudibleFrom(bob.room!, alice.userId, 8000);
      let tSub = 0;
      const offSub = on(bob.room!, RoomEvent.TrackSubscribed, (_t: unknown, _p: unknown, participant: { identity: string }) => {
        if (participant.identity === alice.userId && !tSub) tSub = performance.now();
      });
      const t0 = performance.now();
      const g = await alice.api('POST', `/v1/channels/${channelId}/talk`);
      const tGrant = performance.now();
      assert.equal(g.status, 200, JSON.stringify(g.json));
      const pub = await alice.room!.localParticipant!.publishTrack(track, micOptions());
      const tPub = performance.now();
      const tAudio = await heard;
      offSub();
      // Release, while this "client" deliberately keeps feeding its source and
      // never unpublishes: the server must cut it off on its own.
      const gone = trackGoneFrom(bob.room!, alice.userId, 5000);
      const tRel = performance.now();
      assert.equal((await alice.api('DELETE', `/v1/channels/${channelId}/talk/${g.json.leaseId}`)).json.released, true);
      const tGone = await gone;
      tone.stop();
      samples.push({
        pressToGrantMs: +(tGrant - t0).toFixed(1),
        grantToPublishedMs: +(tPub - tGrant).toFixed(1),
        pressToListenerSubscribedMs: +(tSub - t0).toFixed(1),
        subscribedToFirstAudibleFrameMs: +(tAudio - tSub).toFixed(1),
        pressToFirstAudioMs: +(tAudio - t0).toFixed(1),
        releaseToSilenceMs: +(tGone - tRel).toFixed(1),
      });
      void pub;
      await sleep(300);
    }
    results.latencyLoopback = samples;
  });

  test('a granted speaker can publish microphone only (no screen-share audio)', async () => {
    const { room } = await connect(carol, channelId);
    const g = await carol.api('POST', `/v1/channels/${channelId}/talk`);
    assert.equal(g.status, 200);
    const tone = new Tone();
    const track = LocalAudioTrack.createAudioTrack('not-a-mic', tone.source);
    const outcome = await Promise.race([
      room.localParticipant!.publishTrack(track, new TrackPublishOptions({ source: TrackSource.SOURCE_SCREENSHARE_AUDIO })).then(
        () => 'published',
        (e: Error) => `rejected: ${e.message}`,
      ),
      sleep(5000).then(() => 'no publish acknowledgement within 5 s'),
    ]);
    assert.notEqual(outcome, 'published');
    await carol.api('DELETE', `/v1/channels/${channelId}/talk/${g.json.leaseId}`);
    results.wrongSourcePublish = outcome;
    await room.disconnect();
    carol.room = undefined;
    await sleep(200);
  });

  test('simultaneous presses on two phones: exactly one speaker', async () => {
    const tally: number[][] = [];
    for (let i = 0; i < 10; i++) {
      const [a, b] = await Promise.all([alice.api('POST', `/v1/channels/${channelId}/talk`), bob.api('POST', `/v1/channels/${channelId}/talk`)]);
      tally.push([a.status, b.status]);
      assert.deepEqual([a.status, b.status].sort(), [200, 409], `round ${i}: ${a.status}/${b.status}`);
      const winner = a.status === 200 ? { p: alice, r: a } : { p: bob, r: b };
      const parts = await new LiveKitGateway({ url: LK_URL, apiUrl: LK_URL.replace(/^ws/, 'http'), apiKey: LK_KEY, apiSecret: LK_SECRET }).listParticipants(roomNameFor(channelId));
      assert.deepEqual(parts!.filter((x) => x.canPublish).map((x) => x.identity), [winner.p.userId]);
      await winner.p.api('DELETE', `/v1/channels/${channelId}/talk/${winner.r.json.leaseId}`);
      await sleep(150);
    }
    results.simultaneousPresses = { rounds: tally.length, outcome: 'one 200 and one 409 every round' };
  });

  test('a speaker that stops renewing (lost connectivity) is cut off and the floor is reclaimed', async () => {
    const tone = new Tone();
    const track = LocalAudioTrack.createAudioTrack('mic', tone.source);
    tone.start();
    const heard = firstAudibleFrom(bob.room!, alice.userId, 8000);
    const g = await alice.api('POST', `/v1/channels/${channelId}/talk`);
    assert.equal(g.status, 200);
    await alice.room!.localParticipant!.publishTrack(track, micOptions());
    await heard;
    const gone = trackGoneFrom(bob.room!, alice.userId, RENEW_TTL + 4000);
    const t0 = performance.now();
    // No renewals from here on.
    const tGone = await gone;
    tone.stop();
    const reclaimMs = tGone - t0;
    assert.ok(reclaimMs < RENEW_TTL + 1500, `took ${reclaimMs} ms`);
    assert.equal((await bob.api('GET', `/v1/channels/${channelId}/talk`)).json.speaker, null);
    assert.equal((await bob.api('POST', `/v1/channels/${channelId}/talk`)).status, 200);
    const cur = (await bob.api('GET', `/v1/channels/${channelId}/talk`)).json.speaker;
    await floor.dropUser(channelId, bob.userId, { kick: false });
    results.renewTimeoutCutoffMs = +reclaimMs.toFixed(0);
    results.renewTtlMs = RENEW_TTL;
    void cur;
    await sleep(200);
  });

  test('the maximum speaking duration is enforced even while renewing', async () => {
    const g = await alice.api('POST', `/v1/channels/${channelId}/talk`);
    assert.equal(g.status, 200);
    const t0 = performance.now();
    let renewStatus = 200;
    while (renewStatus === 200 && performance.now() - t0 < MAX_MS + 3000) {
      await sleep(500);
      renewStatus = (await alice.api('POST', `/v1/channels/${channelId}/talk/${g.json.leaseId}/renew`)).status;
    }
    const elapsed = performance.now() - t0;
    assert.equal(renewStatus, 410);
    assert.ok(elapsed >= MAX_MS - 600 && elapsed < MAX_MS + 1500, `turn lasted ${elapsed} ms`);
    results.maxDurationEnforcedAtMs = +elapsed.toFixed(0);
    results.maxDurationConfiguredMs = MAX_MS;
  });

  test('speaker disconnecting abruptly frees the floor via webhook', async () => {
    const g = await bob.api('POST', `/v1/channels/${channelId}/talk`);
    assert.equal(g.status, 200);
    const t0 = performance.now();
    await bob.room!.disconnect();
    let speaker: unknown = 'held';
    while (speaker !== null && performance.now() - t0 < RENEW_TTL + 3000) {
      await sleep(50);
      speaker = (await alice.api('GET', `/v1/channels/${channelId}/talk`)).json.speaker;
    }
    assert.equal(speaker, null);
    results.disconnectReleaseMs = +(performance.now() - t0).toFixed(0);
    await connect(bob, channelId);
  });

  test('removing a member kicks them and their old room token stops working', async () => {
    const old = await bob.api('POST', `/v1/channels/${channelId}/connection`);
    const kicked = waitFor<void>('bob disconnected', 5000, (resolve) => on(bob.room!, RoomEvent.Disconnected, () => resolve()));
    await sleep(1100); // let the clock pass the token's nbf second
    assert.equal((await alice.api('DELETE', `/v1/channels/${channelId}/members/${bob.userId}`)).status, 200);
    await kicked;
    assert.equal((await bob.api('POST', `/v1/channels/${channelId}/connection`)).status, 404);
    const retry = new Room();
    const tRetry = performance.now();
    const rejoin = await Promise.race([
      retry.connect(old.json.url, old.json.token, { autoSubscribe: false, dynacast: false }).then(
        () => 'connected',
        (e: Error) => `rejected: ${e.message}`,
      ),
      sleep(6000).then(() => 'timeout'),
    ]);
    if (rejoin === 'connected') {
      // revokeTokenTs unsupported → the webhook/reconcile path must still evict.
      const evicted = await waitFor<boolean>('eviction', 6000, (resolve) => on(retry, RoomEvent.Disconnected, () => resolve(true))).catch(() => false);
      results.kickedRejoin = evicted ? `connected, then evicted by webhook after ${(performance.now() - tRetry).toFixed(0)} ms` : 'STAYED CONNECTED';
      assert.ok(evicted, 'kicked member stayed in the room with an old token');
    } else {
      results.kickedRejoin = rejoin;
    }
    await retry.disconnect().catch(() => {});
  });
});
