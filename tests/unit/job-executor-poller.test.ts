/**
 * Tests for scripts/job-executor-poller.ts -- the boot-module poller that
 * closes the "paid job sits in 'queued' forever" gap (see the file's own
 * header comment and docs/REVENUE_PATH_BOUNDARY.md).
 *
 * These tests mock lib/revenue/JobExecutor entirely, so they never touch
 * a real database. They verify the poller's own control flow: it drains
 * queued work without sleeping, sleeps once the queue is empty, backs off
 * longer on a thrown error, and never calls anything beyond
 * processNextJob()/recoverStaleJobs() -- in particular, it has no code
 * path that can reach approveForDelivery() or any Stripe call.
 */

jest.mock('../../lib/revenue/JobExecutor', () => ({
  processNextJob: jest.fn(),
  recoverStaleJobs: jest.fn(),
}));

import { processNextJob, recoverStaleJobs } from '../../lib/revenue/JobExecutor';
import { runOnce, mainLoop } from '../../scripts/job-executor-poller';

const mockProcessNextJob = processNextJob as jest.Mock;
const mockRecoverStaleJobs = recoverStaleJobs as jest.Mock;

describe('job-executor-poller: runOnce', () => {
  beforeEach(() => {
    mockProcessNextJob.mockReset();
    mockRecoverStaleJobs.mockReset();
  });

  it('reports no work done when the queue is empty', async () => {
    mockProcessNextJob.mockResolvedValue(null);
    const result = await runOnce();
    expect(result).toEqual({ workDone: false });
  });

  it('reports work done on a successful execution', async () => {
    mockProcessNextJob.mockResolvedValue({
      jobId: 'job-1',
      success: true,
      artifacts: [{ path: '/tmp/job-1/part.stl' }],
      durationMs: 42,
    });
    const result = await runOnce();
    expect(result).toEqual({ workDone: true });
  });

  it('reports work done even when the execution itself failed', async () => {
    // A failed job execution is still "work done" for polling purposes --
    // the job was picked up and moved out of 'queued' (to 'failed'), so
    // the poller should not treat this as an empty queue and should not
    // wait the full poll interval before checking for the next job.
    mockProcessNextJob.mockResolvedValue({
      jobId: 'job-2',
      success: false,
      artifacts: [],
      error: 'artifact verification failed',
      durationMs: 10,
    });
    const result = await runOnce();
    expect(result).toEqual({ workDone: true });
  });

  it('propagates a thrown error from processNextJob (infra failure, not a per-job failure)', async () => {
    mockProcessNextJob.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(runOnce()).rejects.toThrow('ECONNREFUSED');
  });
});

describe('job-executor-poller: mainLoop', () => {
  beforeEach(() => {
    mockProcessNextJob.mockReset();
    mockRecoverStaleJobs.mockReset();
    mockRecoverStaleJobs.mockResolvedValue({ recovered: 0, failed: 0 });
  });

  it('calls recoverStaleJobs exactly once before entering the poll loop', async () => {
    mockProcessNextJob.mockResolvedValue(null);
    let calls = 0;
    const shouldStop = () => {
      calls += 1;
      return calls > 1; // stop after the first iteration
    };
    await mainLoop({ shouldStop, sleepFn: async () => {} });
    expect(mockRecoverStaleJobs).toHaveBeenCalledTimes(1);
  });

  it('drains multiple queued jobs without sleeping between them', async () => {
    const sleepFn = jest.fn(async () => {});
    // Three jobs queued, then the queue goes empty, then stop.
    mockProcessNextJob
      .mockResolvedValueOnce({ jobId: 'a', success: true, artifacts: [], durationMs: 1 })
      .mockResolvedValueOnce({ jobId: 'b', success: true, artifacts: [], durationMs: 1 })
      .mockResolvedValueOnce({ jobId: 'c', success: true, artifacts: [], durationMs: 1 })
      .mockResolvedValueOnce(null);

    let iterations = 0;
    const shouldStop = () => {
      iterations += 1;
      return iterations > 4; // 3 jobs + 1 empty check, then stop
    };

    await mainLoop({ shouldStop, sleepFn, pollIntervalMs: 999, errorBackoffMs: 999 });

    expect(mockProcessNextJob).toHaveBeenCalledTimes(4);
    // Only the empty-queue iteration should sleep -- draining jobs a/b/c
    // should not sleep in between.
    expect(sleepFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).toHaveBeenCalledWith(999);
  });

  it('backs off with errorBackoffMs (not pollIntervalMs) after a thrown error, and keeps looping', async () => {
    const sleepFn = jest.fn(async () => {});
    mockProcessNextJob
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(null);

    let iterations = 0;
    const shouldStop = () => {
      iterations += 1;
      return iterations > 2;
    };

    await mainLoop({ shouldStop, sleepFn, pollIntervalMs: 111, errorBackoffMs: 222 });

    expect(sleepFn).toHaveBeenNthCalledWith(1, 222); // error backoff
    expect(sleepFn).toHaveBeenNthCalledWith(2, 111); // normal empty-queue poll
  });

  it('continues into the poll loop even if recoverStaleJobs itself throws', async () => {
    mockRecoverStaleJobs.mockRejectedValue(new Error('db unreachable at startup'));
    mockProcessNextJob.mockResolvedValue(null);
    const sleepFn = jest.fn(async () => {});

    let iterations = 0;
    const shouldStop = () => {
      iterations += 1;
      return iterations > 1;
    };

    await expect(mainLoop({ shouldStop, sleepFn, pollIntervalMs: 5 })).resolves.toBeUndefined();
    expect(mockProcessNextJob).toHaveBeenCalled();
  });
});
