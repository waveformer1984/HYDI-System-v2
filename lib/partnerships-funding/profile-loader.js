'use strict';

const fs = require('fs');
const path = require('path');
const { validateOrgProfile } = require('./org-profile');

/**
 * Approved org profiles must live outside the public repo (operator machine path).
 * The committed template is never loaded as an approved profile.
 */
function loadApprovedOrgProfileFromEnv() {
  const file = process.env.HYDI_ORG_PROFILE_PATH;
  if (!file) return { ok: false, error: 'HYDI_ORG_PROFILE_PATH_unset' };
  const resolved = path.resolve(file);
  const repoRoot = path.resolve(process.cwd());
  if (resolved.startsWith(repoRoot + path.sep) && resolved.includes(`${path.sep}docs${path.sep}partnerships${path.sep}`)) {
    return { ok: false, error: 'refused_committed_template_path', classification: 'REQUIRES_OPERATOR_APPROVAL' };
  }
  try {
    const profile = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    const v = validateOrgProfile(profile);
    if (!v.ok) return v;
    return { ok: true, profile, source: 'env_file' };
  } catch (e) {
    return { ok: false, error: 'profile_unreadable', message: e instanceof Error ? e.message : 'read_failed' };
  }
}

module.exports = { loadApprovedOrgProfileFromEnv };