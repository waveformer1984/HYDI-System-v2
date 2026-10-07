// Runtime configuration for the ProtoForge MCP server.
//
// Everything is read from the environment. The repo root's .env.local and
// .env are loaded first (same order as scripts/health-check.js) so the
// server sees exactly what the rest of HYDI sees on Frank — no second set
// of secrets to keep in sync.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

export async function loadEnvFiles() {
  try {
    const dotenv = await import('dotenv');
    dotenv.config({ path: path.join(REPO_ROOT, '.env.local'), quiet: true });
    dotenv.config({ path: path.join(REPO_ROOT, '.env'), quiet: true });
  } catch {
    // dotenv missing: rely on the process environment alone.
  }
}

/** Build the config object from an env map (process.env by default). */
export function readConfig(env = process.env) {
  const trim = (v) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\/+$/, '') : undefined);
  return {
    // Local service bases — defaults match boot.config.json / .ports.json.
    heidiWebUrl: trim(env.PROTOFORGE_MCP_HEIDI_WEB_URL) || trim(env.HYDI_API_URL) || 'http://127.0.0.1:3000',
    protoforgeCoreUrl: trim(env.PROTOFORGE_CORE_URL) || 'http://127.0.0.1:3005',
    mobileChatUrl: trim(env.PROTOFORGE_MCP_MOBILE_CHAT_URL) || 'http://127.0.0.1:3006',

    supabaseUrl: trim(env.SUPABASE_URL),
    supabaseKey: env.SUPABASE_SERVICE_ROLE_KEY || undefined,
    serviceSecret: env.HYDI_SERVICE_SECRET || undefined,
    stripeKey: env.STRIPE_SECRET_KEY || undefined,

    timeoutMs: Number.parseInt(env.PROTOFORGE_MCP_TIMEOUT_MS || '', 10) || 8000,

    // HTTP transport (phone / remote access). Never starts without a token.
    httpHost: env.PROTOFORGE_MCP_HOST || '127.0.0.1',
    httpPort: Number.parseInt(env.PROTOFORGE_MCP_PORT || '', 10) || 3470,
    httpToken: env.PROTOFORGE_MCP_TOKEN || undefined,

    env,
  };
}

/** The six Stripe Connect revenue streams (CLAUDE.md). */
export const STREAMS = [
  'galactic_bytes',
  'detailer_bot',
  'lipi_v2',
  'protogrance_aromatics',
  'rezonate',
  'waveformer_studio',
];
