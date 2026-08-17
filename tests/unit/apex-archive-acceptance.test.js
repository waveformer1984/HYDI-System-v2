'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { HeidiController } = require('../../pao-system/core/heidi.controller');
const apexClient = require('../../lib/apex/apex-client');
const { resetRepo } = require('../../lib/rezonate/rezonate-client');

describe('Apex Archive → Heidi integration', () => {
  let tmpApexDir;
  let tmpApexDataDir;
  let tmpRezonateDir;
  let oldApexEnv;

  beforeEach(() => {
    oldApexEnv = process.env.APEX_DATA_DIR;
    tmpApexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-archive-'));
    tmpApexDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-apex-'));
    tmpRezonateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-rezonate-'));
    process.env.APEX_DATA_DIR = tmpApexDataDir;
    process.env.REZONATE_DATA_DIR = tmpRezonateDir;
    resetRepo();

    const outbox = path.join(tmpApexDir, 'hydi_outbox');
    fs.mkdirSync(outbox, { recursive: true });
  });

  afterEach(() => {
    if (oldApexEnv !== undefined) process.env.APEX_DATA_DIR = oldApexEnv;
    else delete process.env.APEX_DATA_DIR;
    delete process.env.REZONATE_DATA_DIR;
    fs.rmSync(tmpApexDir, { recursive: true, force: true });
    fs.rmSync(tmpApexDataDir, { recursive: true, force: true });
    fs.rmSync(tmpRezonateDir, { recursive: true, force: true });
  });

  test('Heidi records an Apex event and maps the project identity', async () => {
    const controller = new HeidiController();

    const created = await controller.processUserEvent('APEX_PROJECT_CREATED', {
      apex_venture_id: 'apex-archive',
      project_name: 'Apex Archive',
    }, 'owner');
    expect(created.ok).toBe(true);

    const result = await controller.processUserEvent('APEX_EPISODE_CREATED', {
      apex_venture_id: 'apex-archive',
      episode: {
        event_id: 'apex-archive-2-xyz',
        timestamp: '2026-08-14T20:01:00Z',
        event_type: 'episode_generated',
        source: 'apex-archive',
        project_id: 'apex-archive',
        schema_version: 'draft-3',
        payload: { episode_id: '2026-08-14-test-002', episode_title: 'Test 2' },
      },
    }, 'owner');

    expect(result.ok).toBe(true);
    expect(result.mapping.apex_venture_id).toBe('apex-archive');
    expect(result.rezonate_project_id).toBe(created.rezonate_project.id);
    expect(apexClient.listEvents().length).toBeGreaterThanOrEqual(1);
  });

  test('unauthorized Apex event is rejected', async () => {
    const controller = new HeidiController();
    const result = await controller.processUserEvent('APEX_EPISODE_CREATED', {
      apex_venture_id: 'apex-archive',
      episode: { event_id: 'apex-archive-3-zzz', event_type: 'episode_generated' },
    }, 'viewer');

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/lacks permission 'apex:manage'/);
  });

  test('scaffold upload capability is rejected without fake success', async () => {
    const controller = new HeidiController();
    const result = await controller.processUserEvent('APEX_UPLOAD', {
      apex_venture_id: 'apex-archive',
      event: { event_id: 'apex-archive-4-upload' },
    }, 'owner');

    expect(result.ok).toBe(false);
    expect(result.state).toBe('SCAFFOLD');
  });

  test('forbidden publish capability is rejected', async () => {
    const controller = new HeidiController();
    const result = await controller.processUserEvent('APEX_PUBLISH', {
      apex_venture_id: 'apex-archive',
      event: { event_id: 'apex-archive-5-pub' },
    }, 'owner');

    expect(result.ok).toBe(false);
    expect(result.state).toBe('FORBIDDEN');
  });
});
