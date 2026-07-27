import { MemoryJobQueue } from '../../lib/jobs/stores/MemoryJobQueue';
import { Worker } from '../../lib/jobs/Worker';

describe('MemoryJobQueue', () => {
  let queue: MemoryJobQueue;

  beforeEach(() => {
    queue = new MemoryJobQueue();
  });

  test('enqueues and dequeues a job', async () => {
    const id = await queue.enqueue('test', { x: 1 });
    const job = await queue.dequeue('test', 'worker-1');

    expect(job).not.toBeNull();
    expect(job?.id).toBe(id);
    expect(job?.status).toBe('processing');
    expect(job?.attempts).toBe(1);
  });

  test('dequeues highest priority job first', async () => {
    await queue.enqueue('test', { low: true }, { priority: 0 });
    await queue.enqueue('test', { high: true }, { priority: 9 });
    await queue.enqueue('test', { mid: true }, { priority: 5 });

    const job = await queue.dequeue('test', 'worker-1');
    expect(job?.payload).toEqual({ high: true });
  });

  test('retries failed jobs up to maxAttempts then moves to DLQ', async () => {
    const id = await queue.enqueue('test', {}, { maxAttempts: 2 });

    const first = await queue.dequeue('test', 'worker-1');
    await queue.complete(first!.id, 'worker-1', false, 'error');

    const second = await queue.dequeue('test', 'worker-1');
    expect(second?.id).toBe(id);
    expect(second?.status).toBe('processing');
    expect(second?.attempts).toBe(2);

    await queue.complete(second!.id, 'worker-1', false, 'error again');

    const third = await queue.dequeue('test', 'worker-1');
    expect(third).toBeNull();

    const failed = await queue.get({ status: 'failed' });
    expect(failed.length).toBe(1);
    expect(failed[0].errorMessage).toBe('error again');
  });

  test('retry resets failed job to pending', async () => {
    const id = await queue.enqueue('test', {}, { maxAttempts: 1 });
    const job = await queue.dequeue('test', 'worker-1');
    await queue.complete(job!.id, 'worker-1', false, 'boom');

    const ok = await queue.retry(id);
    expect(ok).toBe(true);

    const reset = await queue.get({ status: 'pending' });
    expect(reset.length).toBe(1);
    expect(reset[0].attempts).toBe(0);
  });

  test('purge removes completed jobs', async () => {
    const id = await queue.enqueue('test', {});
    const job = await queue.dequeue('test', 'worker-1');
    await queue.complete(job!.id, 'worker-1', true);

    const removed = await queue.purge('completed', 0);
    expect(removed).toBe(1);
    expect((await queue.get()).length).toBe(0);
  });
});

describe('Worker', () => {
  let queue: MemoryJobQueue;

  beforeEach(() => {
    queue = new MemoryJobQueue();
  });

  test('processes a job and marks it completed', async () => {
    const handler = jest.fn();
    const worker = new Worker({ queueName: 'test', handler, queue, pollIntervalMs: 50 }).start();

    await queue.enqueue('test', { x: 1 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await worker.drain();
    worker.stop();

    expect(handler).toHaveBeenCalledTimes(1);
    const completed = await queue.get({ status: 'completed' });
    expect(completed.length).toBe(1);
  });

  test('retries failed jobs then sends to DLQ', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('fail'));
    const worker = new Worker({
      queueName: 'test',
      handler,
      queue,
      pollIntervalMs: 50,
    }).start();

    await queue.enqueue('test', {}, { maxAttempts: 2 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await worker.drain();
    worker.stop();

    expect(handler).toHaveBeenCalledTimes(2);
    const failed = await queue.get({ status: 'failed' });
    expect(failed.length).toBe(1);
  });

  test('respects max concurrency', async () => {
    const active: number[] = [];
    let maxActive = 0;

    const handler = jest.fn(async () => {
      active.push(1);
      maxActive = Math.max(maxActive, active.length);
      await new Promise((resolve) => setTimeout(resolve, 100));
      active.pop();
    });

    const worker = new Worker({
      queueName: 'test',
      handler,
      queue,
      pollIntervalMs: 50,
      maxConcurrency: 2,
    }).start();

    await queue.enqueue('test', {});
    await queue.enqueue('test', {});
    await queue.enqueue('test', {});

    await new Promise((resolve) => setTimeout(resolve, 400));
    await worker.drain();
    worker.stop();

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(handler).toHaveBeenCalledTimes(3);
  });
});
