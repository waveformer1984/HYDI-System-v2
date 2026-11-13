'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const script = path.join(ROOT, 'scripts/seed-divisions.js');

describe('seed-divisions remote guard', () => {
  it('refuses cloud SUPABASE_URL without --allow-remote', () => {
    const r = spawnSync(process.execPath, [script, '--dry-run'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'test-key',
      },
    });
    expect(r.status).toBe(2);
    expect(r.stderr + r.stdout).toMatch(/refusing non-local/);
    expect(r.stdout).toMatch(/target host/);
  });

  it('allows local URL', () => {
    const r = spawnSync(process.execPath, [script, '--dry-run'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_URL: 'http://127.0.0.1:54321',
        SUPABASE_SERVICE_ROLE_KEY: 'test-key',
      },
    });
    expect(r.status).toBe(0);
  });
});
