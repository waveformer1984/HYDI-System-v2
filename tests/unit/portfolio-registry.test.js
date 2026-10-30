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
});
