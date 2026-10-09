// Durable Stripe webhook listener — dev/test-mode webhook delivery.
//
// Runs `stripe listen --forward-to <api/webhooks/stripe>` as a supervised
// child, captures the whsec_ signing secret the CLI emits on each start,
// and propagates it to .env.local so a regenerated secret can never
// silently break signature verification. When the secret changes, the
// web process is restarted so the new secret is actually loaded.
//
// Why: `stripe listen` mints a NEW signing secret every launch. Without
// this bridge, a listen restart (PM2 restart, reboot) leaves the app
// verifying signatures against a stale whsec_ — every webhook 400s and
// payment events are silently lost.
//
// This is a development/test-mode arrangement. Production webhook
// delivery uses a Stripe-registered endpoint (see the
// stripe:live-webhook-endpoint Human Action).
//
// Supervision contract: exits nonzero when the child exits so PM2
// restarts it; never throws on transient parse/write failure.
//
// Usage:  node scripts/stripe-webhook-listener.js
// PM2:    pm2 start scripts/stripe-webhook-listener.js --name hydi-stripe-webhook-listener

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const ENV_FILE = path.join(REPO, '.env.local');
const SECRET_ENV = 'STRIPE_WEBHOOK_SECRET_01';
const FORWARD_TO = process.env.STRIPE_LISTEN_FORWARD_TO || 'http://localhost:3000/api/webhooks/stripe';
const WEB_PROCESS = process.env.HYDI_WEB_PM2_NAME || 'heidi-web-standalone';

function parseWhsecSecret(line) {
  const m = /whsec_[a-f0-9]{16,}/.exec(String(line || ''));
  return m ? m[0] : null;
}

function upsertEnvVar(text, name, value) {
  const re = new RegExp('^' + name + '=.*$', 'm');
  return re.test(text) ? text.replace(re, name + '=' + value) : text.replace(/\s*$/, '') + '\n' + name + '=' + value + '\n';
}

function readEnvVar(file, name) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && m[1] === name) return m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* absent file */ }
  return null;
}

function propagateSecret(secret, { envFile = ENV_FILE, log = console.log, restart = pm2Restart } = {}) {
  const current = readEnvVar(envFile, SECRET_ENV);
  if (current === secret) { log(`[stripe-listener] signing secret unchanged`); return false; }
  try {
    const existing = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
    fs.writeFileSync(envFile, upsertEnvVar(existing, SECRET_ENV, secret));
  } catch (e) {
    log(`[stripe-listener] env write failed: ${e instanceof Error ? e.message : e}`);
    return false;
  }
  log(`[stripe-listener] signing secret rotated -> ${envFile}; restarting ${WEB_PROCESS}`);
  try { restart(); } catch (e) { log(`[stripe-listener] pm2 restart failed: ${e instanceof Error ? e.message : e}`); }
  return true;
}

function pm2Restart() {
  const p = spawn('pm2', ['restart', WEB_PROCESS], { stdio: 'ignore', shell: true, windowsHide: true });
  p.on('error', () => { /* pm2 unavailable — secret still persisted */ });
}

function main() {
  // Auth: Stripe CLI stored login, or STRIPE_API_KEY/STRIPE_SECRET_KEY via
  // the child's env. The key is deliberately NOT passed as --api-key — a
  // CLI arg would expose it on the process command line (pm2 describe,
  // Task Manager). Env vars travel with the process env block instead.
  console.log(`[stripe-listener] forwarding to ${FORWARD_TO}`);
  const env = { ...process.env };
  if (!env.STRIPE_API_KEY && env.STRIPE_SECRET_KEY) env.STRIPE_API_KEY = env.STRIPE_SECRET_KEY;
  const child = spawn('stripe', ['listen', '--forward-to', FORWARD_TO, '--skip-verify'],
    { shell: true, windowsHide: true, env });
  // The CLI prints its "Ready! ... signing secret is whsec_..." banner on
  // stderr — both streams are scanned for the secret, and log lines are
  // scrubbed so a whsec_ value can never land in PM2 logs.
  const handleLine = (line, err) => {
    const whsec = parseWhsecSecret(line);
    if (whsec) { propagateSecret(whsec); return; }
    const ev = /\[?(evt_[A-Za-z0-9]+)\]?/.exec(line);
    if (ev) console.log(`[stripe-listener] ${ev[1]}`);
    else if (/Ready|error|failed/i.test(line)) (err ? console.error : console.log)('[stripe-listener]', line.trim().slice(0, 200));
  };
  const buffers = { out: '', err: '' };
  child.stdout.on('data', (d) => {
    buffers.out += String(d);
    const lines = buffers.out.split(/\r?\n/);
    buffers.out = lines.pop(); // keep any partial line for the next chunk
    for (const line of lines) handleLine(line, false);
  });
  child.stderr.on('data', (d) => {
    buffers.err += String(d);
    const lines = buffers.err.split(/\r?\n/);
    buffers.err = lines.pop();
    for (const line of lines) handleLine(line, true);
  });
  child.on('error', (e) => { console.error(`[stripe-listener] spawn failed: ${e.message} — is the Stripe CLI installed?`); process.exit(1); });
  child.on('exit', (code) => { console.error(`[stripe-listener] child exited (${code}) — exiting for PM2 restart`); process.exit(code || 1); });
  process.on('SIGINT', () => { child.kill(); process.exit(0); });
  process.on('SIGTERM', () => { child.kill(); process.exit(0); });
}

if (require.main === module) main();

module.exports = { parseWhsecSecret, upsertEnvVar, readEnvVar, propagateSecret };
