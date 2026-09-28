/**
 * Ecosystem ownership declaration tests.
 *
 * heidi-web-standalone was the live PM2 owner of port 3000 but was never
 * declared in ecosystem.config.js -- it existed only in PM2's saved
 * process list, so a resurrect/regenerate could lose the runtime owner.
 * These tests lock the repository declaration as the source of truth.
 *
 * They deliberately do NOT touch live PM2 state -- they read files only.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const ecosystem = require(path.join(ROOT, 'ecosystem.config.js'));
const bootConfig = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'boot.config.json'), 'utf8')
);

describe('ecosystem heidi-web-standalone declaration', () => {
  const entries = ecosystem.apps.filter((a) => a.name === 'heidi-web-standalone');
  const entry = entries[0];

  test('exactly one heidi-web-standalone declaration exists', () => {
    expect(entries.length).toBe(1);
  });

  test('PM2 name matches boot.config supervisedAs', () => {
    const heidiWeb = bootConfig.modules.find((m) => m.id === 'heidi-web');
    expect(heidiWeb.supervisedAs).toBe('heidi-web-standalone');
    expect(entry.name).toBe(heidiWeb.supervisedAs);
  });

  test('no other ecosystem entry claims port 3000', () => {
    for (const app of ecosystem.apps) {
      if (app.name === 'heidi-web-standalone') continue;
      const args = String(app.args || '');
      const env = app.env || {};
      const claimsPort =
        /(\s|--)?(port|P|PORT)[=\s]*3000\b/i.test(args) ||
        String(env.PORT || '') === '3000';
      expect(claimsPort).toBe(false);
    }
  });

  test('canonical service id remains heidi-web in boot.config', () => {
    const ids = bootConfig.modules.map((m) => m.id);
    expect(ids).toContain('heidi-web');
    expect(ids).not.toContain('heidi-web-standalone');
  });

  test('the declared script is the authoritative Next.js dev path', () => {
    expect(entry.script).toContain('next');
    expect(String(entry.args)).toMatch(/dev/);
    expect(String(entry.args)).toMatch(/3000/);
  });

  test('cwd is the repository root', () => {
    expect(entry.cwd).toBe(ROOT);
  });

  test('fork mode, single instance, autorestart on', () => {
    expect(entry.exec_mode).toBe('fork');
    expect(entry.instances).toBe(1);
    expect(entry.autorestart).toBe(true);
  });
});

describe('boot-agent still refuses to spawn the PM2-owned module', () => {
  test('heidi-web is externally supervised', () => {
    const heidiWeb = bootConfig.modules.find((m) => m.id === 'heidi-web');
    const { isExternallySupervised } = require('../../scripts/module-ownership');
    expect(isExternallySupervised(heidiWeb)).toBe(true);
  });
});

describe('recovery still resolves the PM2 owner', () => {
  test('pm2NameFor(heidi-web) === heidi-web-standalone', () => {
    const { pm2NameFor } = require('../../lib/operational/DependencyAwareRestartExecutor');
    expect(pm2NameFor('heidi-web')).toBe('heidi-web-standalone');
  });
});
