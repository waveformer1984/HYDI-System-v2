const { describe, it } = require('node:test');
const assert = require('node:assert');
const { AudioAsset, ASSET_TYPES, OWNERSHIP_STATUSES } = require('../src/domain/audio-asset');
const { EventBus, MemoryTransport } = require('../src/events/event-bus');

describe('AudioAsset', () => {
  it('creates a valid audio asset', () => {
    const asset = new AudioAsset({
      project_id: 'p1',
      type: 'vocal',
      file_path: 'C:\\audio\\vocal.wav',
      bpm: 120,
      key: 'C minor'
    });
    assert.strictEqual(asset.type, 'vocal');
    assert.strictEqual(asset.bpm, 120);
    assert.strictEqual(asset.key, 'C minor');
    assert.strictEqual(asset.ownershipStatus, 'draft');
  });

  it('rejects invalid asset type', () => {
    assert.throws(() => new AudioAsset({ type: 'drumkit' }), /asset type must be one of/);
  });

  it('rejects invalid bpm', () => {
    assert.throws(() => new AudioAsset({ bpm: -5 }), /bpm must be/);
  });

  it('rejects invalid ownership status', () => {
    assert.throws(() => new AudioAsset({ ownership_status: 'sold' }), /ownership status must be one of/);
  });

  it('updates metadata and emits event', () => {
    const transport = new MemoryTransport();
    const bus = new EventBus([transport]);
    const asset = new AudioAsset({ type: 'stem', file_path: 'a.wav' }, { eventBus: bus });
    asset.updateMetadata({ tag: 'uplifting' });
    assert.strictEqual(asset.metadata.tag, 'uplifting');
    const events = transport.ofType('audio.asset.updated');
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].payload.entityId, asset.id);
  });

  it('transitions ownership status', () => {
    const transport = new MemoryTransport();
    const bus = new EventBus([transport]);
    const asset = new AudioAsset({ type: 'sample' }, { eventBus: bus });
    asset.setOwnershipStatus('registered');
    assert.strictEqual(asset.ownershipStatus, 'registered');
    const events = transport.ofType('ownership.status_changed');
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].payload.metadata.previous, 'draft');
    assert.strictEqual(events[0].payload.metadata.new, 'registered');
  });

  it('exposes constant type and ownership arrays', () => {
    assert.ok(ASSET_TYPES.includes('stem'));
    assert.ok(OWNERSHIP_STATUSES.includes('minted'));
  });
});
