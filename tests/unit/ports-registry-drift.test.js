'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const { servicesDrift } = require('../../lib/config/ports-registry');

const ROOT = path.join(__dirname, '..', '..');

describe('ports registry drift', () => {
  it('config/ports.json services match .ports.json mirror', () => {
    expect(servicesDrift()).toBe(false);
  });

  it('sync-ports-registry.js --check passes in CI', () => {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/sync-ports-registry.js'), '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
  });
});
