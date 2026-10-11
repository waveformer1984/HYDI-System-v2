import { createHash, randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthError, DevVerifier, deleteSupabaseUser, type AuthUser, type AuthVerifier } from './auth.js';
import type { Config } from './config.js';
import { FloorService, errMsg } from './floor.js';
import { roomNameFor, type MediaGateway } from './livekit.js';
import type { Store } from './store/types.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export interface AppDeps {
  config: Config;
  store: Store;
  media: MediaGateway;
  verifier: AuthVerifier;
  now?: () => number;
  /** Override for tests. */
  deleteAuthUser?: (userId: string) => Promise<boolean>;
}

const Uuid = z.string().uuid();
// Printable text without control characters.
const cleanText = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001f\u007f]/g, '').trim())
    .pipe(z.string().min(1).max(max));

const ProfileBody = z.object({ displayName: cleanText(40) });
const ChannelBody = z.object({ name: cleanText(60) });
const RedeemBody = z.object({ code: z.string().min(8).max(64) });
const BlockBody = z.object({ userId: Uuid });
const InviteBody = z.object({ maxUses: z.number().int().min(1).max(50).optional() }).optional();
const DevSessionBody = z.object({ handle: z.string().regex(/^[a-z0-9_-]{2,32}$/i) });

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no 0/O, 1/I/L, U
export function newInviteCode(): string {
  const bytes = randomBytes(20);
  let out = '';
  for (let i = 0; i < 20; i++) out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return `${out.slice(0, 5)}-${out.slice(5, 10)}-${out.slice(10, 15)}-${out.slice(15, 20)}`;
}
export const hashInviteCode = (code: string) =>
  createHash('sha256').update(code.toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export async function buildApp(deps: AppDeps): Promise<{ app: FastifyInstance; floor: FloorService }> {
  const { config, store, media, verifier } = deps;
  const now = deps.now ?? Date.now;

  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: { paths: ['req.headers.authorization', 'req.headers.cookie'], remove: true },
    },
    bodyLimit: 16 * 1024,
    trustProxy: true,
  });
  const floor = new FloorService(store, media, config, app.log, now);
  const deleteAuthUser =
    deps.deleteAuthUser ?? ((userId: string) => deleteSupabaseUser(config.auth.supabaseUrl, config.auth.serviceRoleKey, userId));

  // LiveKit webhooks are signed over the raw body.
  app.addContentTypeParser('application/webhook+json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, ...err.extra });
    if (err instanceof z.ZodError) return reply.status(400).send({ error: 'invalid_request', issues: err.issues.map((i) => i.path.join('.') + ': ' + i.message) });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.status(status).send({ error: 'bad_request' });
    req.log.error({ err: errMsg(err) }, 'unhandled error');
    return reply.status(500).send({ error: 'internal' });
  });

  const authenticate = async (req: FastifyRequest) => {
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) throw new HttpError(401, 'unauthenticated');
    try {
      req.user = await verifier.verify(h.slice(7));
    } catch (err) {
      if (err instanceof AuthError) throw new HttpError(401, 'unauthenticated');
      throw err;
    }
  };
  const user = (req: FastifyRequest) => req.user!;

  const requireProfile = async (userId: string) => {
    const p = await store.getProfile(userId);
    if (!p) throw new HttpError(409, 'profile_required');
    return p;
  };
  const requireMember = async (channelId: string, userId: string) => {
    if (!Uuid.safeParse(channelId).success) throw new HttpError(404, 'not_found');
    const role = await store.getRole(channelId, userId);
    // Non-members get the same answer whether or not the channel exists.
    if (!role) throw new HttpError(404, 'not_found');
    return role;
  };
  const requireOwner = async (channelId: string, userId: string) => {
    const role = await requireMember(channelId, userId);
    if (role !== 'owner') throw new HttpError(403, 'owner_only');
  };

  app.get('/healthz', async () => ({ ok: true }));

  // ---- Dev-only sign-in (config refuses AUTH_MODE=dev in production) ----
  if (verifier instanceof DevVerifier) {
    app.post('/v1/dev/session', async (req) => {
      const { handle } = DevSessionBody.parse(req.body);
      return verifier.issue(handle);
    });
  }

  // ---- Livekit webhooks (signature-verified) ----
  app.post('/livekit/webhook', async (req, reply) => {
    let ev;
    try {
      ev = await media.receiveWebhook(String(req.body ?? ''), req.headers.authorization);
    } catch {
      return reply.status(401).send({ error: 'bad_signature' });
    }
    await floor.handleWebhook(ev);
    return { ok: true };
  });

  // ---- Authenticated API ----
  await app.register(async (api) => {
    api.addHook('preHandler', authenticate);

    api.get('/v1/me', async (req) => {
      const p = await store.getProfile(user(req).userId);
      return { userId: user(req).userId, displayName: p?.displayName ?? null };
    });

    api.put('/v1/me', async (req) => {
      const { displayName } = ProfileBody.parse(req.body);
      return store.upsertProfile(user(req).userId, displayName);
    });

    api.delete('/v1/me', async (req) => {
      const { userId } = user(req);
      const { ownedChannelIds, memberChannelIds } = await store.deleteUser(userId);
      // Owned channels are gone: empty their rooms. Elsewhere: kick this user.
      for (const cid of ownedChannelIds) {
        const ps = (await media.listParticipants(roomNameFor(cid)).catch(() => null)) ?? [];
        for (const p of ps) await floor.dropUser(cid, p.identity, { kick: true });
      }
      for (const cid of memberChannelIds) await floor.dropUser(cid, userId, { kick: true });
      let authUserDeleted = false;
      try {
        authUserDeleted = await deleteAuthUser(userId);
      } catch (err) {
        req.log.error({ err: errMsg(err) }, 'auth user deletion failed');
      }
      return { deleted: true, authUserDeleted };
    });

    api.get('/v1/channels', async (req) => {
      const chs = await store.listChannelsForUser(user(req).userId);
      return { channels: chs.map((c) => ({ id: c.id, name: c.name, role: c.role, ownerId: c.ownerId })) };
    });

    api.post('/v1/channels', async (req, reply) => {
      const { name } = ChannelBody.parse(req.body);
      await requireProfile(user(req).userId);
      const ch = await store.createChannel(user(req).userId, name);
      return reply.status(201).send({ id: ch.id, name: ch.name, role: 'owner', ownerId: ch.ownerId });
    });

    api.get<{ Params: { id: string } }>('/v1/channels/:id', async (req) => {
      const role = await requireMember(req.params.id, user(req).userId);
      const ch = (await store.getChannel(req.params.id))!;
      const [members, speaker] = await Promise.all([store.listMembers(ch.id), floor.current(ch.id)]);
      return {
        id: ch.id,
        name: ch.name,
        ownerId: ch.ownerId,
        role,
        members: members.map((m) => ({ userId: m.userId, displayName: m.displayName, role: m.role })),
        speaker: speaker ? { userId: speaker.userId, until: speaker.hardDeadline } : null,
      };
    });

    api.delete<{ Params: { id: string } }>('/v1/channels/:id', async (req) => {
      await requireOwner(req.params.id, user(req).userId);
      const members = await store.listMembers(req.params.id);
      await store.deleteChannel(req.params.id);
      for (const m of members) await floor.dropUser(req.params.id, m.userId, { kick: true });
      return { deleted: true };
    });

    api.post<{ Params: { id: string } }>('/v1/channels/:id/invites', async (req, reply) => {
      await requireOwner(req.params.id, user(req).userId);
      const body = InviteBody.parse(req.body ?? undefined);
      const code = newInviteCode();
      const expiresAt = now() + config.inviteTtlHours * 3600_000;
      await store.createInvite(req.params.id, user(req).userId, hashInviteCode(code), expiresAt, body?.maxUses ?? 1);
      return reply.status(201).send({ code, expiresAt, maxUses: body?.maxUses ?? 1 });
    });

    api.post('/v1/invites/redeem', async (req) => {
      const { code } = RedeemBody.parse(req.body);
      await requireProfile(user(req).userId);
      const r = await store.redeemInvite(hashInviteCode(code), user(req).userId, now(), config.maxChannelMembers);
      if (!r.ok) {
        // A blocked user learns only that the invite does not work.
        const status = r.reason === 'full' ? 409 : 404;
        throw new HttpError(status, r.reason === 'full' ? 'channel_full' : 'invite_invalid');
      }
      const ch = (await store.getChannel(r.channelId))!;
      return { id: ch.id, name: ch.name, role: await store.getRole(ch.id, user(req).userId), ownerId: ch.ownerId };
    });

    api.post<{ Params: { id: string } }>('/v1/channels/:id/leave', async (req) => {
      const role = await requireMember(req.params.id, user(req).userId);
      if (role === 'owner') throw new HttpError(409, 'owner_cannot_leave');
      await store.removeMember(req.params.id, user(req).userId);
      await floor.dropUser(req.params.id, user(req).userId, { kick: true });
      return { left: true };
    });

    api.delete<{ Params: { id: string; userId: string } }>('/v1/channels/:id/members/:userId', async (req) => {
      await requireOwner(req.params.id, user(req).userId);
      if (req.params.userId === user(req).userId) throw new HttpError(409, 'cannot_remove_self');
      if (!(await store.removeMember(req.params.id, req.params.userId))) throw new HttpError(404, 'not_a_member');
      await floor.dropUser(req.params.id, req.params.userId, { kick: true });
      return { removed: true };
    });

    api.get<{ Params: { id: string } }>('/v1/channels/:id/blocks', async (req) => {
      await requireOwner(req.params.id, user(req).userId);
      return { blocks: await store.listBlocks(req.params.id) };
    });

    api.post<{ Params: { id: string } }>('/v1/channels/:id/blocks', async (req) => {
      await requireOwner(req.params.id, user(req).userId);
      const { userId } = BlockBody.parse(req.body);
      if (userId === user(req).userId) throw new HttpError(409, 'cannot_block_self');
      await store.block(req.params.id, userId, user(req).userId);
      await floor.dropUser(req.params.id, userId, { kick: true });
      return { blocked: true };
    });

    api.delete<{ Params: { id: string; userId: string } }>('/v1/channels/:id/blocks/:userId', async (req) => {
      await requireOwner(req.params.id, user(req).userId);
      await store.unblock(req.params.id, req.params.userId);
      return { unblocked: true };
    });

    // Short-lived, subscribe-only room credentials.
    api.post<{ Params: { id: string } }>('/v1/channels/:id/connection', async (req) => {
      const { userId } = user(req);
      await requireMember(req.params.id, userId);
      const profile = await requireProfile(userId);
      const room = roomNameFor(req.params.id);
      await media.ensureRoom(room, config.maxChannelMembers);
      const token = await media.createJoinToken({ room, identity: userId, name: profile.displayName, ttlS: config.joinTokenTtlS });
      return { url: config.livekit.url, token, room, identity: userId, expiresInS: config.joinTokenTtlS };
    });

    api.get<{ Params: { id: string } }>('/v1/channels/:id/talk', async (req) => {
      await requireMember(req.params.id, user(req).userId);
      const l = await floor.current(req.params.id);
      return { speaker: l ? { userId: l.userId, until: l.hardDeadline } : null };
    });

    api.post<{ Params: { id: string } }>('/v1/channels/:id/talk', async (req, reply) => {
      if (!Uuid.safeParse(req.params.id).success) throw new HttpError(404, 'not_found');
      const r = await floor.requestTalk(user(req).userId, req.params.id);
      switch (r.kind) {
        case 'granted':
          return reply.status(200).send(r);
        case 'busy':
          return reply.status(409).send({ error: 'busy', speaker: { userId: r.holderUserId, until: r.until } });
        case 'forbidden':
          throw new HttpError(404, 'not_found');
        case 'rate_limited':
          reply.header('retry-after', Math.ceil(r.retryAfterMs / 1000));
          return reply.status(429).send({ error: 'rate_limited', retryAfterMs: r.retryAfterMs });
        case 'not_connected':
          return reply.status(409).send({ error: 'not_connected' });
        case 'unavailable':
          return reply.status(503).send({ error: 'unavailable' });
      }
    });

    api.post<{ Params: { id: string; leaseId: string } }>('/v1/channels/:id/talk/:leaseId/renew', async (req) => {
      await requireMember(req.params.id, user(req).userId);
      if (!Uuid.safeParse(req.params.leaseId).success) throw new HttpError(410, 'turn_ended');
      const l = await floor.renew(user(req).userId, req.params.id, req.params.leaseId);
      if (!l) throw new HttpError(410, 'turn_ended');
      return { leaseId: l.leaseId, renewDeadline: l.renewDeadline, hardDeadline: l.hardDeadline };
    });

    api.delete<{ Params: { id: string; leaseId: string } }>('/v1/channels/:id/talk/:leaseId', async (req) => {
      if (!Uuid.safeParse(req.params.id).success || !Uuid.safeParse(req.params.leaseId).success) throw new HttpError(404, 'not_found');
      // Releasing is allowed even after removal, so a client can always stop.
      const released = await floor.release(user(req).userId, req.params.id, req.params.leaseId);
      return { released };
    });
  });

  return { app, floor };
}
