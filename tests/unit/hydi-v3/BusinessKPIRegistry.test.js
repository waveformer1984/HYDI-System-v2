'use strict';

const BusinessKPIRegistry = require('../../../src/hydi-v3/BusinessKPIRegistry');

describe('BusinessKPIRegistry', () => {
  it('lists default KPIs without hardcoding their values', () => {
    const registry = new BusinessKPIRegistry();
    const kpis = registry.list();
    expect(kpis.length).toBeGreaterThan(0);
    expect(kpis.map((k) => k.id)).toEqual(expect.arrayContaining(['revenue', 'engineeringVelocity', 'manufacturingThroughput']));
  });

  it('registers a custom KPI with an evaluator', () => {
    const registry = new BusinessKPIRegistry();
    registry.register({ id: 'custom', name: 'Custom', unit: 'count', target: 10 }, (ctx) => ctx.customValue || 0);
    const result = registry.evaluate('custom', { customValue: 7 });
    expect(result.value).toBe(7);
    expect(result.status).toBe('below-target');
  });

  it('evaluates KPIs from context when no evaluator is provided', () => {
    const registry = new BusinessKPIRegistry();
    const result = registry.evaluate('revenue', { revenue: 5000 });
    expect(result.value).toBe(5000);
    expect(result.unit).toBe('USD');
  });

  it('returns unknown status when no value is available', () => {
    const registry = new BusinessKPIRegistry();
    const result = registry.evaluate('revenue', {});
    expect(result.value).toBeNull();
    expect(result.status).toBe('unknown');
  });

  it('evaluates all registered KPIs at once', () => {
    const registry = new BusinessKPIRegistry();
    const all = registry.evaluateAll({ revenue: 100, engineeringVelocity: 5 });
    expect(all.revenue.value).toBe(100);
    expect(all.engineeringVelocity.value).toBe(5);
  });
});
