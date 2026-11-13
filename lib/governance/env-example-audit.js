'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/** Keys that must be documented in .env.example for mobile ops / governance. */
const REQUIRED_DOCUMENTATION = [
  'HEIDI_ADMIN_TOKEN',
  'HEIDI_ADVISORY_ALLOWED_ORIGINS',
  'HEIDI_ALLOW_EXEC',
  'HEIDI_BIND_HOST',
  'HEIDI_ADVISORY_PORT',
  'HEIDI_MOBILE_TOKEN',
  'HEIDI_MOBILE_PORT',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

function auditEnvExample(root = ROOT) {
  const file = path.join(root, '.env.example');
  if (!fs.existsSync(file)) {
    return { ok: false, missing: REQUIRED_DOCUMENTATION, detail: '.env.example missing' };
  }
  const text = fs.readFileSync(file, 'utf8');
  const missing = REQUIRED_DOCUMENTATION.filter((k) => !text.includes(k));
  const execDocumentsFalse =
    /HEIDI_ALLOW_EXEC=false/.test(text)
    || (/HEIDI_ALLOW_EXEC/.test(text) && /unset|off|not set|refus/i.test(text));
  if (!execDocumentsFalse) {
    missing.push('HEIDI_ALLOW_EXEC (must document default-off)');
  }
  return { ok: missing.length === 0, missing, detail: missing.length ? `missing: ${missing.join(', ')}` : 'complete' };
}

module.exports = { auditEnvExample, REQUIRED_DOCUMENTATION };
