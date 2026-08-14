'use strict';

/**
 * Persistence guard for the Heidi → Rezonate control plane.
 *
 * Proves that canonical repository operations are written through the
 * canonical JsonStore to a local file and that a fresh repository/client
 * instance can recover the data.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// These tests exercise the real canonical client, not a mock.
const clientMod = require('../../lib/rezonate/rezonate-client.js');

let tmpDir;

function makeTempPaths() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rezonate-persistence-'));
  return {
    dataDir: tmpDir,
    dbFile: 'heidi-test.json',
    eventLogFile: 'heidi-test-events.json',
  };
}

function cleanup() {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

beforeEach(() => {
  clientMod.resetRepo();
  delete process.env.REZONATE_DATA_DIR;
  delete process.env.REZONATE_DB_FILE;
  delete process.env.REZONATE_EVENT_LOG_FILE;
  cleanup();
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  cleanup();
});

describe('Heidi → Rezonate canonical JSON persistence', () => {
  test('client creates a project and writes it to a JSON file', async () => {
    const { dataDir, dbFile, eventLogFile } = makeTempPaths();
    const client = await clientMod.createClient({ dataDir, dbFile, eventLogFile });

    const project = await client.createProject({ name: 'Persistence Test' });

    expect(project.name).toBe('Persistence Test');
    expect(project.id).toBeTruthy();

    const dbPath = path.join(dataDir, dbFile);
    expect(fs.existsSync(dbPath)).toBe(true);

    const persisted = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    expect(persisted.projects).toEqual(expect.any(Array));
    const found = persisted.projects.find((p) => p.id === project.id);
    expect(found).toBeTruthy();
    expect(found.name).toBe('Persistence Test');
  });

  test('a fresh client instance recovers the same project', async () => {
    const { dataDir, dbFile, eventLogFile } = makeTempPaths();

    const client1 = await clientMod.createClient({ dataDir, dbFile, eventLogFile });
    const project = await client1.createProject({ name: 'Persistence Test' });

    // Simulate discarding the first repository/client instance.
    const client2 = await clientMod.createClient({ dataDir, dbFile, eventLogFile });
    const projects = await client2.listProjects();
    const found = projects.find((p) => p.id === project.id);

    expect(found).toBeTruthy();
    expect(found.name).toBe('Persistence Test');

    const recovered = await client2.getProject(project.id);
    expect(recovered.name).toBe('Persistence Test');
  });

  test('persisted file contains no secrets', async () => {
    const { dataDir, dbFile, eventLogFile } = makeTempPaths();
    const client = await clientMod.createClient({ dataDir, dbFile, eventLogFile });

    await client.createProject({ name: 'Safe' });

    const dbPath = path.join(dataDir, dbFile);
    const raw = fs.readFileSync(dbPath, 'utf8');
    const lower = raw.toLowerCase();

    expect(lower).not.toContain('secret');
    expect(lower).not.toContain('token');
    expect(lower).not.toContain('password');
    expect(lower).not.toContain('api_key');
  });

  test('Heidi event is still emitted and the project persists', async () => {
    const { HeidiController } = require('../../pao-system/core/heidi.controller');
    const { dataDir, dbFile, eventLogFile } = makeTempPaths();

    process.env.REZONATE_DATA_DIR = dataDir;
    process.env.REZONATE_DB_FILE = dbFile;
    process.env.REZONATE_EVENT_LOG_FILE = eventLogFile;

    const controller = new HeidiController();
    controller.getAuditLog().clear();

    const result = await controller.processUserEvent(
      'REZONATE_CREATE_PROJECT',
      { name: 'Heidi Persistence Test' },
      'owner'
    );

    expect(result.ok).toBe(true);
    expect(result.project.name).toBe('Heidi Persistence Test');

    const audit = controller.getAuditLog().getByEventType('HEIDI_AGENT_SUCCESS');
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0].success).toBe(true);
    expect(audit[0].task_type).toBe('REZONATE_CREATE_PROJECT');

    const client = await clientMod.createClient({ dataDir, dbFile, eventLogFile });
    const projects = await client.listProjects();
    const found = projects.find((p) => p.id === result.project.id);
    expect(found).toBeTruthy();
    expect(found.name).toBe('Heidi Persistence Test');

    delete process.env.REZONATE_DATA_DIR;
    delete process.env.REZONATE_DB_FILE;
    delete process.env.REZONATE_EVENT_LOG_FILE;
  });

  test('failed persistence cannot produce a successful Heidi response', async () => {
    const { HeidiController } = require('../../pao-system/core/heidi.controller');

    process.env.REZONATE_DATA_DIR = '/nonexistent-rezonate-test-' + Date.now();
    process.env.REZONATE_DB_FILE = 'heidi-bad.json';
    process.env.REZONATE_EVENT_LOG_FILE = 'heidi-bad-events.json';

    const controller = new HeidiController();
    controller.getAuditLog().clear();

    const result = await controller.processUserEvent(
      'REZONATE_CREATE_PROJECT',
      { name: 'Should Fail' },
      'owner'
    );

    expect(result.ok).toBe(false);
    expect(result.project).toBeFalsy();

    const audit = controller.getAuditLog().getByEventType('HEIDI_AGENT_FAILURE');
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0].success).toBe(false);

    delete process.env.REZONATE_DATA_DIR;
    delete process.env.REZONATE_DB_FILE;
    delete process.env.REZONATE_EVENT_LOG_FILE;
  });
});
