import { createHash } from 'node:crypto';
import { SignJWT, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Config } from './config.js';

export interface AuthUser {
  userId: string;
  email?: string;
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

export function createVerifier(config: Config): AuthVerifier {
  if (config.auth.mode === 'dev') return new DevVerifier(config.auth.devSecret);
  return new SupabaseVerifier({ supabaseUrl: config.auth.supabaseUrl, jwtSecret: config.auth.jwtSecret });
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
