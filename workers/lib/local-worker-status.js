const fs = require('fs');
const path = require('path');

const DEFAULT_DATA_DIR = path.join(process.cwd(), 'data', 'hydi-local', 'jobs');

function getDataDir() {
  return process.env.HYDI_JOBS_DATA_DIR || DEFAULT_DATA_DIR;
}

function ensureDir() {
  const dir = getDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function statusFile() {
  return path.join(ensureDir(), 'worker-status.json');
}

function atomicWrite(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, filePath);
}

function loadStatuses() {
  const file = statusFile();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('[LocalWorkerStatus] failed to parse worker-status file:', e instanceof Error ? e.message : e);
    return [];
  }
}

function saveStatuses(statuses) {
  atomicWrite(statusFile(), JSON.stringify(statuses, null, 2) + '\n');
}

function ensureWorker(statuses, workerId) {
  let w = statuses.find((s) => s.worker_id === workerId);
  if (!w) {
    w = { worker_id: workerId, worker_type: null, status: 'idle', last_heartbeat: new Date().toISOString(), processed_count: 0, error_count: 0 };
    statuses.push(w);
  }
  return w;
}

class LocalWorkerStatus {
  async initialize() {}

  async registerWorker(workerType, workerId) {
    const statuses = loadStatuses();
    const w = ensureWorker(statuses, workerId);
    w.worker_type = workerType;
    w.status = 'idle';
    w.last_heartbeat = new Date().toISOString();
    saveStatuses(statuses);
  }

  async updateHeartbeat(workerId, status = null) {
    const statuses = loadStatuses();
    const w = ensureWorker(statuses, workerId);
    w.last_heartbeat = new Date().toISOString();
    if (status) w.status = status;
    saveStatuses(statuses);
  }

  async listWorkers(limit = 100) {
    const statuses = loadStatuses();
    return statuses
      .sort((a, b) => b.last_heartbeat.localeCompare(a.last_heartbeat))
      .slice(0, limit)
      .map((w) => ({
        worker_id: w.worker_id,
        worker_type: w.worker_type,
        status: w.status,
        last_heartbeat: w.last_heartbeat,
        processed_count: w.processed_count || 0,
        error_count: w.error_count || 0,
      }));
  }

  async markProcessed(workerId) {
    const statuses = loadStatuses();
    const w = ensureWorker(statuses, workerId);
    w.processed_count = (w.processed_count || 0) + 1;
    w.last_heartbeat = new Date().toISOString();
    saveStatuses(statuses);
  }

  async markError(workerId) {
    const statuses = loadStatuses();
    const w = ensureWorker(statuses, workerId);
    w.error_count = (w.error_count || 0) + 1;
    w.last_heartbeat = new Date().toISOString();
    saveStatuses(statuses);
  }
}

module.exports = LocalWorkerStatus;
