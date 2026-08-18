const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

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

function jobsFile() {
  return path.join(ensureDir(), 'worker-queues.json');
}

function atomicWrite(filePath, data) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, filePath);
}

function loadJobs() {
  const file = jobsFile();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('[LocalJobStore] failed to parse jobs file:', e instanceof Error ? e.message : e);
    return [];
  }
}

function saveJobs(jobs) {
  atomicWrite(jobsFile(), JSON.stringify(jobs, null, 2) + '\n');
}

class LocalJobStore {
  async initialize() {}

  async enqueue(queueName, payload, priority = 0, maxAttempts = 3) {
    const jobs = loadJobs();
    const id = uuidv4();
    const job = {
      id,
      queue_name: queueName,
      payload,
      status: 'pending',
      priority,
      attempts: 0,
      max_attempts: maxAttempts,
      created_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      error_message: null,
    };
    jobs.push(job);
    saveJobs(jobs);
    return id;
  }

  async dequeue(queueName, workerId) {
    const jobs = loadJobs();
    const now = new Date();

    const candidates = jobs
      .filter((j) =>
        j.queue_name === queueName &&
        j.status === 'pending' &&
        j.attempts < j.max_attempts &&
        new Date(j.created_at) <= now
      )
      .sort((a, b) => b.priority - a.priority || a.created_at.localeCompare(b.created_at));

    const job = candidates[0];
    if (!job) return null;

    job.status = 'processing';
    job.attempts += 1;
    job.started_at = new Date().toISOString();
    job.worker_id = workerId;
    saveJobs(jobs);
    return {
      id: job.id,
      queue_name: job.queue_name,
      payload: job.payload,
      status: job.status,
      priority: job.priority,
      attempts: job.attempts,
      max_attempts: job.max_attempts,
      created_at: job.created_at,
      started_at: job.started_at,
    };
  }

  async completeTask(taskId, workerId, success = true, errorMessage = null) {
    const jobs = loadJobs();
    const job = jobs.find((j) => j.id === taskId);
    if (!job) throw new Error(`Job ${taskId} not found`);

    if (success) {
      job.status = 'completed';
      job.completed_at = new Date().toISOString();
      job.error_message = null;
    } else {
      job.error_message = errorMessage;
      if (job.attempts >= job.max_attempts) {
        job.status = 'failed';
        job.completed_at = new Date().toISOString();
      } else {
        job.status = 'pending';
        job.started_at = null;
        job.worker_id = null;
      }
    }
    saveJobs(jobs);
  }

  async getTask(taskId) {
    const jobs = loadJobs();
    return jobs.find((j) => j.id === taskId) || null;
  }

  async getQueueStats(queueName = null) {
    const jobs = loadJobs();
    const filtered = queueName ? jobs.filter((j) => j.queue_name === queueName) : jobs;
    const stats = {};
    for (const row of filtered) {
      stats[row.status] = (stats[row.status] || 0) + 1;
    }
    return stats;
  }

  async retry(taskId) {
    const jobs = loadJobs();
    const job = jobs.find((j) => j.id === taskId);
    if (!job) return false;
    if (job.status !== 'failed' && job.status !== 'completed') return false;
    job.status = 'pending';
    job.attempts = 0;
    job.started_at = null;
    job.completed_at = null;
    job.error_message = null;
    job.worker_id = null;
    saveJobs(jobs);
    return true;
  }
}

module.exports = LocalJobStore;
