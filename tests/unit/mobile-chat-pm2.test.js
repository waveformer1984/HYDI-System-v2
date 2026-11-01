'use strict';

/**
 * heidi-mobile-chat (:3006) is a PM2 app, and it never comes up on the
 * tailnet without device login. Until 2026-10-31 it ran only as a
 * hand-started process that nothing restarted.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');

describe('heidi-mobile-chat under PM2', () => {
  const app = require(path.join(ROOT, 'ecosystem.config.js')).apps.find((a) => a.name === 'heidi-mobile-chat');
  const mod = require(path.join(ROOT, 'boot.config.json')).modules.find((m) => m.id === 'heidi-mobile-chat');

  it('is declared in ecosystem.config.js on :3006 with the token requirement', () => {
    expect(app).toBeDefined();
    expect(app.script).toBe('launch-heidi-mobile.js');
    for (const env of [app.env, app.env_production]) {
      expect(env.HEIDI_MOBILE_PORT).toBe('3006');
      expect(env.HEIDI_MOBILE_REQUIRE_TOKEN).toBe('1');
      expect(env.HEIDI_MOBILE_TOKEN).toBeUndefined(); // never a secret in the file
    }
    expect(app.stop_exit_codes).toContain(78);
  });

  it('boot-agent leaves it to PM2 instead of spawning or adopting it', () => {
    expect(mod.supervisor).toBe('pm2');
    expect(mod.supervisedAs).toBe('heidi-mobile-chat');
  });

  it('refuses to start (exit 78) when the token is required but missing', () => {
    const env = { ...process.env, HEIDI_MOBILE_REQUIRE_TOKEN: '1', HEIDI_MOBILE_PORT: '0' };
    delete env.HEIDI_MOBILE_TOKEN;
    const r = spawnSync(process.execPath, ['launch-heidi-mobile.js'], { cwd: ROOT, env, timeout: 20000, encoding: 'utf8', windowsHide: true });
    expect(r.status).toBe(78);
    expect(r.stderr).toMatch(/refusing to start without device login/);
  });
});
