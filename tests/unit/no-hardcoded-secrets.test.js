'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Regression guard for a real incident (2026-07-15): a live Supabase
// service_role JWT and live Stripe secret/webhook keys were found hardcoded
// across 20+ tracked files, including a pg_cron migration. Scans every
// git-tracked file for secret-shaped literals so this class of leak can't
// silently reappear. See ISSUES_FOUND.md for the incident writeup.

const REPO_ROOT = path.resolve(__dirname, '../..');

const SECRET_PATTERNS = [
  { name: 'Supabase/JWT service-role-shaped token', re: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'Stripe live secret key', re: /sk_live_[A-Za-z0-9]{10,}/ },
  { name: 'Stripe live restricted key', re: /rk_live_[A-Za-z0-9]{10,}/ },
  { name: 'Stripe webhook signing secret', re: /whsec_[A-Za-z0-9]{10,}/ },
  { name: 'AWS access key ID', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'PEM private key block', re: /-----BEGIN[ A-Z]*PRIVATE KEY-----/ },
];

// Files intentionally exempt, with a reason -- never add an entry here
// without confirming the value is a placeholder or a key that's meant to be
// public (e.g. Supabase anon keys, which are safe client-side under RLS).
const ALLOWLIST = new Set([
  'keeper/vault/versioned-vault.js', // literal string is a "sk_live_" prefix + the word "placeholder", not a real key
  'public/client-dashboard.html', // Supabase anon key, meant to be public client-side (protected by RLS)
  'cleanup/focused-cleanup.ps1', // secret-scanner's own detection pattern list, not an embedded key
  'cleanup/quick-scan.ps1', // secret-scanner's own detection pattern list, not an embedded key
  'tests/unit/structured-logger.test.js', // fake secret-shaped fixtures used to test the logger's redaction feature, not real keys
  'scripts/scan-live-secrets.js', // secret-scanner's own detection/filter patterns, not embedded keys
]);

function listTrackedFiles() {
  const out = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

describe('repository contains no hardcoded live secrets', () => {
  const files = listTrackedFiles().filter((f) => !ALLOWLIST.has(f) && !f.startsWith('node_modules/'));

  test('found tracked files to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test('no tracked file matches a known secret pattern', () => {
    const offenders = [];

    for (const file of files) {
      const abs = path.join(REPO_ROOT, file);
      let content;
      try {
        content = fs.readFileSync(abs, 'utf8');
      } catch {
        continue; // binary or unreadable, skip
      }

      for (const { name, re } of SECRET_PATTERNS) {
        const match = content.match(re);
        if (match) {
          offenders.push(`${file}: matched "${name}" near "${match[0].slice(0, 16)}..."`);
        }
      }
    }

    if (offenders.length > 0) {
      throw new Error(
        `Found ${offenders.length} likely hardcoded secret(s):\n` +
          offenders.join('\n') +
          '\n\nStore secrets in env vars / Supabase Vault, never in tracked files. ' +
          'If this is a real key, rotate it immediately -- editing the file does not undo git-history exposure.'
      );
    }
  });
});
