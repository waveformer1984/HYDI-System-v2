'use strict';

const { getCapabilityRegistry } = require('../../lib/heidi/CapabilityRegistry');
const { invokeResourceCapability } = require('../../lib/resource-acquisition/heidi-executors');

describe('Heidi resource capabilities', () => {
  test('registry lists resource.* capabilities', () => {
    const reg = getCapabilityRegistry();
    for (const id of ['resource.discover', 'resource.rank', 'resource.validate_profile']) {
      expect(reg.get(id)?.capabilityId).toBe(id);
    }
  });

  test('invokeResourceCapability resource.discover executes', async () => {
    process.env.HYDI_RESOURCE_TEST_HARNESS = '1';
    const r = await invokeResourceCapability('resource.discover', { includeFixtures: false });
    expect(r.executed).toBe(true);
    expect(r.capabilityId).toBe('resource.discover');
    expect(r.result?.intake_count).toBeGreaterThanOrEqual(40);
  });
});