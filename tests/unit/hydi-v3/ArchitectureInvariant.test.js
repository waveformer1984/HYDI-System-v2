const ArchitectureInvariant = require('../../../src/hydi-v3/ArchitectureInvariant');

describe('ArchitectureInvariant', () => {
  test('passes when check returns pass', () => {
    const inv = new ArchitectureInvariant({
      id: 't1',
      name: 'Test pass',
      check: () => ({ status: 'pass', details: 'ok' }),
    });
    const result = inv.verify({});
    expect(result.status).toBe('pass');
    expect(result.manual).toBe(false);
  });

  test('fails when check returns fail', () => {
    const inv = new ArchitectureInvariant({
      id: 't2',
      name: 'Test fail',
      check: () => ({ status: 'fail', details: 'broken' }),
    });
    const result = inv.verify({});
    expect(result.status).toBe('fail');
    expect(result.details).toBe('broken');
  });

  test('reports manual when no check configured', () => {
    const inv = new ArchitectureInvariant({ id: 't3', name: 'Manual' });
    const result = inv.verify({});
    expect(result.status).toBe('manual');
    expect(result.manual).toBe(true);
  });

  test('catches check errors and reports error status', () => {
    const inv = new ArchitectureInvariant({
      id: 't4',
      name: 'Throws',
      check: () => { throw new Error('boom'); },
    });
    const result = inv.verify({});
    expect(result.status).toBe('error');
    expect(result.details).toContain('boom');
  });
});
