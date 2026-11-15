'use strict';

const UNKNOWN = 'UNKNOWN';

function isUnknown(value) {
  if (value == null) return true;
  if (value === UNKNOWN) return true;
  if (typeof value === 'string' && value.trim().toUpperCase() === UNKNOWN) return true;
  return false;
}

/**
 * Owner-approved facts only. Callers must not infer missing fields.
 */
function validateOrgProfile(profile) {
  if (!profile || typeof profile !== 'object') return { ok: false, error: 'invalid_profile' };
  const requiredSections = ['legal', 'classification', 'sharing'];
  for (const s of requiredSections) {
    if (!profile[s]) return { ok: false, error: `missing_section_${s}` };
  }
  if (!profile.approved_by_owner) {
    return { ok: false, error: 'not_owner_approved', classification: 'REQUIRES_OPERATOR_APPROVAL' };
  }
  return { ok: true, profile };
}

function profileFact(profile, path) {
  const parts = path.split('.');
  let cur = profile;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return { value: null, unknown: true };
    cur = cur[p];
  }
  return { value: cur, unknown: isUnknown(cur) };
}

module.exports = { UNKNOWN, isUnknown, validateOrgProfile, profileFact };