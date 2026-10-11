import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * All configuration comes from the environment. Secrets (LiveKit API secret,
 * Supabase JWT secret / service-role key, database URL) are read here and only
 * here, and never leave the server process.
 */
const Env = z.object({
  NODE_ENV: z.string().default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z.string().default('info'),

  // LiveKit. LIVEKIT_URL is what phones connect to (ws:// or wss://).
  // LIVEKIT_API_URL is what this server calls (http:// or https://); it
  // defaults to LIVEKIT_URL with the scheme swapped.
  LIVEKIT_URL: z.string().url(),
  LIVEKIT_API_URL: z.string().url().optional(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(32, 'LIVEKIT_API_SECRET must be at least 32 characters'),

  // Postgres (e.g. the local Supabase database). Unset → in-memory store,
  // which is refused when NODE_ENV=production.
  DATABASE_URL: z.string().optional(),

  // Authentication. 'supabase' verifies Supabase Auth access tokens.
  // 'dev' issues local tokens from POST /v1/dev/session and is refused in
  // production.
  AUTH_MODE: z.enum(['supabase', 'dev']).default('supabase'),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_JWT_SECRET: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  WALKIE_DEV_AUTH_SECRET: z.string().optional(),

  // Speaker arbitration.
  TALK_MAX_MS: z.coerce.number().int().min(1000).max(300_000).default(30_000),
  TALK_RENEW_TTL_MS: z.coerce.number().int().min(1000).max(60_000).default(5_000),
  TALK_MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().min(0).max(10_000).default(250),
  TALK_BURST: z.coerce.number().int().min(1).max(100).default(6),
  TALK_BURST_WINDOW_MS: z.coerce.number().int().min(1000).max(600_000).default(10_000),

  JOIN_TOKEN_TTL_S: z.coerce.number().int().min(30).max(3600).default(300),
  INVITE_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(24),
  MAX_CHANNEL_MEMBERS: z.coerce.number().int().min(2).max(500).default(50),

  // iOS PushToTalk (Milestone 3). All four of key, key id, team id and
  // bundle id, or none (then PTT pushes are disabled).
  APNS_KEY_P8: z.string().optional(),
  APNS_KEY_FILE: z.string().optional(),
  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  APNS_BUNDLE_ID: z.string().optional(),
  APNS_SANDBOX_ORIGIN: z.string().url().optional(),
  APNS_PRODUCTION_ORIGIN: z.string().url().optional(),

  SWEEP_INTERVAL_MS: z.coerce.number().int().min(100).max(10_000).default(500),
  RECONCILE_INTERVAL_MS: z.coerce.number().int().min(1000).max(600_000).default(10_000),
});

export type Config = {
  nodeEnv: string;
  host: string;
  port: number;
  logLevel: string;
  livekit: { url: string; apiUrl: string; apiKey: string; apiSecret: string };
  databaseUrl?: string;
  auth:
    | { mode: 'supabase'; supabaseUrl: string; jwtSecret?: string; serviceRoleKey?: string }
    | { mode: 'dev'; devSecret: string; supabaseUrl?: string; serviceRoleKey?: string };
  talk: {
    maxMs: number;
    renewTtlMs: number;
    minRequestIntervalMs: number;
    burst: number;
    burstWindowMs: number;
  };
  joinTokenTtlS: number;
  inviteTtlHours: number;
  maxChannelMembers: number;
  sweepIntervalMs: number;
  reconcileIntervalMs: number;
  apns?: { keyPem: string; keyId: string; teamId: string; bundleId: string; sandboxOrigin?: string; productionOrigin?: string };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid walkie configuration:\n  ${issues.join('\n  ')}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';

  if (production && !e.DATABASE_URL) {
    throw new Error('DATABASE_URL is required when NODE_ENV=production (the in-memory store loses state on restart and cannot be shared between instances).');
  }

  let auth: Config['auth'];
  if (e.AUTH_MODE === 'dev') {
    if (production) throw new Error('AUTH_MODE=dev is refused when NODE_ENV=production.');
    if (!e.WALKIE_DEV_AUTH_SECRET || e.WALKIE_DEV_AUTH_SECRET.length < 32) {
      throw new Error('AUTH_MODE=dev requires WALKIE_DEV_AUTH_SECRET (at least 32 characters).');
    }
    auth = { mode: 'dev', devSecret: e.WALKIE_DEV_AUTH_SECRET, supabaseUrl: e.SUPABASE_URL, serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY };
  } else {
    if (!e.SUPABASE_URL) throw new Error('AUTH_MODE=supabase requires SUPABASE_URL.');
    auth = { mode: 'supabase', supabaseUrl: e.SUPABASE_URL.replace(/\/$/, ''), jwtSecret: e.SUPABASE_JWT_SECRET || undefined, serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY };
  }

  if (production && e.LIVEKIT_URL.startsWith('ws://')) {
    throw new Error('LIVEKIT_URL must use wss:// in production (signalling would otherwise travel unencrypted).');
  }

  let apns: Config['apns'];
  const keyPem = e.APNS_KEY_P8 ? e.APNS_KEY_P8.replace(/\\n/g, '\n') : e.APNS_KEY_FILE ? readFileSync(e.APNS_KEY_FILE, 'utf8') : undefined;
  const apnsParts = [keyPem, e.APNS_KEY_ID, e.APNS_TEAM_ID, e.APNS_BUNDLE_ID];
  if (apnsParts.some(Boolean)) {
    if (!apnsParts.every(Boolean)) {
      throw new Error('APNs needs all of APNS_KEY_P8 (or APNS_KEY_FILE), APNS_KEY_ID, APNS_TEAM_ID and APNS_BUNDLE_ID, or none of them.');
    }
    apns = {
      keyPem: keyPem!,
      keyId: e.APNS_KEY_ID!,
      teamId: e.APNS_TEAM_ID!,
      bundleId: e.APNS_BUNDLE_ID!,
      sandboxOrigin: e.APNS_SANDBOX_ORIGIN,
      productionOrigin: e.APNS_PRODUCTION_ORIGIN,
    };
  }

  const apiUrl = e.LIVEKIT_API_URL ?? e.LIVEKIT_URL.replace(/^ws/, 'http');

  return {
    nodeEnv: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    livekit: { url: e.LIVEKIT_URL, apiUrl, apiKey: e.LIVEKIT_API_KEY, apiSecret: e.LIVEKIT_API_SECRET },
    databaseUrl: e.DATABASE_URL || undefined,
    auth,
    talk: {
      maxMs: e.TALK_MAX_MS,
      renewTtlMs: e.TALK_RENEW_TTL_MS,
      minRequestIntervalMs: e.TALK_MIN_REQUEST_INTERVAL_MS,
      burst: e.TALK_BURST,
      burstWindowMs: e.TALK_BURST_WINDOW_MS,
    },
    joinTokenTtlS: e.JOIN_TOKEN_TTL_S,
    inviteTtlHours: e.INVITE_TTL_HOURS,
    maxChannelMembers: e.MAX_CHANNEL_MEMBERS,
    sweepIntervalMs: e.SWEEP_INTERVAL_MS,
    reconcileIntervalMs: e.RECONCILE_INTERVAL_MS,
    apns,
  };
}
