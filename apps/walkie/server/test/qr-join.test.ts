import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { DevVerifier, SessionIssuer, createVerifier } from '../src/auth.js';
import { loadConfig, type Config } from '../src/config.js';
import { roomNameFor } from '../src/livekit.js';
import { MemoryStore } from '../src/store/memory.js';
import { DEV_SECRET, FakeMedia, SESSION_SECRET, testConfig } from './helpers.js';

const sessionsConfig = (over: Partial<Config> = {}) =>
  testConfig({ sessions: { secret: SESSION_SECRET, guestTtlS: 30 * 86_400, ownerTtlS: 90 * 86_400 }, ...over });

describe('QR join, guests and owner sign-in', () => {
  let app: FastifyInstance;
  let media: FakeMedia;
  let store: MemoryStore;
  let issuer: SessionIssuer;
  const deletedAuthUsers: string[] = [];

  const boot = async (config: Config = sessionsConfig()) => {
    media = new FakeMedia();
    store = new MemoryStore();
    issuer = new SessionIssuer(SESSION_SECRET);
    const sessions = config.sessions ? issuer : undefined;
    ({ app } = await buildApp({
      config,
      store,
      media,
      verifier: createVerifier(config, sessions),
      sessions,
      deleteAuthUser: async (id) => {
        deletedAuthUsers.push(id);
        return true;
      },
    }));
  };
  beforeEach(() => boot());

  const as = (token: string | null) => (method: string, url: string, payload?: unknown) =>
    app.inject({ method: method as 'GET', url, payload: payload as object, headers: token ? { authorization: `Bearer ${token}` } : {} });

  /** An owner signed in through the one-time ticket flow, with one channel and an invite. */
  const ownerWithInvite = async () => {
    const { token: ticket } = await issuer.issueLoginTicket('Frank');
    const ex = await as(null)('POST', '/v1/session/exchange', { ticket });
    assert.equal(ex.statusCode, 200, ex.body);
    const owner = { ...ex.json(), call: as(ex.json().session.token) };
    const ch = (await owner.call('POST', '/v1/channels', { name: 'Garage' })).json();
    const inv = (await owner.call('POST', `/v1/channels/${ch.id}/invites`)).json();
    return { owner, ch, inv };
  };

  test('the owner signs in with a one-time ticket, no email', async () => {
    const { owner, ch } = await ownerWithInvite();
    assert.equal(owner.displayName, 'Frank');
    assert.equal(owner.userId, issuer.ownerIdFor('frank'), 'stable account per name');
    const me = (await owner.call('GET', '/v1/me')).json();
    assert.deepEqual(me, { userId: owner.userId, displayName: 'Frank', guest: false });
    assert.equal(ch.role, 'owner');
  });

  test('a login ticket works once and is not a session', async () => {
    const { token: ticket } = await issuer.issueLoginTicket('Frank');
    assert.equal((await as(null)('POST', '/v1/session/exchange', { ticket })).statusCode, 200);
    const again = await as(null)('POST', '/v1/session/exchange', { ticket });
    assert.equal(again.statusCode, 401);
    assert.equal(again.json().error, 'invalid_ticket');
    assert.equal((await as(ticket)('GET', '/v1/me')).statusCode, 401, 'a ticket is not a bearer token');
    const guestish = await issuer.issueSession('6f1c2b8e-1d2c-4e5f-8a9b-0c1d2e3f4a5b', 'owner', 60);
    assert.equal((await as(null)('POST', '/v1/session/exchange', { ticket: guestish.token })).statusCode, 401, 'a session is not a ticket');
    const forged = await new SessionIssuer('another-secret-0123456789abcdef0123456789').issueLoginTicket('Frank');
    assert.equal((await as(null)('POST', '/v1/session/exchange', { ticket: forged.token })).statusCode, 401);
  });

  test('invite preview shows the channel without using the invite', async () => {
    const { inv } = await ownerWithInvite();
    for (let i = 0; i < 2; i++) {
      const p = await as(null)('GET', `/v1/invites/${inv.code}/preview`);
      assert.equal(p.statusCode, 200);
      assert.equal(p.json().channelName, 'Garage');
      assert.equal(p.json().ownerName, 'Frank');
      assert.equal(p.json().guestJoin, true);
    }
    assert.equal((await as(null)('GET', '/v1/invites/AAAAA-BBBBB-CCCCC-DDDDD/preview')).statusCode, 404);
    assert.equal((await as(null)('GET', '/v1/invites/not-a-code/preview')).statusCode, 404);
  });

  test('scanning joins as a guest who can listen and talk in that channel', async () => {
    const { owner, ch, inv } = await ownerWithInvite();
    const res = await as(null)('POST', '/v1/join', { code: inv.code, displayName: '  Sam  ' });
    assert.equal(res.statusCode, 201, res.body);
    const { userId, channel, session } = res.json();
    assert.equal(channel.id, ch.id);
    assert.equal(channel.role, 'member');
    assert.ok(session.token && session.expiresAt > Date.now());
    const guest = as(session.token);

    assert.deepEqual((await guest('GET', '/v1/me')).json(), { userId, displayName: 'Sam', guest: true });
    assert.deepEqual((await guest('GET', '/v1/channels')).json().channels.map((c: { id: string }) => c.id), [ch.id]);
    const conn = (await guest('POST', `/v1/channels/${ch.id}/connection`)).json();
    assert.equal(conn.identity, userId);

    // Both connected: the guest can take the floor; the owner then sees busy.
    media.connect(roomNameFor(ch.id), userId);
    media.connect(roomNameFor(ch.id), owner.userId);
    const talk = await guest('POST', `/v1/channels/${ch.id}/talk`);
    assert.equal(talk.statusCode, 200, talk.body);
    assert.equal((await owner.call('POST', `/v1/channels/${ch.id}/talk`)).statusCode, 409);
    const members = (await owner.call('GET', `/v1/channels/${ch.id}`)).json().members;
    assert.ok(members.some((m: { userId: string; displayName: string }) => m.userId === userId && m.displayName === 'Sam'));
  });

  test('guests cannot create channels or invites, or see other channels', async () => {
    const { owner, inv } = await ownerWithInvite();
    const other = (await owner.call('POST', '/v1/channels', { name: 'Private' })).json();
    const { session, channel } = (await as(null)('POST', '/v1/join', { code: inv.code, displayName: 'Sam' })).json();
    const guest = as(session.token);
    const create = await guest('POST', '/v1/channels', { name: 'Mine' });
    assert.equal(create.statusCode, 403);
    assert.equal(create.json().error, 'guest_not_allowed');
    assert.equal((await guest('POST', `/v1/channels/${channel.id}/invites`)).statusCode, 403);
    assert.equal((await guest('GET', `/v1/channels/${other.id}`)).statusCode, 404);
    assert.equal((await guest('POST', `/v1/channels/${other.id}/connection`)).statusCode, 404);
  });

  test('a used invite cannot be scanned again, and leaves no stray guest behind', async () => {
    const { inv } = await ownerWithInvite();
    assert.equal((await as(null)('POST', '/v1/join', { code: inv.code, displayName: 'Sam' })).statusCode, 201);
    const profilesBefore = (store as unknown as { profiles: Map<string, unknown> }).profiles.size;
    const second = await as(null)('POST', '/v1/join', { code: inv.code, displayName: 'Mallory' });
    assert.equal(second.statusCode, 404);
    assert.equal(second.json().error, 'invite_invalid');
    assert.equal((store as unknown as { profiles: Map<string, unknown> }).profiles.size, profilesBefore);
    assert.equal((await as(null)('GET', `/v1/invites/${inv.code}/preview`)).statusCode, 404);
  });

  test('a returning guest who scans another invite keeps one identity', async () => {
    const { owner, inv } = await ownerWithInvite();
    const first = (await as(null)('POST', '/v1/join', { code: inv.code, displayName: 'Sam' })).json();
    const ch2 = (await owner.call('POST', '/v1/channels', { name: 'Yard' })).json();
    const inv2 = (await owner.call('POST', `/v1/channels/${ch2.id}/invites`)).json();
    const second = await as(first.session.token)('POST', '/v1/join', { code: inv2.code, displayName: 'ignored' });
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().userId, first.userId);
    assert.equal(second.json().session, null);
    assert.equal((await as(first.session.token)('GET', '/v1/channels')).json().channels.length, 2);
  });

  test('an expired or foreign bearer on /v1/join is ignored, not an error', async () => {
    const { inv } = await ownerWithInvite();
    const res = await as('not-a-jwt')('POST', '/v1/join', { code: inv.code, displayName: 'Sam' });
    assert.equal(res.statusCode, 201);
    assert.ok(res.json().session);
  });

  test('a removed guest loses the channel even though the session is still valid', async () => {
    const { owner, ch, inv } = await ownerWithInvite();
    const { userId, session } = (await as(null)('POST', '/v1/join', { code: inv.code, displayName: 'Sam' })).json();
    assert.equal((await owner.call('DELETE', `/v1/channels/${ch.id}/members/${userId}`)).statusCode, 200);
    assert.equal((await as(session.token)('POST', `/v1/channels/${ch.id}/connection`)).statusCode, 404);
  });

  test('guest account deletion does not touch Supabase', async () => {
    const { inv } = await ownerWithInvite();
    const { session } = (await as(null)('POST', '/v1/join', { code: inv.code, displayName: 'Sam' })).json();
    deletedAuthUsers.length = 0;
    const del = await as(session.token)('DELETE', '/v1/me');
    assert.equal(del.statusCode, 200);
    assert.equal(del.json().authUserDeleted, true);
    assert.deepEqual(deletedAuthUsers, []);
  });

  test('invites link to the public join page when PUBLIC_BASE_URL is set', async () => {
    let { inv } = await ownerWithInvite();
    assert.equal(inv.joinUrl, null);
    assert.equal(inv.qrUrl, `protoforgewalkie://join/${inv.code}`);
    await boot(sessionsConfig({ publicBaseUrl: 'https://heidi-pc.example.ts.net' }));
    ({ inv } = await ownerWithInvite());
    assert.equal(inv.joinUrl, `https://heidi-pc.example.ts.net/j/${inv.code}`);
    assert.equal(inv.qrUrl, inv.joinUrl);
    assert.equal(inv.appUrl, `protoforgewalkie://join/${inv.code}`);
  });

  test('with sessions disabled, nobody becomes a guest', async () => {
    await boot(testConfig());
    const dev = new DevVerifier(DEV_SECRET);
    const owner = await dev.issue('alice');
    const call = as(owner.token);
    await call('PUT', '/v1/me', { displayName: 'Alice' });
    const ch = (await call('POST', '/v1/channels', { name: 'Ops' })).json();
    const inv = (await call('POST', `/v1/channels/${ch.id}/invites`)).json();
    assert.equal((await as(null)('GET', `/v1/invites/${inv.code}/preview`)).json().guestJoin, false);
    const res = await as(null)('POST', '/v1/join', { code: inv.code, displayName: 'Sam' });
    assert.equal(res.statusCode, 401);
    assert.equal((await as(null)('POST', '/v1/session/exchange', { ticket: 'x'.repeat(40) })).statusCode, 404);
    // A signed-in user can still join through the same route (the app's deep link).
    const bob = await dev.issue('bob');
    const joined = await as(bob.token)('POST', '/v1/join', { code: inv.code, displayName: 'Bob' });
    assert.equal(joined.statusCode, 200, joined.body);
    assert.equal(joined.json().channel.id, ch.id);
    // Guest-shaped tokens are refused when no issuer is configured.
    const g = await issuer.issueSession(bob.userId, 'guest', 60);
    assert.equal((await as(g.token)('GET', '/v1/me')).statusCode, 401);
  });

  test('public routes are rate limited per IP', async () => {
    await boot(sessionsConfig({ publicRatePerMin: 3 }));
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await as(null)('GET', '/v1/invites/AAAAA-BBBBB-CCCCC-DDDDD/preview')).statusCode);
    assert.deepEqual(codes, [404, 404, 404, 429]);
    const limited = await as(null)('POST', '/v1/session/exchange', { ticket: 'x'.repeat(40) });
    assert.equal((await as(null)('POST', '/v1/session/exchange', { ticket: 'x'.repeat(40) })).statusCode, 401, 'separate budget per route');
    assert.equal(limited.statusCode, 401);
    for (let i = 0; i < 2; i++) await as(null)('POST', '/v1/session/exchange', { ticket: 'x'.repeat(40) });
    const res = await as(null)('POST', '/v1/session/exchange', { ticket: 'x'.repeat(40) });
    assert.equal(res.statusCode, 429);
    assert.equal(res.json().error, 'rate_limited');
    assert.ok(res.json().retryAfterMs > 0);
    assert.ok(res.headers['retry-after']);
  });

  test('every other route has a per-IP ceiling too, except signed LiveKit webhooks', async () => {
    await boot(sessionsConfig({ apiRatePerMin: 5 }));
    // Owner setup spends 2 of the shared budget (create channel, create invite);
    // the ticket exchange has its own public budget.
    const { session } = (await ownerWithInvite()).owner;
    const me = as(session.token);
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await me('GET', '/v1/me')).statusCode);
    assert.deepEqual(codes, [200, 200, 200, 429], 'one budget per IP across ordinary routes');
    const del = await me('DELETE', '/v1/me');
    assert.equal(del.statusCode, 429, 'account deletion is covered by the same ceiling');
    assert.equal(del.json().error, 'rate_limited');
    for (let i = 0; i < 7; i++) {
      const wh = await app.inject({ method: 'POST', url: '/livekit/webhook', payload: '{}', headers: { 'content-type': 'application/webhook+json', authorization: 'x' } });
      assert.notEqual(wh.statusCode, 429);
    }
  });

  test('the join page is served with strict headers, and the script gzipped', async () => {
    const page = await app.inject({ method: 'GET', url: '/j/AAAAA-BBBBB-CCCCC-DDDDD' });
    assert.equal(page.statusCode, 200, 'run npm run build:web first');
    assert.match(page.headers['content-type'] as string, /text\/html/);
    assert.equal(page.headers['referrer-policy'], 'no-referrer');
    assert.match(page.headers['content-security-policy'] as string, /script-src 'self'/);
    assert.match(page.headers['content-security-policy'] as string, /frame-ancestors 'none'/);
    assert.match(page.headers['permissions-policy'] as string, /microphone=\(self\)/);
    assert.match(page.body, /<script src="\/web\/app.js">/);
    const js = await app.inject({ method: 'GET', url: '/web/app.js', headers: { 'accept-encoding': 'gzip, br' } });
    assert.equal(js.statusCode, 200);
    assert.equal(js.headers['content-encoding'], 'gzip');
    assert.ok(js.rawPayload.length < 300_000, `gzipped bundle ${js.rawPayload.length} bytes`);
    assert.equal((await app.inject({ method: 'GET', url: '/w' })).statusCode, 200);
  });
});

describe('session config', () => {
  const base = {
    LIVEKIT_URL: 'wss://lk.example.com',
    LIVEKIT_API_KEY: 'k',
    LIVEKIT_API_SECRET: 's'.repeat(32),
    SUPABASE_URL: 'https://x.supabase.co',
  };
  test('sessions are off unless WALKIE_SESSION_SECRET is set, and it must be long', () => {
    assert.equal(loadConfig(base).sessions, undefined);
    assert.throws(() => loadConfig({ ...base, WALKIE_SESSION_SECRET: 'short' }), /at least 32/);
    const c = loadConfig({ ...base, WALKIE_SESSION_SECRET: SESSION_SECRET, GUEST_SESSION_DAYS: '7' });
    assert.equal(c.sessions?.guestTtlS, 7 * 86_400);
  });
  test('PUBLIC_BASE_URL must be https in production', () => {
    const prod = { ...base, NODE_ENV: 'production', DATABASE_URL: 'postgres://x' };
    assert.throws(() => loadConfig({ ...prod, PUBLIC_BASE_URL: 'http://heidi-pc:8787' }), /https/);
    assert.equal(loadConfig({ ...prod, PUBLIC_BASE_URL: 'https://heidi-pc.example.ts.net/' }).publicBaseUrl, 'https://heidi-pc.example.ts.net');
  });
});
