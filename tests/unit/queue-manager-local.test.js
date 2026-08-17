'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const QueueManager = require('../../workers/QueueManager');

describe('QueueManager local-first', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-queue-'));
    process.env.HYDI_JOBS_DATA_DIR = tmpDir;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    process.env.HYDI_QUEUE_SOURCE = 'local';
  });

  afterEach(() => {
    delete process.env.HYDI_JOBS_DATA_DIR;
    delete process.env.HYDI_QUEUE_SOURCE;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('enqueue, dequeue, complete a task', async () => {
    const qm = new QueueManager();
    await qm.initialize();
    await qm.registerWorker('test', 'worker-1');

    const taskId = await qm.enqueue('test-queue', { action: 'hello' }, 1, 3);
    expect(typeof taskId).toBe('string');

    const job = await qm.dequeue('test-queue');
    expect(job).not.toBeNull();
    expect(job.id).toBe(taskId);
    expect(job.status).toBe('processing');

    await qm.completeTask(taskId, true);
    const task = await qm.getTask(taskId);
    expect(task.status).toBe('completed');

    const stats = await qm.getQueueStats('test-queue');
    expect(stats.completed).toBe(1);
  });

  test('failed task retries and eventually fails', async () => {
    const qm = new QueueManager();
    await qm.initialize();
    await qm.registerWorker('test', 'worker-1');

    const taskId = await qm.enqueue('retry-queue', { action: 'fail' }, 0, 2);
    let job = await qm.dequeue('retry-queue');
    await qm.completeTask(taskId, false, 'first failure');

    job = await qm.dequeue('retry-queue');
    expect(job).not.toBeNull();
    expect(job.id).toBe(taskId);

    await qm.completeTask(taskId, false, 'second failure');
    const task = await qm.getTask(taskId);
    expect(task.status).toBe('failed');
  });

  test('duplicate tasks are distinct', async () => {
    const qm = new QueueManager();
    await qm.initialize();
    const id1 = await qm.enqueue('dup-queue', { action: 'a' });
    const id2 = await qm.enqueue('dup-queue', { action: 'b' });
    expect(id1).not.toBe(id2);
    const stats = await qm.getQueueStats('dup-queue');
    expect(stats.pending).toBe(2);
  });

  test('concurrent claim protection', async () => {
    const qm1 = new QueueManager();
    await qm1.initialize();
    await qm1.registerWorker('test', 'worker-1');
    await qm1.enqueue('race-queue', { action: 'race' });

    const qm2 = new QueueManager();
    await qm2.initialize();
    await qm2.registerWorker('test', 'worker-2');

    const [job1, job2] = await Promise.all([qm1.dequeue('race-queue'), qm2.dequeue('race-queue')]);
    const claimed = [job1, job2].filter(Boolean);
    expect(claimed.length).toBe(1);
  });

  test('process restart recovery', async () => {
    const qm1 = new QueueManager();
    await qm1.initialize();
    await qm1.registerWorker('test', 'worker-1');
    const taskId = await qm1.enqueue('rec-queue', { action: 'survive' });

    // Simulate restart with fresh QueueManager
    const qm2 = new QueueManager();
    await qm2.initialize();
    await qm2.registerWorker('test', 'worker-1');
    const job = await qm2.dequeue('rec-queue');
    expect(job.id).toBe(taskId);
    await qm2.completeTask(taskId, true);
  });

  test('no cloud credentials required', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const qm = new QueueManager();
    await qm.initialize();
    const taskId = await qm.enqueue('cloudless-queue', { action: 'test' });
    const job = await qm.dequeue('cloudless-queue');
    expect(job.id).toBe(taskId);
  });
});
