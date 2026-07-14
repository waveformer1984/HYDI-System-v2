/**
 * Regression guard: WorkerOrchestrator.workerConfigs must not have
 * class: null entries. security_identity, sync, notification, and audit
 * previously had null placeholders even though SecurityIdentityWorker.js,
 * SyncWorker.js, NotificationWorker.js, and AuditWorker.js were fully
 * implemented -- startWorkersByPriority() silently skipped them at runtime
 * (CLAUDE.md: "If you add a new worker, register it in WorkerOrchestrator.js
 * before deploying").
 */

jest.mock('../../workers/QueueManager', () => jest.fn().mockImplementation(() => ({})));
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => ({})) }));

const WorkerOrchestrator = require('../../workers/WorkerOrchestrator');

describe('WorkerOrchestrator.workerConfigs', () => {
  let orchestrator;

  beforeEach(() => {
    orchestrator = new WorkerOrchestrator();
  });

  it('has no unimplemented (class: null) worker types', () => {
    const unimplemented = Object.entries(orchestrator.workerConfigs)
      .filter(([, config]) => !config.class)
      .map(([type]) => type);

    expect(unimplemented).toEqual([]);
  });

  it('registers security_identity, sync, notification, and audit workers', () => {
    ['security_identity', 'sync', 'notification', 'audit'].forEach((type) => {
      expect(orchestrator.workerConfigs[type]).toBeDefined();
      expect(orchestrator.workerConfigs[type].class).toBeTruthy();
      expect(typeof orchestrator.workerConfigs[type].class).toBe('function');
    });
  });

  it('every worker config has a valid priority understood by startWorkersByPriority', () => {
    const validPriorities = ['critical', 'high', 'medium', 'low'];
    Object.entries(orchestrator.workerConfigs).forEach(([type, config]) => {
      expect(validPriorities).toContain(config.priority);
    });
  });
});
