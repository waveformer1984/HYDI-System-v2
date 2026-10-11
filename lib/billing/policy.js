'use strict';

/**
 * Billing policy: the subscription state machine and the rule that turns a
 * subscription's state into an access window. This is the single place that
 * answers "does this billing state grant access, and until when?" — see the
 * state/access table in docs/billing/REVENUE_STREAMS_MODULE.md §C.
 *
 * Statuses mirror the provider's (Stripe) subscription statuses, because the
 * provider is the authority on whether money was collected. Hydi never moves
 * a subscription into a paid state on its own.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const STATUSES = Object.freeze([
  'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused',
]);

/** Terminal states: a provider subscription never leaves these. */
const TERMINAL = Object.freeze(['canceled', 'incomplete_expired']);

/** States that may grant access (subject to the time window below). */
const ACCESS_STATES = Object.freeze(['trialing', 'active', 'past_due']);

/** States counted as a live (non-ended) subscription for "one per tenant". */
const LIVE_STATES = Object.freeze(['incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'paused']);

function intFromEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

function enumFromEnv(name, allowed, fallback) {
  const raw = process.env[name];
  return allowed.includes(raw) ? raw : fallback;
}

/**
 * Reads policy configuration. Defaults are conservative and documented;
 * every value is overridable per deployment.
 */
function loadPolicy(overrides = {}) {
  return {
    /** Days of continued access after a renewal payment fails (status past_due). */
    graceDays: intFromEnv('BILLING_GRACE_DAYS', 7, 0, 30),
    /** Hours of access past period end while a renewal webhook is in flight. */
    renewalSlackHours: intFromEnv('BILLING_RENEWAL_SLACK_HOURS', 24, 0, 72),
    /** 'period_end' (default) or 'immediate' — what a customer cancel does. */
    cancelPolicy: enumFromEnv('BILLING_CANCEL_POLICY', ['period_end', 'immediate'], 'period_end'),
    /** 'retain_access' (default) or 'revoke_on_full_refund'. */
    refundPolicy: enumFromEnv('BILLING_REFUND_POLICY', ['retain_access', 'revoke_on_full_refund'], 'retain_access'),
    /** 'suspend' (default) or 'ignore' — what an opened dispute does to access. */
    disputePolicy: enumFromEnv('BILLING_DISPUTE_POLICY', ['suspend', 'ignore'], 'suspend'),
    /** Seconds a usage reservation is held before it stops counting. */
    reservationTtlSeconds: intFromEnv('BILLING_RESERVATION_TTL_SECONDS', 600, 30, 86400),
    /** Webhook processing attempts before an event is dead-lettered. */
    webhookMaxAttempts: intFromEnv('BILLING_WEBHOOK_MAX_ATTEMPTS', 8, 1, 50),
    ...overrides,
  };
}

function isTerminal(status) {
  return TERMINAL.includes(status);
}

function toDate(v) {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v : new Date(v);
}

/**
 * Returns the instant access ends for a subscription, or null for "no access".
 * Pure: depends only on the subscription row and policy.
 */
function computeAccessUntil(sub, policy) {
  if (!sub || sub.access_hold) return null;
  if (!ACCESS_STATES.includes(sub.status)) return null;
  const slackMs = sub.cancel_at_period_end ? 0 : policy.renewalSlackHours * HOUR_MS;
  const periodEnd = toDate(sub.current_period_end);

  if (sub.status === 'trialing') {
    const end = toDate(sub.trial_end) || periodEnd;
    return end ? new Date(end.getTime() + slackMs) : null;
  }
  if (sub.status === 'active') {
    return periodEnd ? new Date(periodEnd.getTime() + slackMs) : null;
  }
  // past_due: grace from the moment the subscription first went past due.
  const since = toDate(sub.past_due_since);
  if (!since || policy.graceDays === 0) return null;
  return new Date(since.getTime() + policy.graceDays * DAY_MS);
}

/** True when the subscription grants access at `now`. */
function hasAccess(sub, policy, now = new Date()) {
  const until = computeAccessUntil(sub, policy);
  return !!until && until.getTime() > now.getTime();
}

/**
 * Decides whether a provider snapshot taken at `snapshotAt` may replace the
 * stored subscription. Returns one of:
 *   'apply'     — newer than what we have
 *   'stale'     — older than what we have (out-of-order delivery)
 *   'terminal'  — we already hold a terminal state; nothing may revive it
 *   'ambiguous' — within 1s of what we hold (provider timestamp resolution)
 *                 with different content; caller must re-read the provider
 *   'same'      — within 1s, same content
 */
function compareSnapshot(existing, snapshot, snapshotAt) {
  if (!existing) return 'apply';
  if (isTerminal(existing.status)) return 'terminal';
  const have = toDate(existing.provider_state_at).getTime();
  const got = snapshotAt.getTime();
  if (got > have) return 'apply';
  // Provider event timestamps have 1-second resolution while direct reads are
  // stamped in ms, so anything within a second of what we hold cannot be
  // ordered reliably: if it differs, re-read the provider instead of guessing.
  if (have - got >= 1000) return 'stale';
  const same = existing.status === snapshot.status
    && !!existing.cancel_at_period_end === !!snapshot.cancelAtPeriodEnd
    && sameTime(existing.current_period_end, snapshot.currentPeriodEnd);
  return same ? 'same' : 'ambiguous';
}

function sameTime(a, b) {
  const da = toDate(a);
  const db = toDate(b);
  if (!da || !db) return !da && !db;
  return da.getTime() === db.getTime();
}

module.exports = {
  STATUSES, TERMINAL, ACCESS_STATES, LIVE_STATES,
  loadPolicy, isTerminal, computeAccessUntil, hasAccess, compareSnapshot, toDate,
  DAY_MS, HOUR_MS,
};
