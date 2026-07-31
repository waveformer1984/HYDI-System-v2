const ServiceContract = require('../../../src/hydi-v3/ServiceContract');

describe('ServiceContract', () => {
  test('defines and validates a contract', () => {
    const sc = new ServiceContract();
    sc.define('ExecutionPlanner.plan', {
      version: '1.0.0',
      inputs: ['task', 'options'],
      outputs: ['success', 'plan'],
    });
    const valid = sc.validate('ExecutionPlanner.plan', { task: 'x', options: {} });
    expect(valid.valid).toBe(true);
  });

  test('rejects missing required fields', () => {
    const sc = new ServiceContract();
    sc.define('submit', { inputs: ['task'] });
    const result = sc.validate('submit', { options: {} });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('missing_fields');
  });

  test('checks version compatibility', () => {
    const sc = new ServiceContract();
    sc.define('api', { version: '2.0.0' });
    expect(sc.compatible('api', '1.0.0')).toBe(true);
    expect(sc.compatible('api', '3.0.0')).toBe(false);
  });
});
