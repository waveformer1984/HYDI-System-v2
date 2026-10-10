/**
 * Regression test for the Supabase CLI version contract.
 *
 * hydi-boot crash-looped ~1,300 times because REQUIRED_SUPABASE_CLI_VERSION
 * in scripts/preflight.js was a second, manual pin that dependabot's weekly
 * devDependency bumps never updated (pin 2.107.0 vs declared 2.120.0).
 * The contract now derives from package.json — the manifest is the single
 * source of truth. This test fails if a literal pin is reintroduced.
 */

const fs = require('fs');
const path = require('path');

const { requiredSupabaseCliVersion, FALLBACK_SUPABASE_CLI_VERSION } = require('../../scripts/preflight');

const ROOT = path.resolve(__dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));

describe('supabase CLI version contract', () => {
  it('derives the required version from devDependencies.supabase', () => {
    const declared = manifest.devDependencies.supabase;
    expect(typeof declared).toBe('string');
    expect(requiredSupabaseCliVersion()).toBe(declared.replace(/^[~^]/, ''));
  });

  it('manifest and lockfile agree on the declared version', () => {
    const locked = lock.packages['node_modules/supabase'].version;
    expect(locked).toBe(manifest.devDependencies.supabase.replace(/^[~^]/, ''));
  });

  it('strips range operators but keeps the declared intent', () => {
    expect(requiredSupabaseCliVersion('^2.130.0')).toBe('2.130.0');
    expect(requiredSupabaseCliVersion('~3.0.1')).toBe('3.0.1');
    expect(requiredSupabaseCliVersion('2.120.0')).toBe('2.120.0');
  });

  it('falls back to the explicit constant only when the manifest is unreadable', () => {
    expect(requiredSupabaseCliVersion(undefined) === FALLBACK_SUPABASE_CLI_VERSION ||
           requiredSupabaseCliVersion(undefined) === manifest.devDependencies.supabase.replace(/^[~^]/, '')).toBe(true);
    expect(requiredSupabaseCliVersion('')).toBe(FALLBACK_SUPABASE_CLI_VERSION);
    expect(requiredSupabaseCliVersion(null)).toBe(FALLBACK_SUPABASE_CLI_VERSION);
  });

  it('the CLI check has no reintroduced literal pin', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'preflight.js'), 'utf8');
    // The check must compare against requiredSupabaseCliVersion(), never a
    // hardcoded version string in the comparison itself.
    const checkBody = src.slice(src.indexOf('async function checkSupabaseCli'));
    expect(checkBody).toContain('requiredSupabaseCliVersion()');
    expect(checkBody).not.toMatch(/version === '[0-9]/);
  });
});
