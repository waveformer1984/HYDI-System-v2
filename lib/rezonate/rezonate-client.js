/**
 * Heidi → Rezonate canonical client.
 *
 * Local-only bridge that routes through the canonical Rezonate repository
 * (protoforge-applications/rezonate/src/repository.js) instead of querying
 * Supabase tables directly.
 *
 * Persistence is explicit: every repository instance is constructed with the
 * canonical JsonStore. No cloud calls. No second persistence layer. No second
 * repository.
 */

const fs = require('fs');
const path = require('path');
const { createRepository } = require('../../protoforge-applications/rezonate/src/repository');
const { createStore } = require('../../protoforge-applications/rezonate/src/persistence');
const { collectDiagnostics } = require('../../protoforge-applications/rezonate/src/diagnostics');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', '..', 'protoforge-applications', 'rezonate', 'data');
const DEFAULT_DB_FILE = 'heidi-db.json';
const DEFAULT_EVENT_LOG_FILE = 'heidi-events.json';
const CONTRACT_PATH = path.join(__dirname, '..', '..', 'protoforge-applications', 'rezonate', 'capability-contract.json');

function resolveClientPaths(opts = {}) {
  const dataDir = opts.dataDir || process.env.REZONATE_DATA_DIR || DEFAULT_DATA_DIR;
  const dbFile = opts.dbFile || process.env.REZONATE_DB_FILE || DEFAULT_DB_FILE;
  const eventLogFile = opts.eventLogFile || process.env.REZONATE_EVENT_LOG_FILE || DEFAULT_EVENT_LOG_FILE;
  const dbPath = path.isAbsolute(dbFile) ? dbFile : path.join(dataDir, dbFile);
  const eventLogPath = path.isAbsolute(eventLogFile) ? eventLogFile : path.join(dataDir, eventLogFile);
  return { dataDir, dbPath, eventLogPath };
}

async function buildRepo(opts = {}) {
  const { dataDir, dbPath, eventLogPath } = resolveClientPaths(opts);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const store = createStore({ type: 'json', filePath: dbPath });
  const repo = createRepository({
    config: {
      dataDir,
      dbPath,
      eventLogPath,
      logLevel: 'info',
    },
    store,
  });
  await repo.init();
  return { repo, dbPath, eventLogPath };
}

let _repo = null;
let _initPromise = null;
let _contract = null;

function resetRepo() {
  _repo = null;
  _initPromise = null;
}

async function ensureRepo(opts = {}) {
  if (!opts || (!opts.dataDir && !opts.dbFile)) {
    if (!_repo) {
      _repo = await buildRepo();
    }
    return _repo.repo;
  }
  const { repo } = await buildRepo(opts);
  return repo;
}

function loadContract() {
  if (!_contract) {
    _contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
  }
  return _contract;
}

async function createClient(opts = {}) {
  const repo = await buildRepo(opts);
  return makeApi(repo.repo);
}

function makeApi(repo) {
  return {
    createProject: (input) => repo.createProject(input),
    listProjects: () => repo.listProjects(),
    getProject: (id) => repo.getProject(id),
    createTrack: (projectId, input) => repo.createTrack(projectId, input),
    listTracks: (projectId) => repo.listTracks(projectId),
    createProcessingJob: (input) => repo.createProcessingJob(input),
    getProcessingJob: (id) => repo.getProcessingJob(id),
    listProcessingJobs: () => repo.listProcessingJobs(),
    getStoreSnapshot: () => repo.store.load(),
  };
}

async function getRezonateProjectStatus() {
  const repo = await ensureRepo();
  const projects = await repo.listProjects();
  return { count: projects.length, status: 'ok' };
}

async function getRezonateTrackStatus() {
  const repo = await ensureRepo();
  const projects = await repo.listProjects();
  const tracks = (await Promise.all(projects.map((p) => repo.listTracks(p.id)))).flat();
  return { count: tracks.length, status: 'ok' };
}

async function getRezonateHealth() {
  const repo = await ensureRepo();
  return collectDiagnostics(repo);
}

function getCapabilityState(capabilityId) {
  const contract = loadContract();
  const entry = contract.capabilities.find((c) => c.id === capabilityId);
  if (entry) return { id: entry.id, name: entry.name, state: entry.state, category: entry.category };
  return { id: capabilityId, name: null, state: 'UNKNOWN', category: null };
}

function listVerifiedCapabilities() {
  const contract = loadContract();
  const operational = ['FUNCTIONAL', 'VERIFIED', 'PRODUCTION'];
  return contract.capabilities
    .filter((c) => operational.includes(c.state))
    .map((c) => ({ id: c.id, name: c.name, state: c.state, category: c.category }));
}

function listInoperableCapabilities() {
  const contract = loadContract();
  const inoperable = ['PLANNED', 'SCAFFOLD', 'PARTIAL'];
  return contract.capabilities
    .filter((c) => inoperable.includes(c.state))
    .map((c) => ({ id: c.id, name: c.name, state: c.state, category: c.category }));
}

async function createProject(input) {
  const repo = await ensureRepo();
  return repo.createProject(input);
}

async function listProjects() {
  const repo = await ensureRepo();
  return repo.listProjects();
}

async function getProject(id) {
  const repo = await ensureRepo();
  return repo.getProject(id);
}

async function createTrack(projectId, input) {
  const repo = await ensureRepo();
  return repo.createTrack(projectId, input);
}

async function listTracks(projectId) {
  const repo = await ensureRepo();
  return repo.listTracks(projectId);
}

async function createProcessingJob(input) {
  const repo = await ensureRepo();
  return repo.createProcessingJob(input);
}

async function getProcessingJob(id) {
  const repo = await ensureRepo();
  return repo.getProcessingJob(id);
}

async function listProcessingJobs() {
  const repo = await ensureRepo();
  return repo.listProcessingJobs();
}

module.exports = {
  createClient,
  resetRepo,
  getRezonateProjectStatus,
  getRezonateTrackStatus,
  getRezonateHealth,
  getCapabilityState,
  listVerifiedCapabilities,
  listInoperableCapabilities,
  createProject,
  listProjects,
  getProject,
  createTrack,
  listTracks,
  createProcessingJob,
  getProcessingJob,
  listProcessingJobs,
};
