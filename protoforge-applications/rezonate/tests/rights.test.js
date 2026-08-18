const { describe, it } = require('node:test');
const assert = require('node:assert');
const { Rights, RIGHT_TYPES } = require('../src/domain/rights');
const { EventBus, MemoryTransport } = require('../src/events/event-bus');

describe('Rights', () => {
  it('creates rights with composition and sample entries', () => {
    const rights = new Rights({
      asset_id: 'a1',
      rights: [
        { type: 'composition', owner: 'u1', percentage: 50 },
        { type: 'sample', source: 'sample-pack-1', license: 'royalty-free' }
      ]
    });
    assert.strictEqual(rights.rights.length, 2);
    assert.ok(rights.hasSampleSources());
  });

  it('rejects invalid right type', () => {
    assert.throws(() => new Rights({
      asset_id: 'a1',
      rights: [{ type: 'invalid' }]
    }), /right type must be one of/);
  });

  it('adds a right and emits event', () => {
    const transport = new MemoryTransport();
    const bus = new EventBus([transport]);
    const rights = new Rights({ asset_id: 'a1' }, { eventBus: bus });
    rights.addRight({ type: 'master', owner: 'u1', percentage: 100 });
    assert.strictEqual(rights.rights.length, 1);
    assert.strictEqual(transport.ofType('rights.registered').length, 1);
  });

  it('adds collaborators and validates split', () => {
    const transport = new MemoryTransport();
    const bus = new EventBus([transport]);
    const rights = new Rights({ asset_id: 'a1' }, { eventBus: bus });
    rights.addCollaborator({ creator_id: 'u1', percentage: 70 });
    rights.addCollaborator({ creator_id: 'u2', percentage: 30 });
    assert.strictEqual(rights.collaborators.length, 2);
    assert.strictEqual(transport.ofType('collaborator.added').length, 2);
    assert.strictEqual(transport.ofType('royalty.created').length, 2);
  });

  it('rejects collaborator split exceeding 100%', () => {
    const rights = new Rights({ asset_id: 'a1' });
    rights.addCollaborator({ creator_id: 'u1', percentage: 70 });
    assert.throws(() => rights.addCollaborator({ creator_id: 'u2', percentage: 40 }), /cannot exceed 100%/);
  });

  it('requires collaborator identity', () => {
    const rights = new Rights({ asset_id: 'a1' });
    assert.throws(() => rights.addCollaborator({ percentage: 20 }), /collaborator must have/);
  });

  it('exposes right types', () => {
    assert.ok(RIGHT_TYPES.includes('synchronization'));
  });
});
