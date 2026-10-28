'use strict';

/**
 * Keeps credentials out of Heidi's long-term memory.
 *
 * Conversation messages are stored as said (the user typed them), but a
 * memory is retrieved into future prompts, so anything that looks like a
 * credential is refused before it becomes one. False positives are fine
 * here: a refused memory can be restated without the secret.
 */

const PATTERNS = [
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/, // Stripe keys
  /\bwhsec_[A-Za-z0-9]{8,}/, // Stripe webhook secrets
  /\bgh[pousr]_[A-Za-z0-9]{20,}/, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bsk-[A-Za-z0-9_-]{20,}/, // OpenAI / Anthropic style keys
  /\bgsk_[A-Za-z0-9]{20,}/, // Groq keys
  /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{10,}/, // Supabase keys
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/, // JWTs
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bhydi-provision:v1\?/, // one-time key codes
  /\b(?:password|passwd|passcode|api[_ -]?key|secret|token|bearer)\b\s*(?:is|=|:)\s*\S{4,}/i,
  /\b[0-9a-f]{40,}\b/i, // long hex strings (keys, hashes used as secrets)
  /\b[A-Za-z0-9+/]{48,}={0,2}(?![A-Za-z0-9+/])/, // long base64 blobs
];

function containsSecret(text) {
  const s = String(text || '');
  return PATTERNS.some((re) => re.test(s));
}

module.exports = { containsSecret };
