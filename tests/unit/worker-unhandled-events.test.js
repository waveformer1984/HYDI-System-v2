/**
 * Contract test: a worker must never report an unhandled event type as a
 * successfully completed task.
 *
 * Every worker's `processNextTask()` dequeues from its own named queue and
 * dispatches on `task.payload.event_type` through a `switch`. Each of the ten
 * workers below previously ended that switch with
 *
 *     default: logger.info('Unhandled event type', ...)
 *
 * and then unconditionally called `completeTask(taskId, true)`. Because
 * `dequeue()` is per-queue, a worker only ever sees events routed
 * specifically to it, so an unrecognised `event_type` is always a misroute or
 * an unimplemented handler — never routine traffic. Marking it successful
 * meant such events vanished with a success signal and no failure record.
 *
 * That was not hypothetical. `TaskRouterWorker` routes `cost.calculate` to the
 * `cost_margin` queue, but `CostMarginWorker` implements only
 * `analytics.generate` — so every `cost.calculate` task would be dropped and
 * reported as done. `RevenueIngestionWorker` had the same shape, where a
 * dropped event means revenue data disappears silently.
 *
 * Unhandled events now throw, which routes them into each worker's existing
 * catch block and `completeTask(taskId, false, message)`. Per the
 * `complete_task` RPC, a failed task returns to `pending` until
 * `attempts >= max_attempts` and then lands in `failed` — bounded, visible,
 * and no infinite loop.
 */

'use strict';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => ({})) }));

jest.mock('../../lib/structured-logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const mockDequeue = jest.fn();
const mockGetTask = jest.fn();
const mockCompleteTask = jest.fn();

jest.mock('../../workers/QueueManager', () =>
  jest.fn(() => ({
    dequeue: mockDequeue,
    getTask: mockGetTask,
    completeTask: mockCompleteTask,
    enqueue: jest.fn(),
    registerWorker: jest.fn(),
    updateHeartbeat: jest.fn(),
    startHeartbeat: jest.fn(),
    shutdown: jest.fn(),
  })),
);

/**
 * Every worker whose processNextTask() dispatches on event_type.
 * `queue` documents which named queue it drains, for failure messages.
 */
const WORKERS = [
  ['AnomalyDetectionWorker', 'anomaly_detection'],
  ['BehaviorPatternWorker', 'behavior_pattern'],
  ['CostMarginWorker', 'cost_margin'],
  ['DecisionAssistWorker', 'decision_assist'],
  ['NotificationWorker', 'notification'],
  ['OpportunityDetectionWorker', 'opportunity_detection'],
  ['ProvisioningWorker', 'provisioning'],
  ['RevenueIngestionWorker', 'revenue_ingestion'],
  ['SecurityIdentityWorker', 'security_identity'],
  ['SyncWorker', 'sync'],
];

describe('workers never report an unhandled event as success', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDequeue.mockResolvedValue('task-1');
    mockGetTask.mockResolvedValue({
      id: 'task-1',
      payload: { event_type: 'definitely.not.a.real.event', data: {} },
    });
    mockCompleteTask.mockResolvedValue(undefined);
  });

  describe.each(WORKERS)('%s (queue: %s)', (workerName) => {
    function build() {
      const Worker = require(`../../workers/${workerName}`);
      const worker = new Worker('test-worker');
      worker.supabase = {};
      return worker;
    }

    it('fails the task rather than completing it successfully', async () => {
      await build().processNextTask();

      expect(mockCompleteTask).toHaveBeenCalledTimes(1);
      const [taskId, success] = mockCompleteTask.mock.calls[0];
      expect(taskId).toBe('task-1');
      expect(success).toBe(false);
    });

    it('records the offending event type in the failure message', async () => {
      await build().processNextTask();

      const [, , errorMessage] = mockCompleteTask.mock.calls[0];
      expect(errorMessage).toContain('definitely.not.a.real.event');
    });

    it('does not throw out of processNextTask', async () => {
      // The failure must be recorded on the task, not crash the poll loop.
      await expect(build().processNextTask()).resolves.not.toThrow();
    });
  });

  describe('CostMarginWorker and the cost.calculate routing gap', () => {
    it('fails cost.calculate, the event TaskRouterWorker actually routes to it', async () => {
      mockGetTask.mockResolvedValue({
        id: 'task-1',
        payload: { event_type: 'cost.calculate', data: {} },
      });

      const CostMarginWorker = require('../../workers/CostMarginWorker');
      const worker = new CostMarginWorker('test-worker');
      worker.supabase = {};

      await worker.processNextTask();

      const [, success, errorMessage] = mockCompleteTask.mock.calls[0];
      expect(success).toBe(false);
      expect(errorMessage).toContain('cost.calculate');
    });
  });

  describe('handled events are unaffected', () => {
    it('still completes a recognised event successfully', async () => {
      mockGetTask.mockResolvedValue({
        id: 'task-1',
        payload: { event_type: 'analytics.generate', data: { time_period: '30d' } },
      });

      const CostMarginWorker = require('../../workers/CostMarginWorker');
      const worker = new CostMarginWorker('test-worker');
      // generateCostAnalytics queries Supabase; stub it out so this test is
      // about dispatch, not analytics.
      worker.generateCostAnalytics = jest.fn().mockResolvedValue(undefined);
      worker.supabase = {};

      await worker.processNextTask();

      expect(worker.generateCostAnalytics).toHaveBeenCalledTimes(1);
      expect(mockCompleteTask).toHaveBeenCalledWith('task-1', true);
    });
  });
});
