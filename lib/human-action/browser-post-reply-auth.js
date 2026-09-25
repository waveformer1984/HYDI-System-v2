// browser_post_reply — pure authorization contract (no browser deps).
// Imported by chat.ts and the executor; must stay require()-free of
// ESM/browser packages so Next.js can bundle it.

const crypto = require('crypto');

const AUTH_TTL_MS = 60 * 60 * 1000; // 1 hour — approval is not durable authority

function hashMessage(message) {
  return crypto.createHash('sha256').update(String(message)).digest('hex');
}

function createAuthorization(spec, authorizedBy = 'operator') {
  return {
    authorization_id: `authz_${crypto.randomUUID().slice(0, 12)}`,
    action_type: 'browser_post_reply',
    opportunity_id: spec.opportunityId,
    channel: spec.channel,
    destination: spec.permalink,
    message_hash: hashMessage(spec.message),
    authorized_by: authorizedBy,
    authorized_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + AUTH_TTL_MS).toISOString(),
    status: 'AUTHORIZED',
  };
}

function validateSpec(spec) {
  const a = spec?.authorization;
  if (!a) return { ok: false, status: 'REJECTED', reason: 'missing authorization' };
  if (a.action_type !== 'browser_post_reply') return { ok: false, status: 'REJECTED', reason: 'authorization action_type mismatch' };
  if (a.status === 'REJECTED') return { ok: false, status: 'REJECTED', reason: 'authorization was rejected' };
  if (a.status !== 'AUTHORIZED') return { ok: false, status: 'REJECTED', reason: `authorization status is ${a.status}` };
  if (new Date(a.expires_at).getTime() < Date.now()) return { ok: false, status: 'REJECTED', reason: 'authorization expired' };
  if (a.opportunity_id !== spec.opportunityId) return { ok: false, status: 'REJECTED', reason: 'opportunity mismatch — REQUIRES_NEW_AUTHORIZATION' };
  if (a.channel !== spec.channel) return { ok: false, status: 'REJECTED', reason: 'channel mismatch — REQUIRES_NEW_AUTHORIZATION' };
  if (a.destination !== spec.permalink) return { ok: false, status: 'REJECTED', reason: 'destination mismatch — REQUIRES_NEW_AUTHORIZATION' };
  if (a.message_hash !== hashMessage(spec.message)) return { ok: false, status: 'REJECTED', reason: 'message mismatch — REQUIRES_NEW_AUTHORIZATION' };
  return { ok: true };
}

// Pure page classifier — testable without a browser.
function classifyPage({ url, destination, pageText }) {
  const hostOk = new URL(destination).hostname.replace(/^old\.|^www\./, '');
  const pageHost = new URL(url).hostname.replace(/^old\.|^www\./, '');
  if (pageHost !== hostOk) return { verdict: 'FAIL_CLOSED', reason: `destination mismatch: on ${pageHost}, expected ${hostOk}` };
  const t = (pageText || '').toLowerCase();
  if (/log in|sign in|sign up|create an account/.test(t) && !/comment|reply/.test(t)) {
    return { verdict: 'WAITING_FOR_HUMAN', reason: 'authentication required — no reply affordance visible' };
  }
  if (/you'?ve been blocked|access denied|are you a robot|verify you are human|rate limit/.test(t)) {
    return { verdict: 'EXTERNAL_BLOCK', reason: 'platform is blocking this client' };
  }
  if (t.length < 200) return { verdict: 'UNKNOWN', reason: 'page content too thin to classify' };
  return { verdict: 'PROCEED' };
}

module.exports = { createAuthorization, validateSpec, classifyPage, hashMessage };
