'use strict';

/**
 * Paths Heidi must not modify during autonomous evolution (control plane).
 * Heidi may propose changes; normal execution rejects writes here.
 */
const PROTECTED_PREFIXES = Object.freeze([
  'lib/evolution-engine/protected-boundaries.js',
  'lib/evolution-engine/approval-contract.js',
  'lib/evolution-engine/run-store.js',
  'lib/evolution-engine/evidence-bundle.js',
  'lib/auth/',
  'lib/cost/paid-llm-gate.js',
  'lib/security/',
  '.githooks/',
  '.github/workflows/hdi-governance-gate.yml',
  'supabase/migrations/',
]);

const FORBIDDEN_WRITE_PREFIXES = Object.freeze([
  '.env',
  '.env.',
  'node_modules/',
  '.git/',
]);

/**
 * @param {string} relPath repo-relative posix path
 */
function isProtectedPath(relPath) {
  const p = relPath.replace(/\\/g, '/');
  if (FORBIDDEN_WRITE_PREFIXES.some((pre) => p === pre.replace(/\/$/, '') || p.startsWith(pre))) return true;
  return PROTECTED_PREFIXES.some((pre) => p === pre || p.startsWith(pre));
}

/**
 * @param {string} relPath
 * @param {string[]} allowedPrefixes from approval contract
 */
function isAllowedWrite(relPath, allowedPrefixes) {
  const p = relPath.replace(/\\/g, '/');
  if (isProtectedPath(p)) return false;
  if (!allowedPrefixes || !allowedPrefixes.length) return false;
  return allowedPrefixes.some((pre) => p === pre || p.startsWith(pre.endsWith('/') ? pre : `${pre}/`) || p.startsWith(pre));
}

module.exports = { PROTECTED_PREFIXES, isProtectedPath, isAllowedWrite };
