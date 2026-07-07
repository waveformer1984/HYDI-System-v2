'use strict';

/**
 * Vercel provisioning module.
 *
 * verify(): CLI authenticated, repo linked, required env-var NAMES present.
 * provision(): link the repo to the canonical project. Env-var VALUES are
 *   never set automatically here — per SECURITY_PROTOCOL.md they must be
 *   direct-injected by an operator (`... | vercel env add NAME production`).
 */

const fs = require('fs');
const path = require('path');
const { run } = require('./util');

const PROJECT = process.env.CLOUD_BOOTSTRAP_VERCEL_PROJECT || 'hydi-system';
const SCOPE = process.env.CLOUD_BOOTSTRAP_VERCEL_SCOPE || 'forgefinder';
const LINK_FILE = path.join(__dirname, '../../.vercel/project.json');

const REQUIRED_ENV_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'STRIPE_SECRET_KEY',
  'HYDI_SERVICE_SECRET',
];

// vercel CLI is a .cmd shim on Windows; execFile needs the real binary name.
const VERCEL = process.platform === 'win32' ? 'vercel.cmd' : 'vercel';

async function verify() {
  const who = run(VERCEL, ['whoami'], { timeoutMs: 30_000 });
  if (!who.ok || !who.stdout.trim()) {
    return { status: 'blocked', detail: 'vercel CLI not authenticated.', actionRequired: 'Run `vercel login`.' };
  }
  if (!fs.existsSync(LINK_FILE)) {
    return { status: 'failed', detail: 'Repo not linked to a Vercel project (.vercel/project.json missing).' };
  }
  const envLs = run(VERCEL, ['env', 'ls'], { timeoutMs: 60_000 });
  if (!envLs.ok) {
    return { status: 'failed', detail: 'vercel env ls failed; cannot confirm env vars.' };
  }
  const missing = REQUIRED_ENV_NAMES.filter((name) => !envLs.stdout.includes(name));
  if (missing.length > 0) {
    return {
      status: 'blocked',
      detail: `Linked to ${PROJECT} but missing env vars: ${missing.join(', ')}`,
      actionRequired: `Direct-inject each missing var: <secret-source> | vercel env add <NAME> production (never paste values).`,
    };
  }
  return { status: 'verified', detail: `Linked to ${SCOPE}/${PROJECT}; all required env-var names present.` };
}

async function provision() {
  const link = run(VERCEL, ['link', '--yes', '--project', PROJECT, '--scope', SCOPE], { timeoutMs: 120_000 });
  if (!link.ok) {
    return { status: 'failed', detail: `vercel link failed: ${String(link.stderr || link.message).slice(0, 200)}` };
  }
  return { status: 'verified', detail: `Linked repo to ${SCOPE}/${PROJECT}.` };
}

module.exports = { name: 'vercel', verify, provision, REQUIRED_ENV_NAMES };
