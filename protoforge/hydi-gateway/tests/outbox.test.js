const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Outbox } = require('../src/outbox/outbox');

function tmpOutbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-outbox-'));
  return new Outbox({ dataDir: dir });
}

const event = { fingerprint: 'fp-1', eventId: 'e1', eventType: 'x', source: 'r', payload: {} };

describe('Outbox', () => {
  it('enqueues and removes an event', () => {
    const outbox = tmpOutbox();
    const e1 = outbox.enqueue(event);
    assert.strictEqual(e1.ok, true);
    assert.strictEqual(outbox.pendingCount(), 1);
    outbox.remove('fp-1');
    assert.strictEqual(outbox.pendingCount(), 0);
  });

  it('rejects duplicate enqueue', () => {
    const outbox = tmpOutbox();
    outbox.enqueue(event);
    const e2 = outbox.enqueue(event);
    assert.strictEqual(e2.ok, false);
    assert.match(e2.error, /Already in outbox/);
    assert.strictEqual(outbox.pendingCount(), 1);
  });

  it('returns pending events by schedule', () => {
    const outbox = tmpOutbox();
    outbox.enqueue({ ...event, fingerprint: 'fp-now' }, { nextAttempt: Date.now() - 10 });
    outbox.enqueue({ ...event, fingerprint: 'fp-later' }, { nextAttempt: Date.now() + 60000 });
    const ready = outbox.pending();
    assert.strictEqual(ready.length, 1);
    assert.strictEqual(ready[0].fingerprint, 'fp-now');
  });

  it('orders pending by nextAttempt', () => {
    const outbox = tmpOutbox();
    const now = Date.now();
    outbox.enqueue({ ...event, fingerprint: 'a' }, { nextAttempt: now - 200 });
    outbox.enqueue({ ...event, fingerprint: 'b' }, { nextAttempt: now - 100 });
    const ready = outbox.pending(now);
    assert.deepStrictEqual(ready.map(i => i.fingerprint), ['a', 'b']);
  });

  it('peek returns oldest pending', () => {
    const outbox = tmpOutbox();
    outbox.enqueue({ ...event, fingerprint: 'a' }, { nextAttempt: Date.now() + 100 });
    const oldest = outbox.peek();
    assert.strictEqual(oldest.fingerprint, 'a');
  });

  it('markFailure increases backoff', () => {
    const outbox = tmpOutbox();
    outbox.enqueue(event, { nextAttempt: Date.now() });
    const first = outbox.pending()[0];
    outbox.markFailure('fp-1', new Error('timeout'));
    const after = outbox.list()[0];
    assert.strictEqual(after.attempt, 1);
    assert.ok(after.nextAttempt > first.nextAttempt);
    assert.strictEqual(after.lastError, 'timeout');
  });

  it('markSuccess removes the event', () => {
    const outbox = tmpOutbox();
    outbox.enqueue(event);
    outbox.markSuccess('fp-1');
    assert.strictEqual(outbox.pendingCount(), 0);
  });

  it('survives crash recovery', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-crash-'));
    const outbox = new Outbox({ dataDir: dir });
    outbox.enqueue(event);
    const outbox2 = new Outbox({ dataDir: dir });
    assert.strictEqual(outbox2.pendingCount(), 1);
    assert.strictEqual(outbox2.list()[0].fingerprint, 'fp-1');
  });

  it('returns stats', () => {
    const outbox = tmpOutbox();
    outbox.enqueue(event, { nextAttempt: Date.now() - 10 });
    const stats = outbox.stats();
    assert.strictEqual(stats.total, 1);
    assert.strictEqual(stats.ready, 1);
    assert.ok(stats.oldestPendingAt);
  });
});
