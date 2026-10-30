'use strict';

const { loadPortfolio, pm2Managed } = require('../../lib/portfolio/loader');

describe('portfolio registry', () => {
  test('loads and validates the seeded registry', () => {
    const r = loadPortfolio();
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.apps.length).toBe(3);
  });

  test('every app has a valid kind', () => {
    const r = loadPortfolio();
    for (const a of r.apps) expect(['local', 'suite', 'external']).toContain(a.kind);
  });

  test('rezonate-app is the first local PM2 app', () => {
    const r = loadPortfolio();
    const rez = r.apps.find((a) => a.id === 'rezonate-app');
    expect(rez).toMatchObject({ kind: 'local', pm2Name: 'rezonate-app', port: 3001, embeddable: true });
  });

  test('proto-yi carries its suite-engine dependency', () => {
    const r = loadPortfolio();
    const py = r.apps.find((a) => a.id === 'proto-yi');
    expect(py.dependencies[0]).toMatchObject({ name: 'ursula-suite-proto_iy', healthUrl: 'http://localhost:5000/health' });
    expect(py.dependencies[0].probe.method).toBe('POST');
  });

  test('pm2Managed returns only entries with a pm2Name', () => {
    const managed = pm2Managed();
    expect(managed.every((a) => a.pm2Name)).toBe(true);
    expect(managed.map((a) => a.pm2Name)).toContain('rezonate-app');
  });

  test('an unreadable file reports ok:false, never throws', () => {
    const r = loadPortfolio('C:\\nonexistent\\portfolio.json');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/cannot read/);
  });

  test('live stripeMode refuses a test identity; only test passes', () => {
    const { canIssueTestIdentity } = require('../../lib/portfolio/loader');
    expect(canIssueTestIdentity({ stripeMode: 'live-via-main-app' })).toBe(false);
    expect(canIssueTestIdentity({ stripeMode: 'none' })).toBe(false);
    expect(canIssueTestIdentity({ stripeMode: 'test' })).toBe(true);
    expect(canIssueTestIdentity({})).toBe(false);
  });

  test('every local healthUrl path exists in that app\'s router — no silent drift', () => {
    const fs = require('fs');
    const path = require('path');
    const ROUTERS = {
      'rezonate-app': 'protoforge-applications/rezonate/src/api/router.js',
      'proto-yi': 'protoforge-applications/proto-yi/src/api/router.js',
    };
    const r = loadPortfolio();
    for (const [id, routerFile] of Object.entries(ROUTERS)) {
      const app = r.apps.find((a) => a.id === id);
      expect(app).toBeDefined();
      const routePath = new URL(app.healthUrl).pathname;
      const src = fs.readFileSync(path.resolve(__dirname, '..', '..', routerFile), 'utf8');
      // The router must literally register the health path (plain text
      // match: nothing from the URL is ever turned into a regex).
      expect(src.includes(`app.get('${routePath}'`)).toBe(true);
    }
  });
});
