/**
 * SignalDesk background worker (Stage 1: health + queue stub).
 * Research and inference jobs enqueue here in Stage 4+.
 */
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:56379';
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

const queueName = 'signaldesk-research';

const queue = new Queue(queueName, { connection });

new Worker(
  queueName,
  async (job) => {
    console.log(`[signaldesk-worker] received job ${job.id} (noop until Stage 4)`);
    return { ok: true, staged: true };
  },
  { connection },
);

async function health() {
  await connection.ping();
  const counts = await queue.getJobCounts('waiting', 'active', 'failed', 'completed');
  return { redis: 'ok', queue: counts };
}

health()
  .then((h) => console.log('[signaldesk-worker] up', JSON.stringify(h)))
  .catch((e) => {
    console.error('[signaldesk-worker] health failed', e instanceof Error ? e.message : e);
    process.exit(1);
  });

process.on('SIGTERM', async () => {
  await queue.close();
  await connection.quit();
  process.exit(0);
});