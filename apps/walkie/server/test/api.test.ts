import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, createLocalJWKSet, decodeJwt, exportJWK, generateKeyPair } from 'jose';
import type { FastifyInstance } from 'fastify';
import { buildApp, hashInviteCode, newInviteCode } from '../src/app.js';
import { DevVerifier, SupabaseVerifier } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { LiveKitGateway, roomNameFor } from '../src/livekit.js';
import { MemoryStore } from '../src/store/memory.js';
import { DEV_SECRET, FakeMedia, testConfig } from './helpers.js';

describe('HTTP API', () => {
  let app: FastifyInstance;
  let media: FakeMedia;
  let store: MemoryStore;
  const dev = new DevVerifier(DEV_SECRET);
  const deletedAuthUsers: string[] = [];

  beforeEach(async () => {
    media = new FakeMedia();
    store = new MemoryStore();
    ({ app } = await buildApp({
      config: testConfig(),
      store,
      media,
      verifier: dev,
      deleteAuthUser: async (id) => {
        deletedAuthUsers.push(id);
        return true;
      },
    }));
  });

  const session = async (handle: string, displayName = handle) => {
    const res = await app.inject({ method: 'POST', url: '/v1/dev/session', payload: { handle } });
    assert.equal(res.statusCode, 200);
    const { token, userId } = res.json();
    const call = (method: string, url: string, payload?: unknown) =>
      app.inject({ method: method as 'GET', url, payload: payload as object, headers: { authorization: `Bearer ${token}` } });
    if (displayName) assert.equal((await call('PUT', '/v1/me', { displayName })).statusCode, 200);
    return { token, userId: userId as string, call };
  };

  /** Owner + member in one channel, both "connected" to its room. */
  const twoPhones = async () => {
    const owner = await session('alice');
    const member = await session('bob');
    const ch = (await owner.call('POST', '/v1/channels', { name: 'Site crew' })).json();
    const inv = (await owner.call('POST', `/v1/channels/${ch.id}/invites`)).json();
    assert.equal((await member.call('POST', '/v1/invites/redeem', { code: inv.code })).statusCode, 200);
    const room = roomNameFor(ch.id);
    media.connect(room, owner.userId);
    media.connect(room, member.userId);
    return { owner, member, ch, room };
  };

  test('every API route needs a valid bearer token', async () => {
    for (const [method, url] of [
      ['GET', '/v1/me'],
      ['GET', '/v1/channels'],
      ['POST', '/v1/channels/00000000-0000-4000-8000-000000000000/connection'],
      ['POST', '/v1/channels/00000000-0000-4000-8000-000000000000/talk'],
    ] as const) {
      assert.equal((await app.inject({ method, url })).statusCode, 401, `${method} ${url}`);
      assert.equal((await app.inject({ method, url, headers: { authorization: 'Bearer nope' } })).statusCode, 401);
    }
    const forged = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('walkie-dev')
      .setAudience('walkie')
      .setSubject('00000000-0000-4000-8000-000000000000')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-different-secret-a-different-secret!!'));
    assert.equal((await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${forged}` } })).statusCode, 401);
  });

  test('display name is required before creating or joining channels', async () => {
    const s = await session('nameless', '');
    assert.equal((await s.call('POST', '/v1/channels', { name: 'x' })).statusCode, 409);
    assert.equal((await s.call('PUT', '/v1/me', { displayName: '   ' })).statusCode, 400);
    assert.equal((await s.call('PUT', '/v1/me', { displayName: 'Nina\u0007' })).json().displayName, 'Nina');
  });

  test('create channel, invite, join, list members', async () => {
    const { owner, member, ch } = await twoPhones();
    const detail = (await member.call('GET', `/v1/channels/${ch.id}`)).json();
    assert.equal(detail.role, 'member');
    assert.deepEqual(detail.members.map((m: { displayName: string }) => m.displayName).sort(), ['alice', 'bob']);
    assert.equal((await owner.call('GET', '/v1/channels')).json().channels[0].role, 'owner');
  });

  test('invite codes are single-use by default and only stored hashed', async () => {
    const owner = await session('alice');
    const ch = (await owner.call('POST', '/v1/channels', { name: 'c' })).json();
    const inv = (await owner.call('POST', `/v1/channels/${ch.id}/invites`)).json();
    assert.match(inv.code, /^[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    const b = await session('bob');
    const c = await session('carol');
    // Codes are case- and dash-insensitive for typing on a phone.
    assert.equal((await b.call('POST', '/v1/invites/redeem', { code: inv.code.toLowerCase().replace(/-/g, '') })).statusCode, 200);
    assert.equal((await c.call('POST', '/v1/invites/redeem', { code: inv.code })).statusCode, 404);
    assert.equal(hashInviteCode(inv.code).length, 64);
    assert.notEqual(newInviteCode(), newInviteCode());
  });

  test('an unauthorized user cannot see, join or talk in a private channel', async () => {
    const { ch } = await twoPhones();
    const mallory = await session('mallory');
    media.connect(roomNameFor(ch.id), mallory.userId);
    for (const [m, u] of [
      ['GET', `/v1/channels/${ch.id}`],
      ['POST', `/v1/channels/${ch.id}/connection`],
      ['POST', `/v1/channels/${ch.id}/talk`],
      ['GET', `/v1/channels/${ch.id}/talk`],
      ['POST', `/v1/channels/${ch.id}/invites`],
    ] as const) {
      assert.equal((await mallory.call(m, u)).statusCode, 404, `${m} ${u}`);
    }
    assert.deepEqual(media.publishers(roomNameFor(ch.id)), []);
  });

  test('members get a subscribe-only connection token', async () => {
    const { member, ch } = await twoPhones();
    const res = await member.call('POST', `/v1/channels/${ch.id}/connection`);
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.room, roomNameFor(ch.id));
    assert.equal(body.identity, member.userId);
    assert.equal(body.url, 'ws://livekit.test');
  });

  test('simultaneous talk requests from two phones: exactly one speaker', async () => {
    const { owner, member, ch, room } = await twoPhones();
    const [a, b] = await Promise.all([owner.call('POST', `/v1/channels/${ch.id}/talk`), member.call('POST', `/v1/channels/${ch.id}/talk`)]);
    assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 409]);
    const loser = a.statusCode === 409 ? a : b;
    assert.equal(loser.json().error, 'busy');
    assert.equal(media.publishers(room).length, 1);
  });

  test('talk → renew → release', async () => {
    const { member, ch, room } = await twoPhones();
    const g = (await member.call('POST', `/v1/channels/${ch.id}/talk`)).json();
    assert.ok(g.leaseId && g.renewEveryMs > 0 && g.maxMs === 30_000);
    assert.equal((await member.call('POST', `/v1/channels/${ch.id}/talk/${g.leaseId}/renew`)).statusCode, 200);
    assert.equal((await member.call('GET', `/v1/channels/${ch.id}/talk`)).json().speaker.userId, member.userId);
    assert.equal((await member.call('DELETE', `/v1/channels/${ch.id}/talk/${g.leaseId}`)).json().released, true);
    assert.deepEqual(media.publishers(room), []);
    assert.equal((await member.call('POST', `/v1/channels/${ch.id}/talk/${g.leaseId}/renew`)).statusCode, 410);
    assert.equal((await member.call('DELETE', `/v1/channels/${ch.id}/talk/not-a-uuid`)).statusCode, 404);
  });

  test('rapid repeated presses return 429 with Retry-After', async () => {
    const { member, ch } = await twoPhones();
    const g = (await member.call('POST', `/v1/channels/${ch.id}/talk`)).json();
    await member.call('DELETE', `/v1/channels/${ch.id}/talk/${g.leaseId}`);
    const r = await member.call('POST', `/v1/channels/${ch.id}/talk`);
    assert.equal(r.statusCode, 429);
    assert.ok(r.headers['retry-after']);
  });

  test('owner removes the current speaker: kicked, floor freed, access gone', async () => {
    const { owner, member, ch, room } = await twoPhones();
    assert.equal((await member.call('POST', `/v1/channels/${ch.id}/talk`)).statusCode, 200);
    assert.equal((await member.call('DELETE', `/v1/channels/${ch.id}/members/${owner.userId}`)).statusCode, 403);
    assert.equal((await owner.call('DELETE', `/v1/channels/${ch.id}/members/${member.userId}`)).statusCode, 200);
    assert.ok(media.removed.some((r) => r.identity === member.userId && r.room === room));
    assert.equal((await owner.call('GET', `/v1/channels/${ch.id}/talk`)).json().speaker, null);
    assert.equal((await member.call('POST', `/v1/channels/${ch.id}/connection`)).statusCode, 404);
  });

  test('blocked users cannot rejoin with a fresh invite; unblock restores eligibility', async () => {
    const { owner, member, ch } = await twoPhones();
    assert.equal((await owner.call('POST', `/v1/channels/${ch.id}/blocks`, { userId: member.userId })).statusCode, 200);
    assert.equal((await owner.call('POST', `/v1/channels/${ch.id}/blocks`, { userId: owner.userId })).statusCode, 409);
    const inv = (await owner.call('POST', `/v1/channels/${ch.id}/invites`)).json();
    assert.equal((await member.call('POST', '/v1/invites/redeem', { code: inv.code })).statusCode, 404);
    assert.equal((await owner.call('GET', `/v1/channels/${ch.id}/blocks`)).json().blocks.length, 1);
    await owner.call('DELETE', `/v1/channels/${ch.id}/blocks/${member.userId}`);
    assert.equal((await member.call('POST', '/v1/invites/redeem', { code: inv.code })).statusCode, 200);
  });

  test('members can leave; owners cannot leave (they delete the channel instead)', async () => {
    const { owner, member, ch } = await twoPhones();
    assert.equal((await owner.call('POST', `/v1/channels/${ch.id}/leave`)).statusCode, 409);
    assert.equal((await member.call('POST', `/v1/channels/${ch.id}/leave`)).statusCode, 200);
    assert.equal((await member.call('GET', `/v1/channels/${ch.id}`)).statusCode, 404);
    assert.equal((await owner.call('DELETE', `/v1/channels/${ch.id}`)).statusCode, 200);
    assert.equal((await owner.call('GET', '/v1/channels')).json().channels.length, 0);
  });

  test('account deletion removes data, empties owned rooms and deletes the auth user', async () => {
    const { owner, member, ch, room } = await twoPhones();
    const res = await owner.call('DELETE', '/v1/me');
    assert.deepEqual(res.json(), { deleted: true, authUserDeleted: true });
    assert.ok(deletedAuthUsers.includes(owner.userId));
    assert.equal((await member.call('GET', `/v1/channels/${ch.id}`)).statusCode, 404);
    assert.equal(media.rooms.get(room)?.size, 0);
    assert.equal((await owner.call('GET', '/v1/me')).json().displayName, null);
  });

  test('webhooks must be signed', async () => {
    const r = await app.inject({ method: 'POST', url: '/livekit/webhook', headers: { 'content-type': 'application/webhook+json', authorization: 'forged' }, payload: '{}' });
    assert.equal(r.statusCode, 401);
    const ok = await app.inject({
      method: 'POST',
      url: '/livekit/webhook',
      headers: { 'content-type': 'application/webhook+json', authorization: 'valid' },
      payload: JSON.stringify({ event: 'room_started' }),
    });
    assert.equal(ok.statusCode, 200);
  });
});

describe('LiveKit join token', () => {
  test('grants subscribe only: no publish, no data, no self-metadata', async () => {
    const gw = new LiveKitGateway(testConfig().livekit);
    const jwt = await gw.createJoinToken({ room: 'walkie-x', identity: 'u1', name: 'Una', ttlS: 300 });
    const claims = decodeJwt(jwt) as { video: Record<string, unknown>; exp: number; nbf: number; sub: string };
    assert.equal(claims.sub, 'u1');
    assert.equal(claims.video.room, 'walkie-x');
    assert.equal(claims.video.roomJoin, true);
    assert.equal(claims.video.canPublish, false);
    assert.equal(claims.video.canPublishData, false);
    assert.equal(claims.video.canUpdateOwnMetadata, false);
    assert.equal(claims.video.roomAdmin, undefined);
    assert.ok(claims.exp - claims.nbf <= 300);
  });
});

describe('Supabase token verification', () => {
  const SUPA = 'http://127.0.0.1:54321';
  const secret = 'super-secret-jwt-token-with-at-least-32-characters-long';
  const sub = '6f1c2d3e-4b5a-4c6d-8e7f-001122334455';
  const sign = (claims: Record<string, unknown>, opts: { iss?: string; aud?: string; key?: string } = {}) =>
    new SignJWT({ role: 'authenticated', email: 'a@example.com', ...claims })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(opts.iss ?? `${SUPA}/auth/v1`)
      .setAudience(opts.aud ?? 'authenticated')
      .setSubject(sub)
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(opts.key ?? secret));

  test('accepts a valid HS256 access token', async () => {
    const v = new SupabaseVerifier({ supabaseUrl: SUPA, jwtSecret: secret });
    assert.deepEqual(await v.verify(await sign({})), { userId: sub, email: 'a@example.com' });
  });

  test('rejects wrong issuer, audience, key, anonymous and non-authenticated roles', async () => {
    const v = new SupabaseVerifier({ supabaseUrl: SUPA, jwtSecret: secret });
    for (const t of [
      await sign({}, { iss: 'https://evil.example/auth/v1' }),
      await sign({}, { aud: 'anon' }),
      await sign({}, { key: 'another-secret-another-secret-another-secret' }),
      await sign({ is_anonymous: true }),
      await sign({ role: 'service_role' }),
    ]) {
      await assert.rejects(v.verify(t));
    }
  });

  test('accepts ES256 tokens from the project JWKS (asymmetric signing keys)', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' };
    const v = new SupabaseVerifier({ supabaseUrl: SUPA, jwks: createLocalJWKSet({ keys: [jwk] }) });
    const t = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setIssuer(`${SUPA}/auth/v1`)
      .setAudience('authenticated')
      .setSubject(sub)
      .setExpirationTime('1h')
      .sign(privateKey);
    assert.equal((await v.verify(t)).userId, sub);
  });
});

describe('config', () => {
  const base = { LIVEKIT_URL: 'ws://localhost:7880', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 'x'.repeat(32) };
  test('refuses dev auth, in-memory storage and plain ws:// in production', () => {
    assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', AUTH_MODE: 'dev', WALKIE_DEV_AUTH_SECRET: 'y'.repeat(32), DATABASE_URL: 'postgres://x' }), /AUTH_MODE=dev/);
    assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', SUPABASE_URL: 'https://p.supabase.co' }), /DATABASE_URL/);
    assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production', SUPABASE_URL: 'https://p.supabase.co', DATABASE_URL: 'postgres://x' }), /wss:\/\//);
  });
  test('max speaking duration is configurable', () => {
    const c = loadConfig({ ...base, AUTH_MODE: 'dev', WALKIE_DEV_AUTH_SECRET: 'y'.repeat(32), TALK_MAX_MS: '15000' });
    assert.equal(c.talk.maxMs, 15000);
    assert.equal(c.livekit.apiUrl, 'http://localhost:7880');
  });
});
