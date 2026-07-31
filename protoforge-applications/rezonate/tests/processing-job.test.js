const { describe, it } = require('node:test');
const assert = require('node:assert');
const { ProcessingJob, STATES } = require('../src/domain/processing-job');
const { EventBus, MemoryTransport } = require('../src/events/event-bus');

describe('ProcessingJob', () => {
  it('creates in queued state', () => {
    const job = new ProcessingJob({ type: 'stems', source_path: 'song.mp3' });
    assert.strictEqual(job.state, STATES.QUEUED);
    assert.ok(job.id);
  });

  it('transitions through the happy path', () => {
    const transport = new MemoryTransport();
    const bus = new EventBus([transport]);
    const job = new ProcessingJob({ type: 'stems', source_path: 'song.mp3' }, { eventBus: bus });
    job.transition(STATES.STEMS_PROCESSING);
    assert.strictEqual(job.state, STATES.STEMS_PROCESSING);
    job.transition(STATES.ANALYZING);
    assert.strictEqual(job.state, STATES.ANALYZING);
    job.transition(STATES.COMPLETED);
    assert.strictEqual(job.state, STATES.COMPLETED);
    const events = transport.ofType('processing.completed');
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].payload.entityId, job.id);
    assert.strictEqual(events[0].payload.previousState, STATES.ANALYZING);
    assert.strictEqual(events[0].payload.newState, STATES.COMPLETED);
  });

  it('rejects invalid transitions', () => {
    const job = new ProcessingJob({ type: 'stems' });
    assert.throws(() => job.transition(STATES.COMPLETED), /Cannot transition/);
  });

  it('rejects unknown state', () => {
    assert.throws(() => new ProcessingJob({ state: 'mystery' }), /Invalid state/);
  });

  it('captures failures', () => {
    const transport = new MemoryTransport();
    const bus = new EventBus([transport]);
    const job = new ProcessingJob({ type: 'generate', prompt: 'test' }, { eventBus: bus });
    job.fail('python not found');
    assert.strictEqual(job.state, STATES.FAILED);
    assert.strictEqual(job.error, 'python not found');
    assert.strictEqual(transport.ofType('processing.failed').length, 1);
  });

  it('emits processing.job.created data shape', () => {
    const transport = new MemoryTransport();
    const bus = new EventBus([transport]);
    const job = new ProcessingJob({ type: 'stems', source_path: 'a.wav' }, { eventBus: bus });
    job.transition(STATES.ANALYZING);
    const event = transport.ofType('analysis.started')[0];
    assert.ok(event);
    assert.strictEqual(event.payload.entityId, job.id);
    assert.ok(event.payload.timestamp);
  });
});
