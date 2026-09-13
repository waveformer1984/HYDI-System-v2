'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Regression coverage for the incident flagged in review: rotate-secrets.js
// used to console.log() the freshly generated break-glass token and
// service-role key candidate directly, so every terminal scrollback, CI log,
// and log aggregator that captured a run also captured live credentials.
// Secrets must now go only to a local, gitignored, 0600 file -- never stdout.

const SCRIPT_PATH = path.join(__dirname, '../../rotate-secrets.js');
const OUTPUT_PATH = path.join(__dirname, '../../.env.rotation-output');

describe('rotate-secrets.js', () => {
  afterEach(() => {
    // Best-effort cleanup only: some mounted/network filesystems reject
    // unlink even with correct Unix permissions (not a real second process
    // holding a lock). The file is gitignored either way, and each test run
    // overwrites it, so a failed cleanup here must not fail the suite.
    try {
      if (fs.existsSync(OUTPUT_PATH)) fs.unlinkSync(OUTPUT_PATH);
    } catch {
      // ignore
    }
  });

  test('does not print generated secret values to stdout', () => {
    const stdout = execFileSync('node', [SCRIPT_PATH], {
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key',
      },
    });

    expect(fs.existsSync(OUTPUT_PATH)).toBe(true);
    const written = fs.readFileSync(OUTPUT_PATH, 'utf8');

    const tokenMatch = written.match(/NEW_BREAK_GLASS_TOKEN=([0-9a-f]+)/);
    const keyMatch = written.match(/NEW_SERVICE_ROLE_KEY_CANDIDATE=([0-9a-f]+)/);
    expect(tokenMatch).toBeTruthy();
    expect(keyMatch).toBeTruthy();

    const [, breakGlassToken] = tokenMatch;
    const [, serviceRoleKeyCandidate] = keyMatch;

    // The actual generated secret values must never appear in stdout.
    expect(stdout).not.toContain(breakGlassToken);
    expect(stdout).not.toContain(serviceRoleKeyCandidate);
  });

  test('writes the secrets file with restrictive (owner-only) permissions', () => {
    execFileSync('node', [SCRIPT_PATH], {
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key',
      },
    });

    const stats = fs.statSync(OUTPUT_PATH);
    // The security-relevant property is "not readable/writable by group or
    // other" -- assert that rather than an exact owner-bit match, since
    // umask and some mounted/virtualized filesystems can affect the owner
    // execute bit without affecting group/other exposure.
    if (process.platform !== 'win32') {
      expect(stats.mode & 0o077).toBe(0);
    }
  });
});
