'use strict';

/**
 * Single-supervisor regression.
 *
 * Live incident 2026-10-25: an orphaned tsx child (PM2-spawned, untracked)
 * held .revenue-autopilot-tick.lock; every PM2 fork exited on
 * "Another instance is already running" and PM2 restart-looped it ~1,700
 * times. The same script is also declared in boot.config.json — two
 * supervisors for a process-lock-guarded script. boot entries that PM2
 * already owns must be marked supervisedAs (metadata only — boot never
 * spawns them), exactly like heidi-web and rezonate-app.
 */

const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const boot = require(path.join(ROOT, 'boot.config.json'));
const ecosystem = require(path.join(ROOT, 'ecosystem.config.js'));

function pm2Names() {
  return new Set((ecosystem.apps || []).map((a) => a && a.name).filter(Boolean));
}

function bootProcessFor(script) {
  return (boot.modules || []).find(
    (m) => m && m.type === 'process' && Array.isArray(m.args) && m.args.join(' ').includes(script),
  );
}

describe('single supervisor for lock-guarded processes', () => {
  it('revenue-autopilot-tick is declared PM2-supervised, not boot-spawned', () => {
    const mod = bootProcessFor('revenue-autopilot-tick.ts');
    expect(mod).toBeTruthy();
    expect(pm2Names()).toContain('hydi-revenue-autopilot-tick');
    expect(mod.supervisedAs).toBe('hydi-revenue-autopilot-tick');
  });

  it('no enabled boot process duplicates a PM2-owned app without supervisedAs', () => {
    const names = pm2Names();
    const dupes = (boot.modules || []).filter(
      (m) =>
        m &&
        m.type === 'process' &&
        m.enabled !== false &&
        !m.supervisedAs &&
        Array.isArray(m.args) &&
        (ecosystem.apps || []).some((a) => a && a.args && String(a.args).includes(m.args[m.args.length - 1])),
    ).map((m) => m.id);
    expect(dupes).toEqual([]);
  });
});
