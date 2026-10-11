/**
 * Milestone 3 server side: APNs PushToTalk client against a local HTTP/2
 * server, and the push fan-out / leave flows through the HTTP API.
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { exportPKCS8, exportSPKI, generateKeyPair, importSPKI, jwtVerify, decodeProtectedHeader } from 'jose';
import type { FastifyInstance } from 'fastify';
import { ApnsClient, type PushOutcome, type PushSender } from '../src/apns.js';
import { buildApp } from '../src/app.js';
import { DevVerifier } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { roomNameFor } from '../src/livekit.js';
import { MemoryStore } from '../src/store/memory.js';
import type { ApnsEnvironment } from '../src/store/types.js';
import { DEV_SECRET, FakeMedia, testConfig } from './helpers.js';

const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);

describe('ApnsClient (local HTTP/2 APNs stand-in)', () => {
  let server: http2.Http2Server;
  let origin: string;
  let publicPem: string;
  let privatePem: string;
  const seen: Array<{ headers: http2.IncomingHttpHeaders; body: string }> = [];
  let respond: (path: string) => { status: number; body?: object } = () => ({ status: 200 });

  before(async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
    publicPem = await exportSPKI(publicKey);
    privatePem = await exportPKCS8(privateKey);
    server = http2.createServer();
    server.on('stream', (stream, headers) => {
      let body = '';
      stream.setEncoding('utf8');
      stream.on('data', (c: string) => (body += c));
      stream.on('end', () => {
        seen.push({ headers, body });
        const r = respond(String(headers[':path']));
        stream.respond({ ':status': r.status, 'apns-id': 'test-id' });
        stream.end(r.body ? JSON.stringify(r.body) : '');
      });
    });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((res) => server.close(() => res())));
  beforeEach(() => {
    seen.length = 0;
    respond = () => ({ status: 200 });
  });

  const client = () =>
    new ApnsClient({ keyPem: privatePem, keyId: 'KEY1234567', teamId: 'TEAM123456', bundleId: 'com.protoforge.walkie', sandboxOrigin: origin, productionOrigin: origin });

  test('sends a PushToTalk push with the headers Apple specifies and a valid ES256 provider token', async () => {
    const c = client();
    const r = await c.sendPushToTalk(TOKEN_A, 'sandbox', { activeSpeaker: 'Alice' });
    await c.close();
    assert.deepEqual(r, { ok: true, status: 200, apnsId: 'test-id' });
    const { headers, body } = seen[0]!;
    assert.equal(headers[':method'], 'POST');
    assert.equal(headers[':path'], `/3/device/${TOKEN_A}`);
    assert.equal(headers['apns-push-type'], 'pushtotalk');
    assert.equal(headers['apns-topic'], 'com.protoforge.walkie.voip-ptt');
    assert.equal(headers['apns-priority'], '10');
    assert.equal(headers['apns-expiration'], '0');
    assert.deepEqual(JSON.parse(body), { activeSpeaker: 'Alice' });
    const jwt = String(headers.authorization).replace(/^bearer /, '');
    assert.deepEqual(decodeProtectedHeader(jwt), { alg: 'ES256', kid: 'KEY1234567' });
    const { payload } = await jwtVerify(jwt, await importSPKI(publicPem, 'ES256'), { issuer: 'TEAM123456' });
    assert.equal(typeof payload.iat, 'number');
  });

  test('reuses one provider token (APNs throttles token refreshes)', async () => {
    const c = client();
    await c.sendPushToTalk(TOKEN_A, 'sandbox', {});
    await c.sendPushToTalk(TOKEN_B, 'production', {});
    await c.close();
    assert.equal(seen.length, 2);
    assert.equal(seen[0]!.headers.authorization, seen[1]!.headers.authorization);
  });

  test('classifies APNs failures: dead tokens are flagged, other errors are not', async () => {
    const cases: Array<[number, string, boolean]> = [
      [410, 'Unregistered', true],
      [400, 'BadDeviceToken', true],
      [400, 'DeviceTokenNotForTopic', true],
      [400, 'BadPriority', false],
      [403, 'InvalidProviderToken', false],
      [429, 'TooManyRequests', false],
      [500, 'InternalServerError', false],
    ];
    const c = client();
    for (const [status, reason, unregistered] of cases) {
      respond = () => ({ status, body: { reason } });
      const r = await c.sendPushToTalk(TOKEN_A, 'sandbox', {});
      assert.deepEqual(r, { ok: false, status, reason, unregistered }, `${status} ${reason}`);
    }
    await c.close();
  });

  test('an unreachable APNs host yields a failure, not an exception', async () => {
    const c = new ApnsClient({ keyPem: privatePem, keyId: 'K', teamId: 'T', bundleId: 'b', sandboxOrigin: 'http://127.0.0.1:1' });
    const r = await c.sendPushToTalk(TOKEN_A, 'sandbox', {});
    await c.close();
    assert.equal(r.ok, false);
  });
});

class RecordingPush implements PushSender {
  sent: Array<{ token: string; environment: ApnsEnvironment; payload: Record<string, unknown> }> = [];
  outcome: (token: string) => PushOutcome = () => ({ ok: true, status: 200 });
  async sendPushToTalk(token: string, environment: ApnsEnvironment, payload: Record<string, unknown>) {
    this.sent.push({ token, environment, payload });
    return this.outcome(token);
  }
  async close() {}
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('PushToTalk through the API', () => {
  let app: FastifyInstance;
  let media: FakeMedia;
  let store: MemoryStore;
  let push: RecordingPush;
  const dev = new DevVerifier(DEV_SECRET);

  beforeEach(async () => {
    media = new FakeMedia();
    store = new MemoryStore();
    push = new RecordingPush();
    ({ app } = await buildApp({ config: testConfig(), store, media, verifier: dev, push, deleteAuthUser: async () => true }));
  });

  const session = async (handle: string) => {
    const { token, userId } = (await app.inject({ method: 'POST', url: '/v1/dev/session', payload: { handle } })).json();
    const call = (method: string, url: string, payload?: unknown) =>
      app.inject({ method: method as 'GET', url, payload: payload as object, headers: { authorization: `Bearer ${token}` } });
    await call('PUT', '/v1/me', { displayName: handle });
    return { userId: userId as string, call };
  };

  const channel = async () => {
    const owner = await session('alice');
    const member = await session('bob');
    const ch = (await owner.call('POST', '/v1/channels', { name: 'Crew' })).json();
    const inv = (await owner.call('POST', `/v1/channels/${ch.id}/invites`)).json();
    await member.call('POST', '/v1/invites/redeem', { code: inv.code });
    media.connect(roomNameFor(ch.id), owner.userId);
    media.connect(roomNameFor(ch.id), member.userId);
    return { owner, member, ch };
  };

  test('only members can register a token; tokens must be hex', async () => {
    const { owner, ch } = await channel();
    const mallory = await session('mallory');
    assert.equal((await mallory.call('PUT', `/v1/channels/${ch.id}/ptt-token`, { token: TOKEN_A, environment: 'sandbox' })).statusCode, 404);
    assert.equal((await owner.call('PUT', `/v1/channels/${ch.id}/ptt-token`, { token: 'not-hex!', environment: 'sandbox' })).statusCode, 400);
    assert.equal((await owner.call('PUT', `/v1/channels/${ch.id}/ptt-token`, { token: TOKEN_A, environment: 'prod' })).statusCode, 400);
    const ok = await owner.call('PUT', `/v1/channels/${ch.id}/ptt-token`, { token: TOKEN_A.toUpperCase(), environment: 'sandbox' });
    assert.deepEqual(ok.json(), { stored: true, pushEnabled: true });
    assert.deepEqual(await store.listPttTokens(ch.id), [{ userId: owner.userId, token: TOKEN_A, environment: 'sandbox' }]);
  });

  test('a new turn wakes every other PTT member, not the speaker', async () => {
    const { owner, member, ch } = await channel();
    await owner.call('PUT', `/v1/channels/${ch.id}/ptt-token`, { token: TOKEN_A, environment: 'sandbox' });
    await member.call('PUT', `/v1/channels/${ch.id}/ptt-token`, { token: TOKEN_B, environment: 'production' });
    const g = (await member.call('POST', `/v1/channels/${ch.id}/talk`)).json();
    await settle();
    assert.equal(push.sent.length, 1);
    assert.equal(push.sent[0]!.token, TOKEN_A);
    assert.equal(push.sent[0]!.environment, 'sandbox');
    assert.deepEqual(push.sent[0]!.payload, { activeSpeaker: 'bob', speakerUserId: member.userId, channelId: ch.id, leaseId: g.leaseId });
  });

  test('a repeated request for the same turn does not push again', async () => {
    const { owner, member, ch } = await channel();
    await owner.call('PUT', `/v1/channels/${ch.id}/ptt-token`, { token: TOKEN_A, environment: 'sandbox' });
    await member.call('POST', `/v1/channels/${ch.id}/talk`);
    await new Promise((r) => setTimeout(r, 300)); // past the rate limiter's min interval
    assert.equal((await member.call('POST', `/v1/channels/${ch.id}/talk`)).statusCode, 200);
    await settle();
    assert.equal(push.sent.length, 1);
  });

  test('tokens APNs reports as dead are deleted', async () => {
    const { owner, member, ch } = await channel();
    await owner.call('PUT', `/v1/channels/${ch.id}/ptt-token`, { token: TOKEN_A, environment: 'sandbox' });
    push.outcome = () => ({ ok: false, status: 410, reason: 'Unregistered', unregistered: true });
    await member.call('POST', `/v1/channels/${ch.id}/talk`);
    await settle();
    assert.deepEqual(await store.listPttTokens(ch.id), []);
  });

  test('a push failure never affects the grant', async () => {
    const { owner, member, ch } = await channel();
    await owner.call('PUT', `/v1/channels/${ch.id}/ptt-token`, { token: TOKEN_A, environment: 'sandbox' });
    push.sendPushToTalk = async () => {
      throw new Error('apns down');
    };
    const r = await member.call('POST', `/v1/channels/${ch.id}/talk`);
    await settle();
    assert.equal(r.statusCode, 200);
    assert.deepEqual(media.publishers(roomNameFor(ch.id)), [member.userId]);
  });

  test('removing or blocking a member sends their device a leave push and forgets the token', async () => {
    for (const action of ['remove', 'block'] as const) {
      push.sent.length = 0;
      const { owner, member, ch } = await channel();
      await owner.call('PUT', `/v1/channels/${ch.id}/ptt-token`, { token: TOKEN_A, environment: 'sandbox' });
      await member.call('PUT', `/v1/channels/${ch.id}/ptt-token`, { token: TOKEN_B, environment: 'sandbox' });
      if (action === 'remove') await owner.call('DELETE', `/v1/channels/${ch.id}/members/${member.userId}`);
      else await owner.call('POST', `/v1/channels/${ch.id}/blocks`, { userId: member.userId });
      await settle();
      assert.deepEqual(push.sent.map((p) => [p.token, p.payload]), [[TOKEN_B, { leave: true, channelId: ch.id }]], action);
      assert.deepEqual((await store.listPttTokens(ch.id)).map((t) => t.token), [TOKEN_A], action);
    }
  });

  test('deleting a channel sends every PTT member a leave push', async () => {
    const { owner, member, ch } = await channel();
    await owner.call('PUT', `/v1/channels/${ch.id}/ptt-token`, { token: TOKEN_A, environment: 'sandbox' });
    await member.call('PUT', `/v1/channels/${ch.id}/ptt-token`, { token: TOKEN_B, environment: 'sandbox' });
    await owner.call('DELETE', `/v1/channels/${ch.id}`);
    await settle();
    assert.deepEqual(push.sent.map((p) => p.token).sort(), [TOKEN_A, TOKEN_B]);
    assert.ok(push.sent.every((p) => p.payload.leave === true));
  });

  test('account deletion: leave pushes for the user in joined channels and for everyone in owned channels', async () => {
    const { owner, member, ch } = await channel();
    await owner.call('PUT', `/v1/channels/${ch.id}/ptt-token`, { token: TOKEN_A, environment: 'sandbox' });
    await member.call('PUT', `/v1/channels/${ch.id}/ptt-token`, { token: TOKEN_B, environment: 'sandbox' });
    await member.call('DELETE', '/v1/me');
    await settle();
    assert.deepEqual(push.sent.map((p) => p.token), [TOKEN_B]);
    push.sent.length = 0;
    await owner.call('DELETE', '/v1/me');
    await settle();
    assert.deepEqual(push.sent.map((p) => p.token), [TOKEN_A]);
  });

  test('a device can always delete its own token', async () => {
    const { member, ch } = await channel();
    await member.call('PUT', `/v1/channels/${ch.id}/ptt-token`, { token: TOKEN_B, environment: 'sandbox' });
    assert.equal((await member.call('DELETE', `/v1/channels/${ch.id}/ptt-token`)).statusCode, 200);
    assert.deepEqual(await store.listPttTokens(ch.id), []);
  });

  test('without APNs configured, tokens are stored but nothing is pushed', async () => {
    const plain = await buildApp({ config: testConfig(), store: new MemoryStore(), media: new FakeMedia(), verifier: dev });
    const { token } = (await plain.app.inject({ method: 'POST', url: '/v1/dev/session', payload: { handle: 'zed' } })).json();
    const h = { authorization: `Bearer ${token}` };
    await plain.app.inject({ method: 'PUT', url: '/v1/me', payload: { displayName: 'Zed' }, headers: h });
    const ch = (await plain.app.inject({ method: 'POST', url: '/v1/channels', payload: { name: 'x' }, headers: h })).json();
    const r = await plain.app.inject({ method: 'PUT', url: `/v1/channels/${ch.id}/ptt-token`, payload: { token: TOKEN_A, environment: 'sandbox' }, headers: h });
    assert.deepEqual(r.json(), { stored: true, pushEnabled: false });
  });
});

describe('APNs configuration', () => {
  const base = { LIVEKIT_URL: 'ws://localhost:7880', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 'x'.repeat(32), AUTH_MODE: 'dev', WALKIE_DEV_AUTH_SECRET: 'y'.repeat(32) };
  test('all four settings or none', () => {
    assert.equal(loadConfig(base).apns, undefined);
    assert.throws(() => loadConfig({ ...base, APNS_KEY_ID: 'K' }), /APNs needs all of/);
    const c = loadConfig({ ...base, APNS_KEY_P8: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----', APNS_KEY_ID: 'K', APNS_TEAM_ID: 'T', APNS_BUNDLE_ID: 'com.x' });
    assert.equal(c.apns?.keyPem, '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----');
    assert.equal(c.apns?.bundleId, 'com.x');
  });
});
