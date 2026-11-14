'use strict';

/**
 * PM2 workers must not dirty the tracked tree — auto-deploy requires a clean
 * clean-main. Status files belong under .runtime/ or paths listed in .gitignore.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

/** Literal path segments PM2-managed scripts are allowed to write (must be gitignored). */
const PM2_RUNTIME_WRITE_TARGETS = [
  '.runtime/',
  '.observatory/',
  '.heidi-daemon-status.json',
  '.heidi-daemon-audit.jsonl',
  '.heidi-daemon.lock',
  '.model-prep-executor-status.json',
  '.next/',
  '.next-staging/',
  '.next-prev/',
  '.next-failed/',
];

function isIgnored(rel) {
  try {
    execFileSync('git', ['check-ignore', '-q', rel], { cwd: ROOT, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function pm2EntryScripts() {
  const eco = require(path.join(ROOT, 'ecosystem.config.js'));
  return (eco.apps || []).map((app) => {
    const base = app.cwd ? path.resolve(ROOT, app.cwd) : ROOT;
    return path.resolve(base, app.script || '');
  }).filter((f) => fs.existsSync(f));
}

describe('ecosystem PM2 write targets stay gitignored', () => {
  it('every known runtime status prefix is ignored by git', () => {
    for (const rel of PM2_RUNTIME_WRITE_TARGETS) {
      const probe = rel.endsWith('/') ? `${rel}.write-probe` : rel;
      expect(isIgnored(probe)).toBe(true);
    }
  });

  it('every ecosystem.config.js script exists (smoke)', () => {
    const scripts = pm2EntryScripts();
    expect(scripts.length).toBeGreaterThan(5);
    for (const s of scripts) {
      expect(fs.existsSync(s)).toBe(true);
    }
  });
});
