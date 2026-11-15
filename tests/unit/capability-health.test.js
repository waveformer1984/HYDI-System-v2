'use strict';

const {
  buildDistributedCapabilityMatrix,
  assertCapabilityPreconditions,
} = require('../../lib/execution-fabric/capability-health');

describe('capability-health', () => {
  it('lists distributed → fabric mappings with registration status', () => {
    const m = buildDistributedCapabilityMatrix();
    expect(m.mapping_count).toBeGreaterThan(0);
    expect(m.rows.every((r) => r.distributed_action && r.fabric_capability_id)).toBe(true);
    const health = m.rows.find((r) => r.fabric_capability_id === 'health.check');
    expect(health.execution_ready).toBe(true);
  });

  it('assertCapabilityPreconditions requires confirm when needed', () => {
    const needs = assertCapabilityPreconditions('tests.run', { confirmed: false });
    expect(needs.ok).toBe(false);
    expect(needs.code).toBe('CONFIRMATION_REQUIRED');
  });
});