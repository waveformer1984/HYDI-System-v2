'use strict';

/**
 * Mobile ops remote control: agent_control_commands rows written by
 * api/agent-manager/control.js must be picked up and executed by
 * WorkerOrchestrator's command poller (workers/WorkerOrchestrator.js).
 */

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

const WorkerOrchestrator = require('../../workers/WorkerOrchestrator');

class FakeWorker {
  constructor(workerId) {
    this.workerId = workerId;
    this.running = false;
  }
  async start() { this.running = true; }
  async stop() { this.running = false; }
}

function makeSupabaseMock(pendingCommands) {
  const updates = [];
  const inserts = [];

  function chain() {
    const obj = {
      select: () => obj,
      eq: () => obj,
      order: () => obj,
      limit: () => Promise.resolve({ data: pendingCommands, error: null }),
      update: (patch) => { updates.push(patch); return obj; },
      insert: (row) => { inserts.push(row); return Promise.resolve({ data: null, error: null }); },
    };
    return obj;
  }

  return {
    from: jest.fn(() => chain()),
    _updates: updates,
    _inserts: inserts,
  };
}

function makeOrchestrator(supabaseMock, extraWorkerConfig) {
  const orchestrator = new WorkerOrchestrator();
  orchestrator.supabase = supabaseMock;
  orchestrator.workerConfigs = { ...orchestrator.workerConfigs, ...extraWorkerConfig };
  return orchestrator;
}

describe('WorkerOrchestrator command polling', () => {
  test('start command launches the configured instance count', async () => {
    const supabase = makeSupabaseMock([
      { id: 'cmd-1', worker_type: 'fake_worker', command: 'start', requested_by: 'mobile-chat' },
    ]);
    const orchestrator = makeOrchestrator(supabase, {
      fake_worker: { class: FakeWorker, instances: 2, priority: 'low' },
    });

    await orchestrator.pollCommands();

    const instances = orchestrator.workers.get('fake_worker');
    expect(instances).toHaveLength(2);
    expect(instances.every(w => w.running)).toBe(true);

    const statuses = supabase._updates.map(u => u.status);
    expect(statuses).toEqual(['acknowledged', 'completed']);
    expect(supabase._updates[1].result_message).toMatch(/started 2 instance/);
  });

  test('stop command with nothing running reports already stopped', async () => {
    const supabase = makeSupabaseMock([
      { id: 'cmd-2', worker_type: 'fake_worker', command: 'stop', requested_by: 'mobile-chat' },
    ]);
    const orchestrator = makeOrchestrator(supabase, {
      fake_worker: { class: FakeWorker, instances: 1, priority: 'low' },
    });

    await orchestrator.pollCommands();

    expect(supabase._updates[1].status).toBe('completed');
    expect(supabase._updates[1].result_message).toMatch(/already stopped/);
  });

  test('restart command stops then starts fresh instances', async () => {
    const supabase = makeSupabaseMock([
      { id: 'cmd-3', worker_type: 'fake_worker', command: 'restart', requested_by: 'mobile-chat' },
    ]);
    const orchestrator = makeOrchestrator(supabase, {
      fake_worker: { class: FakeWorker, instances: 1, priority: 'low' },
    });
    // Pre-seed a running instance to prove it gets stopped first.
    const existing = new FakeWorker('fake_worker-1');
    existing.running = true;
    orchestrator.workers.set('fake_worker', [existing]);

    await orchestrator.pollCommands();

    expect(existing.running).toBe(false);
    const instances = orchestrator.workers.get('fake_worker');
    expect(instances).toHaveLength(1);
    expect(instances[0].running).toBe(true);
    expect(instances[0]).not.toBe(existing);
  });

  test('unknown worker type is rejected and recorded as failed', async () => {
    const supabase = makeSupabaseMock([
      { id: 'cmd-4', worker_type: 'not_a_real_worker', command: 'start', requested_by: 'mobile-chat' },
    ]);
    const orchestrator = makeOrchestrator(supabase, {});

    await orchestrator.pollCommands();

    expect(supabase._updates[1].status).toBe('failed');
    expect(supabase._updates[1].result_message).toMatch(/Unknown worker type/);
  });

  test('worker type with no registered class is rejected', async () => {
    const supabase = makeSupabaseMock([
      { id: 'cmd-5', worker_type: 'unimplemented_worker', command: 'start', requested_by: 'mobile-chat' },
    ]);
    const orchestrator = makeOrchestrator(supabase, {
      unimplemented_worker: { class: null, instances: 1, priority: 'low' },
    });

    await orchestrator.pollCommands();

    expect(supabase._updates[1].status).toBe('failed');
    expect(supabase._updates[1].result_message).toMatch(/not implemented/);
  });
});
