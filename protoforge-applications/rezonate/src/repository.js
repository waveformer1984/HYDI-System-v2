const crypto = require('crypto');
const { createStore } = require('./persistence');
const { EventBus, MemoryTransport } = require('./events/event-bus');
const { ValidationError, NotFoundError, ConflictError } = require('./errors');
const { createLogger } = require('./logger');
const { validateProject, validateAsset } = require('./validation');

function now() { return new Date().toISOString(); }
function id() { return crypto.randomUUID(); }

function ensureFound(record, message) {
  if (!record) throw new NotFoundError(message);
  return record;
}

class ResonateRepository {
  constructor(store, eventBus, logger) {
    this.store = store;
    this.eventBus = eventBus || new EventBus();
    this.logger = logger || createLogger({ level: 'info' });
  }

  async init() { await this.store.init(); }

  createProject(input) {
    const validated = validateProject(input);
    const project = { id: id(), ...validated, status: 'draft', created_at: now(), updated_at: now() };
    this.store.create('projects', project);
    this.eventBus.emit('project.created', project);
    this.logger.info('repository', 'project.created', `Project ${project.id} created`, { projectId: project.id });
    return { ...project };
  }

  getProject(id) {
    return ensureFound(this.store.getById('projects', id), 'Project not found');
  }

  listProjects() {
    return this.store.getAll('projects');
  }

  createTrack(projectId, input) {
    this.getProject(projectId);
    const name = (input && input.name) || 'Track';
    const track = {
      id: id(),
      project_id: projectId,
      name,
      type: input.type || 'audio',
      muted: false,
      solo: false,
      volume: 0.0,
      pan: 0.0,
      position: 0,
      created_at: now()
    };
    this.store.create('tracks', track);
    this.eventBus.emit('track.created', track);
    this.logger.info('repository', 'track.created', `Track ${track.id} created`, { trackId: track.id });
    return { ...track };
  }

  listTracks(projectId) {
    return this.store.getAll('tracks').filter(t => t.project_id === projectId);
  }

  registerAsset(projectId, input) {
    this.getProject(projectId);
    const validated = validateAsset(input);
    const asset = {
      id: id(),
      project_id: projectId,
      ...validated,
      duration_seconds: input.duration_seconds || null,
      sample_rate: input.sample_rate || null,
      bit_depth: input.bit_depth || null,
      file_size_bytes: input.file_size_bytes || null,
      created_at: now()
    };
    this.store.create('assets', asset);
    this.eventBus.emit('audio.asset.created', asset);
    this.logger.info('repository', 'audio.asset.created', `Asset ${asset.id} registered`, { assetId: asset.id });
    return { ...asset };
  }

  listAssets(projectId) {
    return this.store.getAll('assets').filter(a => a.project_id === projectId);
  }

  createProcessingJob(input) {
    if (!input || !input.source_path) throw new ValidationError('source_path is required');
    const job = {
      id: id(),
      type: input.task_type || 'stems',
      source_path: input.source_path,
      status: 'pending',
      created_at: now()
    };
    this.store.create('processing_jobs', job);
    this.eventBus.emit('processing.job.created', job);
    this.logger.info('repository', 'processing.job.created', `Job ${job.id} created`, { jobId: job.id });
    return { ...job };
  }

  getProcessingJob(id) {
    return ensureFound(this.store.getById('processing_jobs', id), 'Processing job not found');
  }

  listProcessingJobs() {
    return this.store.getAll('processing_jobs');
  }
}

function createRepository(options = {}) {
  const config = options.config || require('./config').createConfig();
  const logger = options.logger || createLogger(config);
  const transports = [new MemoryTransport()];
  if (config.eventLogPath) transports.push(new (require('./events/event-bus').FileTransport)(config.eventLogPath));
  const store = options.store || createStore({ type: 'memory' });
  const eventBus = options.eventBus || new EventBus(transports);
  const repo = new ResonateRepository(store, eventBus, logger);
  return repo;
}

module.exports = { ResonateRepository, createRepository };
