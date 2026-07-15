'use strict';
const fs = require('fs');
const path = require('path');
const { MIGRATIONS_DIR } = require('./helpers');

// Regression guard for the incident fixed by
// 20260715210000_secure_action_worker_cron.sql: a live service_role JWT was
// committed directly into a pg_cron migration. Scans every tracked migration
// (including .sql.skip files, which still live in source control) for
// JWT-shaped literals so this class of leak can't silently reappear.

const JWT_PATTERN = /eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}/i;

describe('migrations contain no hardcoded secrets', () => {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') || f.endsWith('.sql.skip'));

  test('found at least one migration file to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files)('%s has no JWT-shaped literal', (filename) => {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
    const match = sql.match(JWT_PATTERN);
    if (match) {
      throw new Error(
        `${filename} appears to contain a hardcoded JWT-shaped secret near "${match[0].slice(0, 20)}...". ` +
          'Store secrets in Vault (see 20260715210000_secure_action_worker_cron.sql) and reference them via vault.decrypted_secrets instead.'
      );
    }
  });
});
