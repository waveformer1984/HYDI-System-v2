'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { HeidiController } = require('../../pao-system/core/heidi.controller');
const { resetRepo } = require('../../lib/rezonate/rezonate-client');

describe('Apex + Rezonate operational control and recovery', () => {
  let tmpRezonateDir;
  let tmpApexDir;

  beforeEach(() => {
    tmpRezonateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezonate-phase4-'));
    tmpApexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-phase4-'));
    process.env.REZONATE_DATA_DIR = tmpRezonateDir;
    process.env.APEX_DATA_DIR = tmpApexDir;
    resetRepo();
  });

  afterEach(() => {
    delete process.env.REZONATE_DATA_DIR;
    delete process.env.APEX_DATA_DIR;
    fs.rmSync(tmpRezonateDir, { recursive: true, force: true });
    fs.rmSync(tmpApexDir, { recursive: true, force: true });
  });

  test('complete end-to-end acceptance scenario', async () => {
    // 1. Start with empty local data directories.
    // (beforeEach ensures this.)

    // 2. Heidi receives a project creation intent.
    const controllerA = new HeidiController();
    const create = await controllerA.processUserEvent('APEX_PROJECT_CREATED', {
      apex_venture_id: 'apex-archive',
      project_name: 'Apex Archive',
    }, 'owner');

    // 3. Authorization succeeded.
    // 4. Capability guard succeeded.
    // 5. Apex project is created.
    // 6. Rezonate project is created.
    // 7. Mapping is persisted.
    expect(create.ok).toBe(true);
    expect(create.rezonate_project).toBeDefined();
    expect(create.rezonate_project.name).toBe('Apex Archive');
    const projectId = create.rezonate_project.id;

    // 8. Audit event is recorded.
    const auditA = controllerA.getAuditLog().getByEventType('HEIDI_USER_EVENT_RECEIVED');
    expect(auditA.length).toBeGreaterThanOrEqual(1);

    // 9. Episode is created.
    const episode = await controllerA.processUserEvent('APEX_EPISODE_CREATED', {
      apex_venture_id: 'apex-archive',
      episode: { episode_id: '2026-08-14-ep-1', title: 'Test Episode' },
    }, 'owner');
    expect(episode.ok).toBe(true);

    // 10. Status reports the project correctly.
    const status = await controllerA.processUserEvent('GET_APEX_PROJECT_STATUS', {
      apex_venture_id: 'apex-archive',
    }, 'owner');
    expect(status.ok).toBe(true);
    expect(status.rezonate_project.id).toBe(projectId);

    // 11. Process is restarted.
    resetRepo();
    const controllerB = new HeidiController();

    // 12. Project and mapping are recovered.
    const statusB = await controllerB.processUserEvent('GET_APEX_PROJECT_STATUS', {
      apex_venture_id: 'apex-archive',
    }, 'owner');
    expect(statusB.ok).toBe(true);
    expect(statusB.rezonate_project.id).toBe(projectId);

    // 13. Status still reports the project.
    expect(statusB.rezonate_project.name).toBe('Apex Archive');

    // 14. Replay of the original project event does not duplicate state.
    const replay = await controllerB.processUserEvent('APEX_PROJECT_CREATED', {
      apex_venture_id: 'apex-archive',
      project_name: 'Apex Archive',
    }, 'owner');
    expect(replay.ok).toBe(true);
    expect(replay.idempotent).toBe(true);
    expect(replay.rezonate_project.id).toBe(projectId);

    // 15. No cloud credentials exist.
    // 16. No cloud connection is attempted.
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const cloud = await controllerB.processUserEvent('GET_APEX_REZONATE_STATUS', {}, 'owner');
    expect(cloud.ok).toBe(true);
    expect(cloud.cloud.supabase_url).toBeNull();
    expect(cloud.cloud.supabase_key_set).toBe(false);
    expect(cloud.rezonate.count).toBe(1);
  });

  test('unauthorized mutation is rejected', async () => {
    const controller = new HeidiController();
    const result = await controller.processUserEvent('APEX_PROJECT_CREATED', {
      apex_venture_id: 'apex-archive',
    }, 'viewer');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/lacks permission 'apex:manage'/);
  });

  test('unsupported capability is rejected', async () => {
    const controller = new HeidiController();
    const result = await controller.processUserEvent('APEX_UPLOAD', {
      apex_venture_id: 'apex-archive',
    }, 'owner');
    expect(result.ok).toBe(false);
    expect(result.state).toBe('SCAFFOLD');
  });

  test('malformed intent is rejected', async () => {
    const controller = new HeidiController();
    const result = await controller.processUserEvent('APEX_PROJECT_CREATED', null, 'owner');
    expect(result.ok).toBe(false);
  });

  test('duplicate mutation is safely handled', async () => {
    const controller = new HeidiController();
    const first = await controller.processUserEvent('APEX_PROJECT_CREATED', {
      apex_venture_id: 'apex-archive',
      project_name: 'Apex Archive',
    }, 'owner');
    expect(first.ok).toBe(true);
    const second = await controller.processUserEvent('APEX_PROJECT_CREATED', {
      apex_venture_id: 'apex-archive',
      project_name: 'Apex Archive',
    }, 'owner');
    expect(second.ok).toBe(false);
    expect(second.reason).toMatch(/duplicate/);
  });

  test('persistence survives process restart', async () => {
    const controllerA = new HeidiController();
    const create = await controllerA.processUserEvent('APEX_PROJECT_CREATED', {
      apex_venture_id: 'apex-archive',
      project_name: 'Apex Archive',
    }, 'owner');
    expect(create.ok).toBe(true);

    resetRepo();
    const controllerB = new HeidiController();
    const status = await controllerB.processUserEvent('GET_APEX_PROJECT_STATUS', {
      apex_venture_id: 'apex-archive',
    }, 'owner');
    expect(status.ok).toBe(true);
    expect(status.rezonate_project.id).toBe(create.rezonate_project.id);
  });

  test('missing local persistence fails truthfully', async () => {
    process.env.APEX_DATA_DIR = '/nonexistent/apex';
    const controller = new HeidiController();
    const result = await controller.processUserEvent('GET_APEX_PROJECT_STATUS', {
      apex_venture_id: 'apex-archive',
    }, 'owner');
    expect(result.ok).toBe(false);
  });

  test('no cloud credentials are required', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const controller = new HeidiController();
    const result = await controller.processUserEvent('APEX_PROJECT_CREATED', {
      apex_venture_id: 'apex-archive',
      project_name: 'Apex Archive',
    }, 'owner');
    expect(result.ok).toBe(true);
  });

  test('no Supabase URL is required', async () => {
    delete process.env.SUPABASE_URL;
    const controller = new HeidiController();
    const result = await controller.processUserEvent('APEX_PROJECT_CREATED', {
      apex_venture_id: 'apex-archive',
      project_name: 'Apex Archive',
    }, 'owner');
    expect(result.ok).toBe(true);
    expect(process.env.SUPABASE_URL).toBeUndefined();
  });

  test('audit event exists after successful mutation', async () => {
    const controller = new HeidiController();
    await controller.processUserEvent('APEX_PROJECT_CREATED', {
      apex_venture_id: 'apex-archive',
      project_name: 'Apex Archive',
    }, 'owner');
    const audit = controller.getAuditLog().getByEventType('HEIDI_USER_EVENT_RECEIVED');
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  test('status accurately reports the subsystem', async () => {
    const controller = new HeidiController();
    const status = await controller.processUserEvent('GET_APEX_REZONATE_STATUS', {}, 'owner');
    expect(status.ok).toBe(true);
    expect(status.apex).toBeDefined();
    expect(status.rezonate).toBeDefined();
    expect(status.local.persistence).toBe('local JSON');
  });

  test('Apex → Rezonate mapping survives restart', async () => {
    const controllerA = new HeidiController();
    const create = await controllerA.processUserEvent('APEX_PROJECT_CREATED', {
      apex_venture_id: 'apex-archive',
      project_name: 'Apex Archive',
    }, 'owner');
    expect(create.ok).toBe(true);

    resetRepo();
    const controllerB = new HeidiController();
    const status = await controllerB.processUserEvent('GET_APEX_PROJECT_STATUS', {
      apex_venture_id: 'apex-archive',
    }, 'owner');
    expect(status.ok).toBe(true);
    expect(status.mapping.apex_venture_id).toBe('apex-archive');
    expect(status.mapping.rezonate_project_id).toBe(create.rezonate_project.id);
  });

  test('replaying an event does not duplicate state', async () => {
    const controllerA = new HeidiController();
    const create = await controllerA.processUserEvent('APEX_PROJECT_CREATED', {
      apex_venture_id: 'apex-archive',
      project_name: 'Apex Archive',
    }, 'owner');
    expect(create.ok).toBe(true);

    resetRepo();
    const controllerB = new HeidiController();
    const replay = await controllerB.processUserEvent('APEX_PROJECT_CREATED', {
      apex_venture_id: 'apex-archive',
      project_name: 'Apex Archive',
    }, 'owner');
    expect(replay.ok).toBe(true);
    expect(replay.idempotent).toBe(true);

    const all = await (require('../../lib/rezonate/rezonate-client').listProjects)();
    expect(all.length).toBe(1);
  });
});
