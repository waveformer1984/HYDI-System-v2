'use strict';

/**
 * End-to-end acceptance for the Heidi → Rezonate operational control plane.
 *
 * Exercises the full vertical slice:
 *   User intent → normalization → HeidiController → TaskRouter → RezonateAgent
 *   → canonical client → repository → local persistence → audit event → response.
 *
 * Both success and failure paths are tested.
 */

const { normalizeRezonateIntent } = require('../../lib/rezonate/intent.js');
const { HeidiController } = require('../../pao-system/core/heidi.controller');
const { getRezonateControlHealth } = require('../../lib/rezonate/control-health.js');

jest.mock('../../lib/rezonate/rezonate-client.js', () => {
  const fs = require('fs');
  const path = require('path');
  return {
    createProject: jest.fn(async (input) => {
      if (!input || !input.name) throw new Error('name required');
      return { id: 'proj-123', name: input.name, status: 'draft' };
    }),
    listProjects: jest.fn(async () => [
      { id: 'proj-123', name: 'Existing', status: 'draft' },
    ]),
    getProject: jest.fn(async (id) => {
      if (id === 'missing') throw new Error('Project not found');
      return { id, name: 'Found', status: 'draft' };
    }),
    createTrack: jest.fn(async (projectId, input) => {
      if (!projectId) throw new Error('projectId required');
      return { id: 'track-123', project_id: projectId, name: input.name };
    }),
    listTracks: jest.fn(async (projectId) => {
      if (projectId === 'missing') throw new Error('Project not found');
      return [{ id: 'track-1', project_id: projectId, name: 'Track A' }];
    }),
    resetRepo: jest.fn(() => {}),
    createClient: jest.fn(async ({ dataDir, dbFile }) => {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(
        path.join(dataDir, dbFile),
        JSON.stringify({ schemaVersion: 1, projects: [], tracks: [], assets: [], processing_jobs: [] })
      );
      return { listProjects: jest.fn(async () => []) };
    }),
  };
});

describe('Heidi → Rezonate control plane (end-to-end)', () => {
  let controller;

  beforeEach(() => {
    controller = new HeidiController();
    controller.getAuditLog().clear();
  });

  test('SUCCESS: create a project called Demo', async () => {
    const intent = normalizeRezonateIntent('create a project called Demo');
    expect(intent.ok).toBe(true);
    expect(intent.taskType).toBe('REZONATE_CREATE_PROJECT');
    expect(intent.parameters).toEqual({ name: 'Demo' });

    const result = await controller.processUserEvent(intent.taskType, intent.parameters, 'owner');

    expect(result.ok).toBe(true);
    expect(result.project.name).toBe('Demo');
    expect(result.project.id).toBe('proj-123');

    const audit = controller.getAuditLog().getByEventType('HEIDI_AGENT_SUCCESS');
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0].success).toBe(true);
    expect(audit[0].task_type).toBe('REZONATE_CREATE_PROJECT');
  });

  test('SUCCESS: list projects', async () => {
    const intent = normalizeRezonateIntent('list all projects');
    expect(intent.ok).toBe(true);
    expect(intent.taskType).toBe('REZONATE_LIST_PROJECTS');

    const result = await controller.processUserEvent(intent.taskType, intent.parameters, 'owner');

    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
  });

  test('SUCCESS: get a project', async () => {
    const intent = normalizeRezonateIntent('get project proj-123');
    expect(intent.ok).toBe(true);
    expect(intent.taskType).toBe('REZONATE_GET_PROJECT');

    const result = await controller.processUserEvent(intent.taskType, intent.parameters, 'owner');

    expect(result.ok).toBe(true);
    expect(result.project.id).toBe('proj-123');
  });

  test('SUCCESS: create track in a project', async () => {
    const intent = normalizeRezonateIntent('create a track called Intro in project proj-123');
    expect(intent.ok).toBe(true);
    expect(intent.taskType).toBe('REZONATE_CREATE_TRACK');

    const result = await controller.processUserEvent(intent.taskType, intent.parameters, 'owner');

    expect(result.ok).toBe(true);
    expect(result.track.project_id).toBe('proj-123');
    expect(result.track.name).toBe('Intro');
  });

  test('SUCCESS: list tracks in a project', async () => {
    const intent = normalizeRezonateIntent('list tracks for project proj-123');
    expect(intent.ok).toBe(true);
    expect(intent.taskType).toBe('REZONATE_LIST_TRACKS');

    const result = await controller.processUserEvent(intent.taskType, intent.parameters, 'owner');

    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
  });

  test('FAILURE: unauthorized mutation (viewer role)', async () => {
    const result = await controller.processUserEvent(
      'REZONATE_CREATE_PROJECT',
      { name: 'Bad' },
      'viewer'
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("role 'viewer' lacks permission 'rezonate:manage'");

    const audit = controller.getAuditLog().getByEventType('HEIDI_PERMISSION_DENIED');
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0].success).toBe(false);
    expect(audit[0].failure_reason).toContain('viewer');
  });

  test('FAILURE: malformed task cannot reach the repository', async () => {
    const result = await controller.processUserEvent(
      'REZONATE_CREATE_PROJECT',
      {},
      'owner'
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('REZONATE_CREATE_PROJECT requires { name: string }');

    const audit = controller.getAuditLog().getByEventType('HEIDI_AGENT_FAILURE');
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0].success).toBe(false);
    expect(audit[0].task_type).toBe('REZONATE_CREATE_PROJECT');
  });

  test('FAILURE: repository error does not produce a successful Heidi response', async () => {
    const result = await controller.processUserEvent(
      'REZONATE_GET_PROJECT',
      { id: 'missing' },
      'owner'
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Project not found');

    const audit = controller.getAuditLog().getByEventType('HEIDI_AGENT_FAILURE');
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0].success).toBe(false);
    expect(audit[0].failure_reason).toBe('Project not found');
  });

  test('NORMALIZATION: ambiguous/forbidden intents fail safely', () => {
    expect(normalizeRezonateIntent('delete project proj-1')).toEqual(
      expect.objectContaining({ ok: false, reason: expect.stringMatching(/forbidden|not permitted/) })
    );
    expect(normalizeRezonateIntent('hello')).toEqual(
      expect.objectContaining({ ok: false, reason: 'unrecognized_intent' })
    );
    expect(normalizeRezonateIntent('')).toEqual(
      expect.objectContaining({ ok: false, reason: 'empty_message' })
    );
  });

  test('HEALTH: local control-plane health surface reports each layer', async () => {
    const health = await getRezonateControlHealth();
    expect(health.ok).toBe(true);
    expect(health.heidi_controller.available).toBe(true);
    expect(health.rezonate_agent.available).toBe(true);
    expect(health.rezonate_canonical_api.available).toBe(true);
    expect(health.local_persistence.available).toBe(true);
    expect(health.event_bus.available).toBe(true);
  });
});
