'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { HeidiController } = require('../../pao-system/core/heidi.controller');
const { resetRepo } = require('../../lib/rezonate/rezonate-client');

describe('Apex → Heidi → Rezonate project lifecycle', () => {
  let tmpRezonateDir;
  let tmpApexDir;

  beforeEach(() => {
    tmpRezonateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezonate-phase3-'));
    tmpApexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-phase3-'));
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

  test('create a project and recover it after Heidi restart', async () => {
    // Process A
    const controllerA = new HeidiController();
    const create = await controllerA.processUserEvent('APEX_PROJECT_CREATED', {
      apex_venture_id: 'apex-archive',
      project_name: 'Apex Archive',
    }, 'owner');

    expect(create.ok).toBe(true);
    expect(create.rezonate_project).toBeDefined();
    expect(create.rezonate_project.name).toBe('Apex Archive');
    const projectIdA = create.rezonate_project.id;

    // Process B (restart)
    resetRepo();
    const controllerB = new HeidiController();
    const status = await controllerB.processUserEvent('GET_APEX_PROJECT_STATUS', {
      apex_venture_id: 'apex-archive',
    }, 'owner');

    expect(status.ok).toBe(true);
    expect(status.rezonate_project.id).toBe(projectIdA);
    expect(status.rezonate_project.name).toBe('Apex Archive');
  });

  test('replaying the same project event after restart is idempotent', async () => {
    const controllerA = new HeidiController();
    const first = await controllerA.processUserEvent('APEX_PROJECT_CREATED', {
      apex_venture_id: 'apex-archive',
      project_name: 'Apex Archive',
    }, 'owner');
    expect(first.ok).toBe(true);
    const projectId = first.rezonate_project.id;

    resetRepo();
    const controllerB = new HeidiController();
    const second = await controllerB.processUserEvent('APEX_PROJECT_CREATED', {
      apex_venture_id: 'apex-archive',
      project_name: 'Apex Archive',
    }, 'owner');

    expect(second.ok).toBe(true);
    expect(second.idempotent).toBe(true);
    expect(second.rezonate_project.id).toBe(projectId);

    const list = require('../../lib/rezonate/rezonate-client').listProjects;
    const projects = await list();
    expect(projects.filter((p) => p.name === 'Apex Archive').length).toBe(1);
  });

  test('duplicate project event is blocked by Heidi idempotency window', async () => {
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

  test('APEX_EPISODE_CREATED records under the project', async () => {
    const controller = new HeidiController();
    const project = await controller.processUserEvent('APEX_PROJECT_CREATED', {
      apex_venture_id: 'apex-archive',
      project_name: 'Apex Archive',
    }, 'owner');
    expect(project.ok).toBe(true);

    const episode = await controller.processUserEvent('APEX_EPISODE_CREATED', {
      apex_venture_id: 'apex-archive',
      episode: { episode_id: '2026-08-14-ep-1', title: 'Test Episode' },
    }, 'owner');

    expect(episode.ok).toBe(true);
    expect(episode.rezonate_project_id).toBe(project.rezonate_project.id);

    const status = await controller.processUserEvent('GET_APEX_PROJECT_STATUS', {
      apex_venture_id: 'apex-archive',
    }, 'owner');
    expect(status.ok).toBe(true);
    expect(status.episodes_recorded).toBeGreaterThanOrEqual(1);
  });

  test('unauthorized Apex mutation is rejected', async () => {
    const controller = new HeidiController();
    const result = await controller.processUserEvent('APEX_PROJECT_CREATED', {
      apex_venture_id: 'apex-archive',
      project_name: 'Apex Archive',
    }, 'viewer');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/lacks permission 'apex:manage'/);
  });

  test('unsupported Apex capability is rejected', async () => {
    const controller = new HeidiController();
    const result = await controller.processUserEvent('APEX_UPLOAD', {
      apex_venture_id: 'apex-archive',
    }, 'owner');
    expect(result.ok).toBe(false);
    expect(result.state).toBe('SCAFFOLD');
  });

  test('GET_APEX_PROJECT_STATUS is truthful for missing project', async () => {
    const controller = new HeidiController();
    const result = await controller.processUserEvent('GET_APEX_PROJECT_STATUS', {
      apex_venture_id: 'unknown-venture',
    }, 'owner');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/has not been ingested/);
  });

  test('works without any Supabase environment', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const controller = new HeidiController();
    const result = await controller.processUserEvent('APEX_PROJECT_CREATED', {
      apex_venture_id: 'apex-archive',
      project_name: 'Apex Archive',
    }, 'owner');
    expect(result.ok).toBe(true);
    expect(result.rezonate_project).toBeDefined();
  });
});
