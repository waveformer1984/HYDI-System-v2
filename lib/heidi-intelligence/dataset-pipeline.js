'use strict';

const fs = require('fs');
const path = require('path');
const { repoRoot } = require('./identity');

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g;
const KEY_RE = /\b(sk_|pk_|Bearer\s+[A-Za-z0-9._-]+)/gi;

function redact(text) {
  return String(text || '')
    .replace(EMAIL_RE, '[REDACTED_EMAIL]')
    .replace(PHONE_RE, '[REDACTED_PHONE]')
    .replace(KEY_RE, '[REDACTED_SECRET]');
}

function corpusDir() {
  return path.join(repoRoot(), '.runtime', 'heidi-intelligence');
}

function captureAllowed(env = process.env) {
  const on = String(env.HEIDI_INTELLIGENCE_DATASET_CAPTURE || '').toLowerCase() === 'true';
  const clientOk = String(env.HEIDI_DATASET_CLIENT_AUTHORIZED || '').toLowerCase() === 'true';
  return { on, clientOk, allowed: on && clientOk };
}

/**
 * Append a training-eligible record only when operator enables capture AND client authorization.
 */
function appendInteraction(record, env = process.env) {
  const gate = captureAllowed(env);
  if (!gate.allowed) {
    return { written: false, reason: gate.on ? 'client_not_authorized' : 'capture_disabled' };
  }
  const dir = corpusDir();
  fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({
    ...record,
    input: redact(record.input),
    output: redact(record.output),
    correctedOutput: record.correctedOutput ? redact(record.correctedOutput) : undefined,
    privacy: 'redacted_v1',
    ts: new Date().toISOString(),
  });
  fs.appendFileSync(path.join(dir, 'interactions.jsonl'), `${line}\n`, 'utf8');
  return { written: true };
}

module.exports = { redact, captureAllowed, appendInteraction, corpusDir };