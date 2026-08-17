const { describe, it } = require('node:test');
const assert = require('node:assert');
const { OwnershipRegistryAdapter } = require('../src/adapters/ownership-registry');
const { EventBus, MemoryTransport } = require('../src/events/event-bus');

describe('OwnershipRegistryAdapter', () => {
  it('registers an asset and returns a registry id', () => {
    const transport = new MemoryTransport();
    const bus = new EventBus([transport]);
    const adapter = new OwnershipRegistryAdapter({ eventBus: bus });
    const result = adapter.registerAsset('a1', 'u1', { ownership_type: 'creator' });

    assert.strictEqual(result.ok, true);
    assert.ok(result.registryId);
    assert.strictEqual(result.record.asset_id, 'a1');
    assert.strictEqual(transport.ofType('ownership.created').length, 1);
  });

  it('rejects registration without asset id', () => {
    const adapter = new OwnershipRegistryAdapter();
    const result = adapter.registerAsset('', 'u1');
    assert.strictEqual(result.ok, false);
    assert.match(result.error, /assetId/);
  });

  it('verifies an ownership record', () => {
    const transport = new MemoryTransport();
    const bus = new EventBus([transport]);
    const adapter = new OwnershipRegistryAdapter({ eventBus: bus });
    const { registryId } = adapter.registerAsset('a1', 'u1');
    const verify = adapter.verifyOwnership(registryId);

    assert.strictEqual(verify.ok, true);
    assert.strictEqual(verify.record.status, 'verified');
    assert.strictEqual(transport.ofType('ownership.verified').length, 1);
  });

  it('rejects verification of unknown record', () => {
    const adapter = new OwnershipRegistryAdapter();
    const result = adapter.verifyOwnership('missing');
    assert.strictEqual(result.ok, false);
  });

  it('retrieves a registered record', () => {
    const adapter = new OwnershipRegistryAdapter();
    const { registryId } = adapter.registerAsset('a1', 'u1');
    const result = adapter.getOwnershipRecord(registryId);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.record.id, registryId);
  });

  it('lists records by asset', () => {
    const adapter = new OwnershipRegistryAdapter();
    adapter.registerAsset('a1', 'u1');
    adapter.registerAsset('a1', 'u2', { ownership_type: 'collaborator', percentage: 20 });
    const records = adapter.listRecordsForAsset('a1');
    assert.strictEqual(records.length, 2);
  });
});
