'use strict';

/**
 * Maintenance windows — port of src/heidi-executive/MaintenanceMode.js.
 * While a component is under declared maintenance, detection does not
 * mint actions for it and the resolver sweep defers — auto-recovery must
 * never fight the operator mid-maintenance.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { HumanActionService } = require('../../lib/human-actions/service');
const { detectDockerContainers, resolveEligibleActions } = require('../../lib/human-actions/detector');
const maintenance = require('../../lib/human-actions/maintenance');

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mnt-'));
  process.env.HYDI_HUMAN_ACTIONS_FILE = path.join(dir, 'human-actions.json');
  process.env.HYDI_MAINTENANCE_FILE = path.join(dir, 'maintenance.json');
});

afterEach(() => {
  delete process.env.HYDI_HUMAN_ACTIONS_FILE;
  delete process.env.HYDI_MAINTENANCE_FILE;
});

const mkEnv = (vals = {}) => ({
  envNamePresent: (n) => vals[n] !== undefined && vals[n] !== '',
  envValue: (n) => vals[n] ?? null,
});

const crashedCollect = async () => ({
  docker: 'DEGRADED',
  containers: [{ name: 'supabase_db_X', status: 'Exited (1)', running: false, exited: true, restarting: false, restartCount: 3 }],
});

test('start/end/isSuppressed: scoped windows, expiry, durability', () => {
  const w = maintenance.startMaintenance({ scope: ['docker:container-supabase_db_X'], reason: 'upgrade', expectedDurationMs: 60000 });
  expect(w.id).toBeTruthy();
  expect(maintenance.isSuppressed('docker:container-supabase_db_X').active).toBe(true);
  expect(maintenance.isSuppressed('docker:container-other').active).toBe(false);
  // durable across "restart" (fresh read of the same file)
  expect(maintenance.activeWindows().length).toBe(1);
  expect(maintenance.endMaintenance(w.id)).toBe(true);
  expect(maintenance.isSuppressed('docker:container-supabase_db_X').active).toBe(false);
});

test('expired windows are pruned and stop suppressing', () => {
  const w = maintenance.startMaintenance({ scope: ['x'], startTime: new Date(Date.now() - 7200000).toISOString(), expectedDurationMs: 3600000 });
  expect(maintenance.isSuppressed('x').active).toBe(false);
  expect(maintenance.activeWindows().length).toBe(0);
  expect(w.id).toBeTruthy();
});

test('detector does not mint an action for a component under maintenance', async () => {
  const svc = new HumanActionService();
  maintenance.startMaintenance({ scope: ['docker:container-supabase_db_X'] });
  const out = await detectDockerContainers(svc, mkEnv(), { collect: crashedCollect });
  expect(out.minted).toEqual([]);
  expect(out.suppressed).toEqual(['supabase_db_X']);
  expect(svc.listOpen().length).toBe(0);
  maintenance.endMaintenance(maintenance.activeWindows()[0] && maintenance.activeWindows()[0].id);
});

test('resolver sweep defers attempts on actions under maintenance', async () => {
  const svc = new HumanActionService();
  await detectDockerContainers(svc, mkEnv(), { collect: crashedCollect });
  const a = svc.listOpen()[0];
  expect(a.blockerKey).toBe('docker:container-supabase_db_X');
  maintenance.startMaintenance({ scope: ['docker:container-supabase_db_X'] });
  const out = await resolveEligibleActions(svc, {
    env: mkEnv({ HYDI_DOCKER_RESTART_ALLOW: 'supabase_db_X' }),
    throttleMs: 0,
    deps: { authority: undefined },
  });
  expect(out.deferred.length).toBe(1);
  expect(out.deferred[0].reason).toContain('maintenance');
  expect(out.attempted).toEqual([]);
});

test('after the window ends the resolver runs normally', async () => {
  const svc = new HumanActionService();
  await detectDockerContainers(svc, mkEnv(), { collect: crashedCollect });
  const a = svc.listOpen()[0];
  const out = await resolveEligibleActions(svc, {
    env: mkEnv({ HYDI_DOCKER_RESTART_ALLOW: 'supabase_db_X' }),
    throttleMs: 0,
    deps: {
      isSuppressed: () => ({ active: false }),
      dockerExec: { inspectDockerContainer: async () => ({ exists: true, running: true, restarting: false, restartCount: 4 }) },
    },
  });
  expect(out.attempted.length).toBe(1);
  expect(a.blockerKey).toBeTruthy();
});
