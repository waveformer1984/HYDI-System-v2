'use strict';

/**
 * Canonical boundary vocabulary — the deliberate answer to "what kind of
 * wall did Heidi hit". Small on purpose: a category describes the
 * boundary, never its authorization or its fix.
 *
 * A boundary object on a Human Action spec:
 *   { category,      — one of CATEGORIES (required when boundary given)
 *     capability?,   — the capability that was wanted
 *     externalSystem?, — 'stripe', 'ursula-engine', 'sepolia', ...
 *     externalObjectId? } — the provider-side id that anchors identity
 *
 * Dedup identity (Phase 6): boundaryKey(category, discriminator) —
 * deterministic, never derived from title text. The same wall observed
 * by the daemon, a webhook, a chat request, and a restart converge on
 * ONE action.
 */

const CATEGORIES = [
  'PAYMENT',
  'CREDENTIAL',
  'AUTHORIZATION',
  'EXTERNAL_SERVICE',
  'ACCOUNT_SETUP',
  'DOMAIN',
  'DEPLOYMENT',
  'FUNDING',
  'CUSTOMER_ACTION',
  'PHYSICAL_ACTION',
  'COMPLIANCE',
  'OTHER',
];

/** Legacy `type` values map onto categories so existing creators and
 *  stored records get a category without a schema migration. */
const TYPE_TO_CATEGORY = {
  'credential': 'CREDENTIAL',
  'verify_external_payment': 'PAYMENT',
  'payment': 'PAYMENT',
  'deployment': 'DEPLOYMENT',
  'deploy': 'DEPLOYMENT',
  'commercial': 'AUTHORIZATION',
  'offer': 'AUTHORIZATION',
  'approval': 'AUTHORIZATION',
  'authorization': 'AUTHORIZATION',
  'escalated-goal': 'OTHER',
};

function isValidCategory(c) {
  return CATEGORIES.includes(c);
}

/**
 * Deterministic dedup identity for a boundary. Examples:
 *   boundaryKey('PAYMENT', 'pi_123')            → 'payment:pi_123'
 *   boundaryKey('CREDENTIAL', 'rezonate-chain') → 'credential:rezonate-chain'
 *   boundaryKey('DEPLOYMENT', 'proto-yi:3010')  → 'deployment:proto-yi:3010'
 */
function boundaryKey(category, discriminator) {
  const c = String(category || 'OTHER').toUpperCase();
  if (!isValidCategory(c)) throw new Error(`unknown boundary category '${category}'`);
  const d = String(discriminator || '').trim().toLowerCase();
  if (!d) throw new Error('boundaryKey requires a discriminator — never derive identity from a title');
  return `${c.toLowerCase()}:${d}`;
}

/**
 * Normalize a spec's boundary. Explicit spec.boundary wins; otherwise
 * derive category from the legacy `type`. Always returns a normalized
 * { category, capability?, externalSystem?, externalObjectId? } — never
 * throws for a missing boundary (OTHER is the honest catch-all) but does
 * throw for an explicitly invalid category (creator bug must surface).
 */
function normalizeBoundary(spec = {}) {
  const b = spec.boundary;
  if (b && b.category !== undefined && !isValidCategory(String(b.category).toUpperCase())) {
    throw new Error(`unknown boundary category '${b.category}' — allowed: ${CATEGORIES.join(', ')}`);
  }
  const category = b?.category
    ? String(b.category).toUpperCase()
    : TYPE_TO_CATEGORY[String(spec.type || '').toLowerCase()] || 'OTHER';
  return {
    category,
    capability: b?.capability || spec.capability || null,
    externalSystem: b?.externalSystem || null,
    externalObjectId: b?.externalObjectId || null,
  };
}

module.exports = { CATEGORIES, TYPE_TO_CATEGORY, isValidCategory, boundaryKey, normalizeBoundary };
