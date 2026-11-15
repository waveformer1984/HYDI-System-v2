'use strict';

const fs = require('fs');
const path = require('path');
const { validateOrgProfile } = require('./org-profile');

const SENSITIVE_KEYS = ['business_email', 'entity_name', 'ein', 'phone', 'api_key', 'token'];

function redactProfileForLogs(profile) {
  if (!profile || typeof profile !== 'object') return { redacted: true };
  const clone = JSON.parse(JSON.stringify(profile));
  const scrub = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      if (SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s))) obj[k] = '[REDACTED]';
      else if (typeof obj[k] === 'object') scrub(obj[k]);
    }
  };
  scrub(clone);
  return clone;
}

function validatePrivateProfilePath(filePath) {
  if (!filePath) return { ok: false, error: 'HYDI_ORG_PROFILE_PATH_unset' };
  const resolved = path.resolve(filePath);
  const repoRoot = path.resolve(process.cwd());
  if (resolved.startsWith(repoRoot + path.sep) && resolved.includes(`${path.sep}docs${path.sep}partnerships${path.sep}`)) {
    return { ok: false, error: 'refused_committed_template_path' };
  }
  if (!fs.existsSync(resolved)) return { ok: false, error: 'profile_missing' };
  try {
    const profile = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    const v = validateOrgProfile(profile);
    if (!v.ok) return v;
    return { ok: true, profile, path: resolved, log_safe: redactProfileForLogs(profile) };
  } catch (e) {
    return { ok: false, error: 'profile_invalid', message: e instanceof Error ? e.message : 'parse_error' };
  }
}

module.exports = { validatePrivateProfilePath, redactProfileForLogs };