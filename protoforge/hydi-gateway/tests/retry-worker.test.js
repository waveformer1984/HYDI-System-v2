const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Outbox } = require('../src/outbox/outbox');
const { RetryWorker } = require('../src/outbox/retry-worker');

function tmpOutbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-retry-'));
  return new Outbox({ dataDir: dir });
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

describe('Retry Worker', () => {
  it('delivers a pending event and removes it', async () => {
    const outbox = tmpOutbox();
    outbox.enqueue({ fingerprint: 'fp-1', eventId: 'e1', eventType: 'x', source: 'r', payload: {} }, { nextAttempt: Date.now() });
    const worker = new RetryWorker(outbox, async () => ({ ok: true }));
    worker._tick();
    await wait(10);
    assert.strictEqual(outbox.pendingCount(), 0);
    assert.strictEqual(worker.stats.successes, 1);
    worker.stop();
  });

  it('requeues on delivery failure', async () => {
    const outbox = tmpOutbox();
    outbox.enqueue({ fingerprint: 'fp-1', eventId: 'e1', eventType: 'x', source: 'r', payload: {} }, { nextAttempt: Date.now() });
    const worker = new RetryWorker(outbox, async () => ({ ok: false, error: 'down' }));
    worker._tick();
    await wait(10);
    assert.strictEqual(outbox.pendingCount(), 1);
    assert.strictEqual(worker.stats.failures, 1);
    const item = outbox.list()[0];
    assert.strictEqual(item.attempt, 1);
    assert.strictEqual(item.lastError, 'down');
    worker.stop();
  });

  it('stops and starts', async () => {
    const outbox = tmpOutbox();
    const worker = new RetryWorker(outbox, async () => ({ ok: true }));
    worker.start();
    assert.strictEqual(worker.running, true);
    worker.stop();
    assert.strictEqual(worker.running, false);
  });

  it('tracks last run time', async () => {
    const outbox = tmpOutbox();
    const worker = new RetryWorker(outbox, async () => ({ ok: true }));
    worker._tick();
    assert.ok(worker.stats.lastRun);
  });
});
