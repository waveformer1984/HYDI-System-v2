'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { HeidiController } = require('../../pao-system/core/heidi.controller');
const apexClient = require('../../lib/apex/apex-client');

describe('Apex Archive → Heidi integration', () => {
  let tmpApexDir;
  let tmpHydroDir;
  let oldEnv;

  beforeEach(() => {
    oldEnv = process.env.APEX_DATA_DIR;
    tmpApexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-archive-'));
    tmpHydroDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-apex-'));
    process.env.APEX_DATA_DIR = tmpHydroDir;

    const outbox = path.join(tmpApexDir, 'hydi_outbox');
    fs.mkdirSync(outbox, { recursive: true });

    const event = {
      event_id: 'apex-archive-1-abc',
      timestamp: '2026-08-14T20:00:00Z',
      event_type: 'episode_generated',
      source: 'apex-archive',
      project_id: 'apex-archive',
      schema_version: 'draft-3',
      correlation_id: null,
      payload: {
        episode_id: '2026-08-14-test-001',
        episode_title: 'Test Episode',
        tts_provider: 'espeak',
      },
    };
    fs.writeFileSync(path.join(outbox, '1_episode_generated.json'), JSON.stringify(event, null, 2));
  });

  afterEach(() => {
    if (oldEnv !== undefined) process.env.APEX_DATA_DIR = oldEnv;
    else delete process.env.APEX_DATA_DIR;
    fs.rmSync(tmpApexDir, { recursive: true, force: true });
    fs.rmSync(tmpHydroDir, { recursive: true, force: true });
  });

  test('Heidi records an Apex event and maps the project identity', async () => {
    const controller = new HeidiController();
    const result = await controller.processUserEvent('APEX_EPISODE_CREATED', {
      venture_id: 'apex-archive',
      rezonate_project_id: 'rproj-1',
      event: {
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
    expect(result.mapping.rezonate_project_id).toBe('rproj-1');
    expect(apexClient.listEvents().length).toBeGreaterThanOrEqual(1);
  });

  test('unauthorized Apex event is rejected', async () => {
    const controller = new HeidiController();
    const result = await controller.processUserEvent('APEX_EPISODE_CREATED', {
      venture_id: 'apex-archive',
      rezonate_project_id: 'rproj-1',
      event: { event_id: 'apex-archive-3-zzz', event_type: 'episode_generated' },
    }, 'viewer');

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/lacks permission 'apex:manage'/);
  });

  test('scaffold upload capability is rejected without fake success', async () => {
    const controller = new HeidiController();
    const result = await controller.processUserEvent('APEX_UPLOAD', {
      venture_id: 'apex-archive',
      rezonate_project_id: 'rproj-1',
      event: { event_id: 'apex-archive-4-upload' },
    }, 'owner');

    expect(result.ok).toBe(false);
    expect(result.state).toBe('SCAFFOLD');
  });

  test('forbidden publish capability is rejected', async () => {
    const controller = new HeidiController();
    const result = await controller.processUserEvent('APEX_PUBLISH', {
      venture_id: 'apex-archive',
      rezonate_project_id: 'rproj-1',
      event: { event_id: 'apex-archive-5-pub' },
    }, 'owner');

    expect(result.ok).toBe(false);
    expect(result.state).toBe('FORBIDDEN');
  });
});
