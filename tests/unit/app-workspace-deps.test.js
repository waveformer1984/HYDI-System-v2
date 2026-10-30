'use strict';

/**
 * Dev-pane dependency checks must be GET-only. The manifest's engineProbe
 * (POST /proto_iy/project) creates a real project in the engine — it is
 * documentation in the registry, never an automatic probe.
 */

const fs = require('fs');
const path = require('path');

const ROUTE = path.resolve(
  __dirname, '..', '..',
  'apps', 'ursula-frontend', 'src', 'app', 'api', 'apps', '[id]', 'route.ts'
);

describe('workspace dependency checks are read-only', () => {
  const src = fs.readFileSync(ROUTE, 'utf8');

  test('dependencies resolve through httpGet (GET) on healthUrl only', () => {
    expect(src).toMatch(/d\.healthUrl/);
    expect(src).toMatch(/await httpGet\(d\.healthUrl\)/);
    // httpGet performs a bare fetch — GET, no method override.
    const httpGetBody = src.slice(src.indexOf('function httpGet'));
    expect(httpGetBody).not.toMatch(/method:\s*['"]POST['"]/);
  });

  test('the engineProbe is never invoked by the dev-pane route', () => {
    expect(src).not.toMatch(/d\.probe|engineProbe|proto_iy\/project/);
  });

  test('the registry keeps the probe as documentation only', () => {
    const { loadPortfolio } = require('../../lib/portfolio/loader');
    const py = loadPortfolio().apps.find((a) => a.id === 'proto-yi');
    const dep = py.dependencies[0];
    expect(dep.probe.method).toBe('POST');
    expect(dep.healthUrl).toBe('http://localhost:5000/health');
  });
});
