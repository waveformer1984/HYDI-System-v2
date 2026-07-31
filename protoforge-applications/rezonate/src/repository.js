const crypto = require('crypto');
const { createStore } = require('./persistence');
const { EventBus, MemoryTransport } = require('./events/event-bus');
const { ValidationError, NotFoundError, ConflictError } = require('./errors');
const { createLogger } = require('./logger');
const { validateProject, validateAsset } = require('./validation');
const { ProcessingJob, STATES } = require('./domain/processing-job');
const { AudioAsset } = require('./domain/audio-asset');

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

  _pjDeps() {
    return { eventBus: this.eventBus, logger: this.logger };
  }

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
    const asset = new AudioAsset({ project_id: projectId, ...input }, this._pjDeps());
    this.store.create('assets', asset.toJSON());
    this.eventBus.emit('audio.asset.created', asset.toJSON());
    this.logger.info('repository', 'audio.asset.created', `Asset ${asset.id} registered`, { assetId: asset.id });
    return asset.toJSON();
  }

  getAsset(id) {
    const raw = ensureFound(this.store.getById('assets', id), 'Asset not found');
    return new AudioAsset(raw, this._pjDeps()).toJSON();
  }

  listAssets(projectId) {
    return this.store.getAll('assets').filter(a => a.project_id === projectId);
  }

  createProcessingJob(input) {
    if (!input || !input.task_type) throw new ValidationError('task_type is required');
    const job = new ProcessingJob({
      type: input.task_type,
      source_path: input.source_path,
      prompt: input.prompt,
      clip: input.clip
    }, this._pjDeps());
    this.store.create('processing_jobs', job.toJSON());
    this.eventBus.emit('processing.job.created', { entityId: job.id, newState: job.state, timestamp: job.createdAt, metadata: job.metadata });
    this.logger.info('repository', 'processing.job.created', `Job ${job.id} created`, { jobId: job.id });
    return { ...job.toJSON() };
  }

  _wrapJob(raw) {
    return new ProcessingJob(raw, this._pjDeps());
  }

  getProcessingJob(id) {
    const raw = ensureFound(this.store.getById('processing_jobs', id), 'Processing job not found');
    return this._wrapJob(raw).toJSON();
  }

  listProcessingJobs() {
    return this.store.getAll('processing_jobs');
  }

  startProcessingJob(id) {
    const raw = ensureFound(this.store.getById('processing_jobs', id), 'Processing job not found');
    const job = this._wrapJob(raw);
    const target = job.type === 'generate' ? STATES.GENERATING : job.type === 'stems' ? STATES.STEMS_PROCESSING : STATES.ANALYZING;
    job.transition(target);
    this.store.update('processing_jobs', id, job.toJSON());
    return job.toJSON();
  }

  completeProcessingJob(id, metadata = {}) {
    const raw = ensureFound(this.store.getById('processing_jobs', id), 'Processing job not found');
    const job = this._wrapJob(raw);
    job.transition(STATES.COMPLETED, metadata);
    this.store.update('processing_jobs', id, job.toJSON());
    return job.toJSON();
  }

  failProcessingJob(id, error) {
    const raw = ensureFound(this.store.getById('processing_jobs', id), 'Processing job not found');
    const job = this._wrapJob(raw);
    job.fail(error);
    this.store.update('processing_jobs', id, job.toJSON());
    return job.toJSON();
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

module.exports = { ResonateRepository, createRepository, STATES };
