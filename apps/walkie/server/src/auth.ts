import { createHash, randomUUID } from 'node:crypto';
import { SignJWT, createRemoteJWKSet, decodeJwt, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Config } from './config.js';

export interface AuthUser {
  userId: string;
  email?: string;
  /** Joined by scanning an invite QR: may use the channels it joined, nothing more. */
  guest?: boolean;
  /** Signed by this server (guest or owner session), not by Supabase. */
  serverSession?: boolean;
}

export interface AuthVerifier {
  verify(bearer: string): Promise<AuthUser>;
}

export class AuthError extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verifies Supabase Auth access tokens locally (no network round-trip per
 * request): HS256 with the project's JWT secret when SUPABASE_JWT_SECRET is
 * set, otherwise the project's published JWKS (asymmetric signing keys).
 * Anonymous Supabase users are refused.
 */
export class SupabaseVerifier implements AuthVerifier {
  private readonly key: Uint8Array | JWTVerifyGetKey;
  private readonly issuer: string;

  constructor(opts: { supabaseUrl: string; jwtSecret?: string; jwks?: JWTVerifyGetKey }) {
    this.issuer = `${opts.supabaseUrl.replace(/\/$/, '')}/auth/v1`;
    if (opts.jwks) this.key = opts.jwks;
    else if (opts.jwtSecret) this.key = new TextEncoder().encode(opts.jwtSecret);
    else this.key = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
  }

  async verify(bearer: string): Promise<AuthUser> {
    try {
      const { payload } = await jwtVerify(bearer, this.key as JWTVerifyGetKey, {
        issuer: this.issuer,
        audience: 'authenticated',
        algorithms: ['HS256', 'RS256', 'ES256'],
        clockTolerance: 5,
      });
      if (payload.role !== 'authenticated' || payload.is_anonymous === true) throw new AuthError('not an authenticated user');
      if (typeof payload.sub !== 'string' || !UUID_RE.test(payload.sub)) throw new AuthError('bad subject');
      return { userId: payload.sub.toLowerCase(), email: typeof payload.email === 'string' ? payload.email : undefined };
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError('invalid token');
    }
  }
}

const DEV_ISSUER = 'walkie-dev';

/** Local development only (refused in production by config). */
export class DevVerifier implements AuthVerifier {
  private readonly key: Uint8Array;
  constructor(private readonly secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  /** Deterministic user id per handle, so a phone that signs in as "alice" again is the same user. */
  userIdFor(handle: string): string {
    const h = createHash('sha256').update(`walkie-dev-user:${this.secret}:${handle.toLowerCase()}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }

  async issue(handle: string, ttlS = 12 * 3600): Promise<{ token: string; userId: string; expiresAt: number }> {
    const userId = this.userIdFor(handle);
    const exp = Math.floor(Date.now() / 1000) + ttlS;
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(DEV_ISSUER)
      .setAudience('walkie')
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(this.key);
    return { token, userId, expiresAt: exp * 1000 };
  }

  async verify(bearer: string): Promise<AuthUser> {
    try {
      const { payload } = await jwtVerify(bearer, this.key, { issuer: DEV_ISSUER, audience: 'walkie', algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string' || !UUID_RE.test(payload.sub)) throw new AuthError('bad subject');
      return { userId: payload.sub };
    } catch {
      throw new AuthError('invalid token');
    }
  }
}

const SESSION_ISSUER = 'walkie-session';
const SESSION_AUDIENCE = 'walkie';
const LOGIN_AUDIENCE = 'walkie-login';

/**
 * Sessions this server signs itself (WALKIE_SESSION_SECRET), so nobody needs
 * an email account to use walkie:
 *  - guest sessions, handed out when someone joins through an invite QR;
 *  - owner sessions, obtained by exchanging a one-time login ticket that only
 *    the `npm run owner-login` command on the server machine can mint.
 */
export class SessionIssuer implements AuthVerifier {
  private readonly key: Uint8Array;
  /** Login tickets already exchanged (jti → expiry). In-process: tickets live 10 minutes. */
  private readonly usedTickets = new Map<string, number>();

  constructor(private readonly secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  /** Stable account id for an owner name, so signing in again keeps the same channels. */
  ownerIdFor(name: string): string {
    const h = createHash('sha256').update(`walkie-owner:${this.secret}:${name.trim().toLowerCase()}`).digest('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }

  private async sign(claims: Record<string, unknown>, sub: string, audience: string, ttlS: number) {
    const exp = Math.floor(Date.now() / 1000) + ttlS;
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(SESSION_ISSUER)
      .setAudience(audience)
      .setSubject(sub)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(this.key);
    return { token, expiresAt: exp * 1000 };
  }

  issueSession(userId: string, kind: 'guest' | 'owner', ttlS: number) {
    return this.sign({ kind }, userId, SESSION_AUDIENCE, ttlS);
  }

  issueLoginTicket(name: string, ttlS = 600) {
    return this.sign({ kind: 'login', name: name.trim() }, this.ownerIdFor(name), LOGIN_AUDIENCE, ttlS);
  }

  /** True when the token claims to be one of ours (cheap pre-check; still verified). */
  static owns(bearer: string): boolean {
    try {
      return decodeJwt(bearer).iss === SESSION_ISSUER;
    } catch {
      return false;
    }
  }

  async verify(bearer: string): Promise<AuthUser> {
    try {
      const { payload } = await jwtVerify(bearer, this.key, { issuer: SESSION_ISSUER, audience: SESSION_AUDIENCE, algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string' || !UUID_RE.test(payload.sub)) throw new AuthError('bad subject');
      if (payload.kind !== 'guest' && payload.kind !== 'owner') throw new AuthError('bad kind');
      return { userId: payload.sub, guest: payload.kind === 'guest', serverSession: true };
    } catch {
      throw new AuthError('invalid token');
    }
  }

  /** Validates a login ticket and marks it used. Each ticket works once. */
  async redeemLoginTicket(ticket: string, now = Date.now()): Promise<{ userId: string; name: string }> {
    let payload;
    try {
      ({ payload } = await jwtVerify(ticket, this.key, { issuer: SESSION_ISSUER, audience: LOGIN_AUDIENCE, algorithms: ['HS256'] }));
    } catch {
      throw new AuthError('invalid ticket');
    }
    if (payload.kind !== 'login' || typeof payload.jti !== 'string' || typeof payload.name !== 'string' || typeof payload.sub !== 'string') {
      throw new AuthError('invalid ticket');
    }
    for (const [jti, exp] of this.usedTickets) if (exp <= now) this.usedTickets.delete(jti);
    if (this.usedTickets.has(payload.jti)) throw new AuthError('ticket already used');
    this.usedTickets.set(payload.jti, (payload.exp ?? 0) * 1000);
    return { userId: payload.sub, name: payload.name };
  }
}

/** Routes each token to the verifier that issued it. */
export class CompositeVerifier implements AuthVerifier {
  constructor(
    readonly primary: AuthVerifier,
    private readonly sessions?: SessionIssuer,
  ) {}

  verify(bearer: string): Promise<AuthUser> {
    if (this.sessions && SessionIssuer.owns(bearer)) return this.sessions.verify(bearer);
    return this.primary.verify(bearer);
  }
}

export function createVerifier(config: Config, sessions?: SessionIssuer): AuthVerifier {
  const primary =
    config.auth.mode === 'dev' ? new DevVerifier(config.auth.devSecret) : new SupabaseVerifier({ supabaseUrl: config.auth.supabaseUrl, jwtSecret: config.auth.jwtSecret });
  return sessions ? new CompositeVerifier(primary, sessions) : primary;
}

/**
 * Deletes the Supabase Auth user (account deletion). Needs the service-role
 * key, which stays on the server. Returns false when not configured.
 */
export async function deleteSupabaseUser(supabaseUrl: string | undefined, serviceRoleKey: string | undefined, userId: string): Promise<boolean> {
  if (!supabaseUrl || !serviceRoleKey) return false;
  const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` },
  });
  if (res.status === 404) return true;
  if (!res.ok) throw new Error(`Supabase admin delete failed with HTTP ${res.status}`);
  return true;
}
