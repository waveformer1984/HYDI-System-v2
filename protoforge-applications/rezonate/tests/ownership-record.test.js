const { describe, it } = require('node:test');
const assert = require('node:assert');
const { OwnershipRecord, OWNERSHIP_TYPES, OWNERSHIP_STATUSES } = require('../src/domain/ownership-record');
const { EventBus, MemoryTransport } = require('../src/events/event-bus');

describe('OwnershipRecord', () => {
  it('creates a valid ownership record', () => {
    const record = new OwnershipRecord({
      asset_id: 'a1',
      creator_id: 'u1',
      ownership_type: 'creator',
      percentage: 100
    });
    assert.strictEqual(record.status, 'draft');
    assert.strictEqual(record.percentage, 100);
    assert.strictEqual(record.ownershipType, 'creator');
  });

  it('rejects invalid ownership type', () => {
    assert.throws(() => new OwnershipRecord({
      asset_id: 'a1',
      creator_id: 'u1',
      ownership_type: 'investor'
    }), /ownership_type must be one of/);
  });

  it('rejects percentage out of range', () => {
    assert.throws(() => new OwnershipRecord({
      asset_id: 'a1',
      creator_id: 'u1',
      percentage: 150
    }), /percentage must be between/);
  });

  it('transitions from draft to verified', () => {
    const transport = new MemoryTransport();
    const bus = new EventBus([transport]);
    const record = new OwnershipRecord({ asset_id: 'a1', creator_id: 'u1' }, { eventBus: bus });
    record.transition('verified');
    assert.strictEqual(record.status, 'verified');
    const events = transport.ofType('ownership.created');
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].payload.newStatus, 'verified');
  });

  it('rejects invalid transitions', () => {
    const record = new OwnershipRecord({ asset_id: 'a1', creator_id: 'u1' });
    record.transition('verified');
    assert.throws(() => record.transition('draft'), /Cannot transition/);
  });

  it('validates a split across multiple records', () => {
    const records = [
      { percentage: 60 },
      { percentage: 40 }
    ];
    const total = OwnershipRecord.validateSplit(records);
    assert.strictEqual(total, 100);
  });

  it('rejects splits exceeding 100%', () => {
    const records = [
      { percentage: 60 },
      { percentage: 50 }
    ];
    assert.throws(() => OwnershipRecord.validateSplit(records), /cannot exceed 100%/);
  });

  it('exports constants', () => {
    assert.ok(OWNERSHIP_TYPES.includes('license'));
    assert.ok(OWNERSHIP_STATUSES.includes('registered'));
  });
});
