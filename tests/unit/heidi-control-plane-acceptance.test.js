'use strict';

/**
 * Heidi → Rezonate control-plane hardening acceptance suite.
 *
 * Single suite covering authority, intent normalization, failure safety,
 * idempotency, auditability, health, capability awareness, and security
 * for the five verified Rezonate operations.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const clientMod = require('../../lib/rezonate/rezonate-client.js');
const { normalizeRezonateIntent } = require('../../lib/rezonate/intent.js');
const { getTaskCapabilityState } = require('../../lib/rezonate/capability-guard.js');
const { getRezonateControlHealth } = require('../../lib/rezonate/control-health.js');

let tmpDir;

function makeTempPaths() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heidi-cp-'));
  return {
    dataDir: tmpDir,
    dbFile: 'heidi-acceptance.json',
    eventLogFile: 'heidi-acceptance-events.json',
  };
}

function cleanup() {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function withTempEnv(dataDir, dbFile, eventLogFile, fn) {
  process.env.REZONATE_DATA_DIR = dataDir;
  process.env.REZONATE_DB_FILE = dbFile;
  process.env.REZONATE_EVENT_LOG_FILE = eventLogFile;
  return fn().finally(() => {
    delete process.env.REZONATE_DATA_DIR;
    delete process.env.REZONATE_DB_FILE;
    delete process.env.REZONATE_EVENT_LOG_FILE;
  });
}

beforeEach(() => {
  clientMod.resetRepo();
  cleanup();
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  cleanup();
});

describe('Heidi → Rezonate control plane', () => {
  // ── 1. AUTHORITY ─────────────────────────────────────────────────────────────
  describe('authority', () => {
    test.each([
      ['REZONATE_CREATE_PROJECT', { name: 'Auth Project' }],
      ['REZONATE_CREATE_TRACK', { projectId: 'p1', name: 'Auth Track' }],
    ])('%s requires rezonate:manage and succeeds for owner', async (type, input) => {
      const { HeidiController } = require('../../pao-system/core/heidi.controller');
      const { dataDir, dbFile, eventLogFile } = makeTempPaths();
      await withTempEnv(dataDir, dbFile, eventLogFile, async () => {
        if (type === 'REZONATE_CREATE_TRACK') {
          const client = await clientMod.createClient({ dataDir, dbFile, eventLogFile });
          const p = await client.createProject({ name: 'Parent' });
          input.projectId = p.id;
        }
        const controller = new HeidiController();
        const result = await controller.processUserEvent(type, input, 'owner');
        expect(result.ok).toBe(true);
        const audit = controller.getAuditLog().getByEventType('HEIDI_AGENT_SUCCESS');
        expect(audit.some((r) => r.task_type === type && r.success)).toBe(true);
      });
    });

    test.each([
      ['REZONATE_CREATE_PROJECT', { name: 'No' }],
      ['REZONATE_CREATE_TRACK', { projectId: 'p1', name: 'No' }],
    ])('%s is rejected for viewer', async (type, input) => {
      const { HeidiController } = require('../../pao-system/core/heidi.controller');
      const controller = new HeidiController();
      const result = await controller.processUserEvent(type, input, 'viewer');
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/lacks permission 'rezonate:manage'/);
      const audit = controller.getAuditLog().getByEventType('HEIDI_PERMISSION_DENIED');
      expect(audit.length).toBeGreaterThan(0);
      expect(audit[0].success).toBe(false);
    });

    test('read operations are also gated by rezonate:manage', async () => {
      const { HeidiController } = require('../../pao-system/core/heidi.controller');
      const controller = new HeidiController();
      const result = await controller.processUserEvent('REZONATE_LIST_PROJECTS', {}, 'viewer');
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/lacks permission 'rezonate:manage'/);
    });

    test('no repository write occurs after authorization failure', async () => {
      const { HeidiController } = require('../../pao-system/core/heidi.controller');
      const { dataDir, dbFile, eventLogFile } = makeTempPaths();
      await withTempEnv(dataDir, dbFile, eventLogFile, async () => {
        const controller = new HeidiController();
        await controller.processUserEvent('REZONATE_CREATE_PROJECT', { name: 'Should Not Write' }, 'viewer');
        const client = await clientMod.createClient({ dataDir, dbFile, eventLogFile });
        const projects = await client.listProjects();
        expect(projects).toHaveLength(0);
      });
    });
  });

  // ── 2. INTENT NORMALIZATION ──────────────────────────────────────────────────
  describe('intent normalization', () => {
    test('valid create-project intent', () => {
      const result = normalizeRezonateIntent('create a project called Demo');
      expect(result).toEqual({ ok: true, taskType: 'REZONATE_CREATE_PROJECT', parameters: { name: 'Demo' } });
    });

    test('valid create-track intent', () => {
      const result = normalizeRezonateIntent('create a track called Drums in project p-1');
      expect(result.ok).toBe(true);
      expect(result.taskType).toBe('REZONATE_CREATE_TRACK');
      expect(result.parameters).toEqual({ name: 'Drums', projectId: 'p-1' });
    });

    test('missing required parameter returns explicit reason', () => {
      const result = normalizeRezonateIntent('create a project called');
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/malformed/);
    });

    test('malformed request is rejected', () => {
      const result = normalizeRezonateIntent('create a track in project');
      expect(result.ok).toBe(false);
    });

    test('ambiguous request is rejected', () => {
      const result = normalizeRezonateIntent('do something with rezonate');
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('unrecognized_intent');
    });

    test('unsupported capability is classified, not hallucinated', () => {
      const result = normalizeRezonateIntent('update project Alpha');
      expect(result.ok).toBe(false);
      expect(result.taskType).toBe('REZONATE_UPDATE_PROJECT');
      expect(result.state).toBe('MISSING');
    });

    test('forbidden intent is rejected', () => {
      const result = normalizeRezonateIntent('delete project Alpha');
      expect(result.ok).toBe(false);
      expect(result.state).toBe('FORBIDDEN');
    });
  });

  // ── 3. CAPABILITY AWARENESS ──────────────────────────────────────────────────
  describe('capability awareness', () => {
    test.each([
      ['REZONATE_CREATE_PROJECT', 'VERIFIED'],
      ['REZONATE_CREATE_TRACK', 'VERIFIED'],
      ['REZONATE_GET_TRACK', 'MISSING'],
      ['REZONATE_UPDATE_PROJECT', 'MISSING'],
      ['REZONATE_UPDATE_TRACK', 'MISSING'],
    ])('%s is reported as %s', (taskType, expectedState) => {
      const state = getTaskCapabilityState(taskType);
      expect(state.heidiState).toBe(expectedState);
    });

    test('HeidiController rejects unverified task types before routing', async () => {
      const { HeidiController } = require('../../pao-system/core/heidi.controller');
      const controller = new HeidiController();
      const result = await controller.processUserEvent('REZONATE_CREATE_JOB', { task_type: 'generate' }, 'owner');
      expect(result.ok).toBe(false);
      expect(result.state).toBe('FUNCTIONAL');
      const audit = controller.getAuditLog().getByEventType('HEIDI_CAPABILITY_UNSUPPORTED');
      expect(audit.length).toBeGreaterThan(0);
    });

    test('forbidden task is rejected before routing', async () => {
      const { HeidiController } = require('../../pao-system/core/heidi.controller');
      const controller = new HeidiController();
      const result = await controller.processUserEvent('REZONATE_NFT', {}, 'owner');
      expect(result.ok).toBe(false);
      expect(result.state).toBe('FORBIDDEN');
    });
  });

  // ── 4. FAILURE SAFETY ────────────────────────────────────────────────────────
  describe('failure safety', () => {
    test('repository failure cannot produce success', async () => {
      const { HeidiController } = require('../../pao-system/core/heidi.controller');
      process.env.REZONATE_DATA_DIR = '/nonexistent-rezonate-test-' + Date.now();
      process.env.REZONATE_DB_FILE = 'bad.json';
      process.env.REZONATE_EVENT_LOG_FILE = 'bad-events.json';
      const controller = new HeidiController();
      const result = await controller.processUserEvent('REZONATE_CREATE_PROJECT', { name: 'Fails' }, 'owner');
      expect(result.ok).toBe(false);
      const successAudit = controller.getAuditLog().getByEventType('HEIDI_AGENT_SUCCESS');
      expect(successAudit).toHaveLength(0);
      const failureAudit = controller.getAuditLog().getByEventType('HEIDI_AGENT_FAILURE');
      expect(failureAudit.length).toBeGreaterThan(0);
      expect(failureAudit[0].success).toBe(false);
      delete process.env.REZONATE_DATA_DIR;
      delete process.env.REZONATE_DB_FILE;
      delete process.env.REZONATE_EVENT_LOG_FILE;
    });

    test('malformed payload is rejected before repository', async () => {
      const { HeidiController } = require('../../pao-system/core/heidi.controller');
      const { dataDir, dbFile, eventLogFile } = makeTempPaths();
      await withTempEnv(dataDir, dbFile, eventLogFile, async () => {
        const controller = new HeidiController();
        const result = await controller.processUserEvent('REZONATE_CREATE_PROJECT', {}, 'owner');
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/requires.*name/);
      });
    });

    test('nonexistent project get returns truthful error', async () => {
      const { HeidiController } = require('../../pao-system/core/heidi.controller');
      const { dataDir, dbFile, eventLogFile } = makeTempPaths();
      await withTempEnv(dataDir, dbFile, eventLogFile, async () => {
        const controller = new HeidiController();
        const result = await controller.processUserEvent('REZONATE_GET_PROJECT', { id: 'missing' }, 'owner');
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/Project not found/);
      });
    });
  });

  // ── 5. IDEMPOTENCY / DUPLICATE SAFETY ────────────────────────────────────────
  describe('idempotency', () => {
    test('duplicate create-project within the window is blocked', async () => {
      const { HeidiController } = require('../../pao-system/core/heidi.controller');
      const { dataDir, dbFile, eventLogFile } = makeTempPaths();
      await withTempEnv(dataDir, dbFile, eventLogFile, async () => {
        const controller = new HeidiController();
        const first = await controller.processUserEvent('REZONATE_CREATE_PROJECT', { name: 'Once' }, 'owner');
        expect(first.ok).toBe(true);
        const second = await controller.processUserEvent('REZONATE_CREATE_PROJECT', { name: 'Once' }, 'owner');
        expect(second.ok).toBe(false);
        expect(second.reason).toMatch(/duplicate/);
        const client = await clientMod.createClient({ dataDir, dbFile, eventLogFile });
        const projects = await client.listProjects();
        expect(projects.filter((p) => p.name === 'Once')).toHaveLength(1);
      });
    });

    test('canonical repository creates duplicates when not guarded; Heidi guards it', async () => {
      const { dataDir, dbFile, eventLogFile } = makeTempPaths();
      const client = await clientMod.createClient({ dataDir, dbFile, eventLogFile });
      const a = await client.createProject({ name: 'Same' });
      const b = await client.createProject({ name: 'Same' });
      expect(a.id).not.toBe(b.id);
    });
  });

  // ── 6. AUDIT EVENTS ──────────────────────────────────────────────────────────
  describe('audit events', () => {
    test('successful mutation produces a complete auditable record', async () => {
      const { HeidiController } = require('../../pao-system/core/heidi.controller');
      const { dataDir, dbFile, eventLogFile } = makeTempPaths();
      await withTempEnv(dataDir, dbFile, eventLogFile, async () => {
        const controller = new HeidiController();
        const result = await controller.processUserEvent('REZONATE_CREATE_PROJECT', { name: 'Audit Me' }, 'owner');
        expect(result.ok).toBe(true);
        const audit = controller.getAuditLog().getByEventType('HEIDI_AGENT_SUCCESS');
        expect(audit.length).toBeGreaterThan(0);
        const record = audit[0];
        expect(record.task_type).toBe('REZONATE_CREATE_PROJECT');
        expect(record.event_type).toBe('HEIDI_AGENT_SUCCESS');
        expect(record.timestamp).toBeTruthy();
        expect(record.success).toBe(true);
        expect(record.result.project.id).toBe(result.project.id);
      });
    });

    test('failed operation does not emit a success event', async () => {
      const { HeidiController } = require('../../pao-system/core/heidi.controller');
      const { dataDir, dbFile, eventLogFile } = makeTempPaths();
      await withTempEnv(dataDir, dbFile, eventLogFile, async () => {
        const controller = new HeidiController();
        const result = await controller.processUserEvent('REZONATE_GET_PROJECT', { id: 'missing' }, 'owner');
        expect(result.ok).toBe(false);
        const successAudit = controller.getAuditLog().getByEventType('HEIDI_AGENT_SUCCESS');
        expect(successAudit).toHaveLength(0);
        const failureAudit = controller.getAuditLog().getByEventType('HEIDI_AGENT_FAILURE');
        expect(failureAudit.length).toBeGreaterThan(0);
        expect(failureAudit[0].success).toBe(false);
        expect(failureAudit[0].failure_reason).toBeTruthy();
      });
    });

    test('audit payload contains no secrets', async () => {
      const { HeidiController } = require('../../pao-system/core/heidi.controller');
      const controller = new HeidiController();
      await controller.processUserEvent('REZONATE_CREATE_PROJECT', { name: 'Safe' }, 'owner');
      const raw = controller.getAuditLog().getRecent();
      const text = JSON.stringify(raw).toLowerCase();
      expect(text).not.toContain('secret');
      expect(text).not.toContain('token');
      expect(text).not.toContain('password');
      expect(text).not.toContain('api_key');
    });
  });

  // ── 7. OPERATIONAL HEALTH ────────────────────────────────────────────────────
  describe('operational health', () => {
    test('health surface reports each control-plane layer independently', async () => {
      const { dataDir, dbFile, eventLogFile } = makeTempPaths();
      const health = await getRezonateControlHealth({ dataDir, dbFile, eventLogFile });
      expect(health).toHaveProperty('heidi_controller');
      expect(health).toHaveProperty('task_router');
      expect(health).toHaveProperty('rezonate_agent');
      expect(health).toHaveProperty('rezonate_client');
      expect(health).toHaveProperty('local_persistence');
      expect(health).toHaveProperty('event_bus');
      for (const layer of Object.values([health.heidi_controller, health.task_router, health.rezonate_agent, health.rezonate_client, health.local_persistence, health.event_bus])) {
        expect(layer).toHaveProperty('available');
      }
      expect(health.ok).toBe(true);
    });

    test('local persistence failure is reported accurately', async () => {
      const health = await getRezonateControlHealth({ dataDir: '/nonexistent-root-' + Date.now() });
      expect(health.local_persistence.available || health.rezonate_client.available).toBe(false);
    });
  });

  // ── 8. END-TO-END ACCEPTANCE ─────────────────────────────────────────────────
  describe('end-to-end', () => {
    test('CREATE_PROJECT → LIST_PROJECTS → GET_PROJECT', async () => {
      const { HeidiController } = require('../../pao-system/core/heidi.controller');
      const { dataDir, dbFile, eventLogFile } = makeTempPaths();
      await withTempEnv(dataDir, dbFile, eventLogFile, async () => {
        const controller = new HeidiController();
        const create = await controller.processUserEvent('REZONATE_CREATE_PROJECT', { name: 'E2E' }, 'owner');
        expect(create.ok).toBe(true);

        const list = await controller.processUserEvent('REZONATE_LIST_PROJECTS', {}, 'owner');
        expect(list.ok).toBe(true);
        expect(list.count).toBeGreaterThan(0);

        const get = await controller.processUserEvent('REZONATE_GET_PROJECT', { id: create.project.id }, 'owner');
        expect(get.ok).toBe(true);
        expect(get.project.name).toBe('E2E');
      });
    });

    test('CREATE_TRACK → LIST_TRACKS with restart recovery', async () => {
      const { HeidiController } = require('../../pao-system/core/heidi.controller');
      const { dataDir, dbFile, eventLogFile } = makeTempPaths();
      await withTempEnv(dataDir, dbFile, eventLogFile, async () => {
        const controller = new HeidiController();
        const project = await controller.processUserEvent('REZONATE_CREATE_PROJECT', { name: 'Track Parent' }, 'owner');
        expect(project.ok).toBe(true);

        const track = await controller.processUserEvent('REZONATE_CREATE_TRACK', { projectId: project.project.id, name: 'E2E Track' }, 'owner');
        expect(track.ok).toBe(true);

        // Fresh client, simulating a new process, recovers the track.
        const client = await clientMod.createClient({ dataDir, dbFile, eventLogFile });
        const tracks = await client.listTracks(project.project.id);
        const found = tracks.find((t) => t.id === track.track.id);
        expect(found).toBeTruthy();
        expect(found.name).toBe('E2E Track');
      });
    });
  });

  // ── 9. SECURITY ──────────────────────────────────────────────────────────────
  describe('security', () => {
    test('unknown role is rejected', async () => {
      const { HeidiController } = require('../../pao-system/core/heidi.controller');
      const controller = new HeidiController();
      const result = await controller.processUserEvent('REZONATE_LIST_PROJECTS', {}, 'hacker');
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/lacks permission 'rezonate:manage'/);
    });

    test('Heidi does not bypass the canonical repository', async () => {
      const { HeidiController } = require('../../pao-system/core/heidi.controller');
      const { dataDir, dbFile, eventLogFile } = makeTempPaths();
      await withTempEnv(dataDir, dbFile, eventLogFile, async () => {
        const controller = new HeidiController();
        const result = await controller.processUserEvent('REZONATE_CREATE_PROJECT', { name: 'Canonical' }, 'owner');
        const dbPath = path.join(dataDir, dbFile);
        expect(fs.existsSync(dbPath)).toBe(true);
        const persisted = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        expect(persisted.projects).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Canonical' })]));
      });
    });

    test('no cloud Supabase is required for local Rezonate path', () => {
      const source = fs.readFileSync(path.join(__dirname, '../../lib/rezonate/rezonate-client.js'), 'utf8');
      expect(source).not.toContain('@supabase');
      expect(source).not.toContain('supabase');
    });
  });
});
