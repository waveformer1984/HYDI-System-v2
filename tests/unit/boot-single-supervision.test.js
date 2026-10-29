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
// The function boot-agent actually consults before spawning a module.
const { isExternallySupervised, supervisedAs } = require(path.join(ROOT, 'scripts', 'module-ownership'));
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
    // supervisedAs alone is metadata: boot-agent only refuses to spawn a
    // module when supervisor === 'pm2' (scripts/module-ownership.js). Until
    // 2026-10-29 this entry had supervisedAs but no supervisor, so boot still
    // spawned a second copy next to PM2's -- the incident above, still live.
    expect(isExternallySupervised(mod)).toBe(true);
    expect(supervisedAs(mod)).toBe('hydi-revenue-autopilot-tick');
  });

  it('every boot module that names a PM2 app is one boot-agent will not spawn', () => {
    const names = pm2Names();
    const marked = (boot.modules || []).filter((m) => m && m.supervisedAs);
    expect(marked.length).toBeGreaterThan(0);
    for (const m of marked) {
      expect({ id: m.id, external: isExternallySupervised(m) }).toEqual({ id: m.id, external: true });
      expect(names).toContain(supervisedAs(m));
    }
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
