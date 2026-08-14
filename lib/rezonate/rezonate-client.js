/**
 * Heidi → Rezonate canonical client.
 *
 * Local-only bridge that routes through the canonical Rezonate repository
 * (protoforge-applications/rezonate/src/repository.js) instead of querying
 * Supabase tables directly.
 *
 * No cloud calls. No second persistence layer. No second repository.
 */

const path = require('path');
const { createRepository } = require('../../protoforge-applications/rezonate/src/repository');
const { collectDiagnostics } = require('../../protoforge-applications/rezonate/src/diagnostics');

const CONTRACT_PATH = path.join(__dirname, '..', '..', 'protoforge-applications', 'rezonate', 'capability-contract.json');

let _repo = null;
let _initPromise = null;
let _contract = null;

async function ensureRepo() {
  if (!_repo) {
    _repo = createRepository({
      config: {
        dataDir: path.join(__dirname, '..', '..', 'protoforge-applications', 'rezonate', 'data'),
        dbFile: 'heidi-db.json',
        eventLogFile: 'heidi-events.json',
        logLevel: 'info',
      },
    });
    _initPromise = _repo.init();
  }
  await _initPromise;
  return _repo;
}

function loadContract() {
  if (!_contract) {
    const fs = require('fs');
    _contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
  }
  return _contract;
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
