'use strict';

/**
 * Tests the mobile-ops command-queue wiring added to WorkerOrchestrator
 * (startCommandPolling / pollControlCommands / executeControlCommand /
 * runLifecycleAction / startWorkerType / stopWorkerType). Real worker
 * classes (RevenueIngestionWorker, DecisionAssistWorker, ...) are swapped
 * for a lightweight fake so this stays a unit test of the orchestrator's
 * own control-flow, not an integration test of 14 unrelated workers.
 */

const WorkerOrchestrator = require('../../workers/WorkerOrchestrator');

class FakeWorker {
  constructor(workerId) {
    this.workerId = workerId;
    this.running = false;
  }
  async start() { this.running = true; }
  async stop() { this.running = false; }
}

function mockSupabaseFor(orchestrator, { pendingCommands = [] } = {}) {
  const updates = [];
  const events = [];

  orchestrator.supabase = {
    from(table) {
      if (table === 'agent_control_commands') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({ data: pendingCommands, error: null }),
              }),
            }),
          }),
          update: (patch) => ({
            eq: async (_field, id) => {
              updates.push({ id, patch });
              return { error: null };
            },
          }),
        };
      }
      if (table === 'worker_events') {
        return { insert: async (row) => { events.push(row); return { error: null }; } };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  return { updates, events };
}

describe('WorkerOrchestrator control-command wiring', () => {
  let orchestrator;

  beforeEach(() => {
    orchestrator = new WorkerOrchestrator();
    orchestrator.initialized = true;
    // Swap the real worker class for the fake one on a single config so
    // start/stop/restart exercise real orchestrator logic without any
    // network or Supabase dependency inside the worker itself.
    orchestrator.workerConfigs.decision_assist.class = FakeWorker;
    orchestrator.workerConfigs.decision_assist.instances = 1;
  });

  it('rejects lifecycle actions for an unknown worker type', async () => {
    await expect(orchestrator.runLifecycleAction('start', 'not_a_real_worker', null))
      .rejects.toThrow(/Unknown or unimplemented worker type/);
  });

  it('startWorkerType starts the configured instance count and is idempotent on re-run', async () => {
    const result1 = await orchestrator.startWorkerType('decision_assist');
    expect(result1.started).toEqual(['decision_assist-1']);
    expect(orchestrator.workers.get('decision_assist')).toHaveLength(1);

    // Second start with instances already at the configured count starts nothing new.
    const result2 = await orchestrator.startWorkerType('decision_assist');
    expect(result2.started).toEqual([]);
    expect(orchestrator.workers.get('decision_assist')).toHaveLength(1);
  });

  it('stopWorkerType stops a specific worker_id', async () => {
    await orchestrator.startWorkerType('decision_assist');
    const result = await orchestrator.stopWorkerType('decision_assist', 'decision_assist-1');
    expect(result.stopped).toEqual(['decision_assist-1']);
    expect(orchestrator.workers.get('decision_assist')).toHaveLength(0);
  });

  it('stopWorkerType stops every instance when no worker_id is given', async () => {
    orchestrator.workerConfigs.decision_assist.instances = 2;
    await orchestrator.startWorkerType('decision_assist');
    const result = await orchestrator.stopWorkerType('decision_assist');
    expect(result.stopped.sort()).toEqual(['decision_assist-1', 'decision_assist-2']);
  });

  it('executeControlCommand marks a start command completed and logs a worker_event', async () => {
    const command = { id: 'cmd-1', worker_type: 'decision_assist', worker_id: null, command: 'start' };
    const { updates, events } = mockSupabaseFor(orchestrator);

    await orchestrator.executeControlCommand(command);

    expect(updates.some((u) => u.id === 'cmd-1' && u.patch.status === 'processing')).toBe(true);
    expect(updates.some((u) => u.id === 'cmd-1' && u.patch.status === 'completed')).toBe(true);
    expect(events.some((e) => e.event_type === 'control_start')).toBe(true);
    expect(orchestrator.workers.get('decision_assist')).toHaveLength(1);
  });

  it('executeControlCommand marks a command failed and logs the error for an unknown worker type', async () => {
    const command = { id: 'cmd-2', worker_type: 'ghost_worker', worker_id: null, command: 'start' };
    const { updates, events } = mockSupabaseFor(orchestrator);

    await orchestrator.executeControlCommand(command);

    const failedUpdate = updates.find((u) => u.id === 'cmd-2' && u.patch.status === 'failed');
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate.patch.error_message).toMatch(/Unknown or unimplemented worker type/);
    expect(events.some((e) => e.event_type === 'control_start_failed')).toBe(true);
  });

  it('pollControlCommands processes every pending row returned by the query', async () => {
    const pending = [
      { id: 'cmd-a', worker_type: 'decision_assist', worker_id: null, command: 'start' },
    ];
    const { updates } = mockSupabaseFor(orchestrator, { pendingCommands: pending });

    await orchestrator.pollControlCommands();

    expect(updates.some((u) => u.id === 'cmd-a' && u.patch.status === 'completed')).toBe(true);
  });

  it('restart with a worker_id restarts only that instance', async () => {
    await orchestrator.startWorkerType('decision_assist');
    const before = orchestrator.workers.get('decision_assist')[0];
    const result = await orchestrator.runLifecycleAction('restart', 'decision_assist', 'decision_assist-1');
    expect(result.restarted).toEqual(['decision_assist-1']);
    const after = orchestrator.workers.get('decision_assist')[0];
    expect(after).not.toBe(before); // a genuinely new instance, not the same object
    expect(after.workerId).toBe('decision_assist-1');
  });

  it('scale_up increases the instance count for that worker type', async () => {
    await orchestrator.startWorkerType('decision_assist');
    const result = await orchestrator.runLifecycleAction('scale_up', 'decision_assist', null);
    expect(result.instances).toBe(2);
    expect(orchestrator.workers.get('decision_assist')).toHaveLength(2);
  });
});
