'use strict';

const { Client } = require('pg');

describe('Worker queue — live local stack', () => {
  const queueName = 'phase15_test_queue';
  const workerId = `test-worker-${Date.now()}`;
  let client;
  let taskId;

  beforeAll(async () => {
    client = new Client({
      host: '127.0.0.1',
      port: 54322,
      database: 'postgres',
      user: 'postgres',
      password: 'postgres',
    });
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end();
  });

  it('registers a worker', async () => {
    const { rows } = await client.query(
      `INSERT INTO public.worker_status (worker_id, worker_type, status, last_heartbeat)
       VALUES ($1, $2, 'idle', now())
       ON CONFLICT (worker_id) DO UPDATE SET last_heartbeat = now()
       RETURNING worker_id`,
      [workerId, 'test']
    );
    expect(rows[0].worker_id).toBe(workerId);
  });

  it('enqueues a task', async () => {
    const { rows } = await client.query(
      'SELECT public.enqueue_task($1, $2::jsonb, $3, $4) AS task_id',
      [queueName, JSON.stringify({ type: 'phase15.test', value: 42 }), 1, 3]
    );
    taskId = rows[0].task_id;
    expect(typeof taskId).toBe('string');
  });

  it('dequeues the task', async () => {
    const { rows } = await client.query('SELECT public.dequeue_task($1, $2) AS task_id', [queueName, workerId]);
    expect(rows[0].task_id).toBe(taskId);
  });

  it('completes the task', async () => {
    await client.query('SELECT public.complete_task($1, $2, $3, $4)', [taskId, workerId, true, null]);

    const { rows } = await client.query(
      'SELECT status, completed_at FROM public.worker_queues WHERE id = $1',
      [taskId]
    );
    expect(rows[0].status).toBe('completed');
    expect(rows[0].completed_at).toBeTruthy();
  });
});
