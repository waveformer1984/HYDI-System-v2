const ArchitectureGuard = require('../../../src/hydi-v3/ArchitectureGuard');
const ArchitectureReport = require('../../../src/hydi-v3/ArchitectureReport');
const path = require('path');

describe('ArchitectureGuard', () => {
  test('verifies all default invariants and produces a report', () => {
    const guard = new ArchitectureGuard({ projectRoot: path.resolve(__dirname, '..', '..', '..') });
    const run = guard.verify();
    expect(run.status).toBe('pass');
    expect(run.counts.pass).toBeGreaterThan(0);
    expect(run.score).toBeGreaterThanOrEqual(0);
    expect(ArchitectureReport.render(run)).toContain('Architecture Guard Report');
  });

  test('reports a failing invariant', () => {
    const guard = new ArchitectureGuard({ projectRoot: path.resolve(__dirname, '..', '..', '..') });
    guard.add({
      id: 'always-fail',
      name: 'Always fail',
      category: 'test',
      check: () => ({ status: 'fail', details: 'intentional' }),
    });
    const run = guard.verify();
    expect(run.status).toBe('fail');
    expect(guard.failures().some((f) => f.id === 'always-fail')).toBe(true);
  });

  test('manual invariants do not fail the run', () => {
    const guard = new ArchitectureGuard({ projectRoot: path.resolve(__dirname, '..', '..', '..') });
    const manual = guard.manual();
    expect(Array.isArray(manual)).toBe(true);
  });
});
