const { ValidationError } = require('../errors');
const { createFetchClient } = require('./http-client');

class ProtoIYEngineAdapter {
  constructor(options = {}) {
    this.client = options.client || createFetchClient(options.endpoint, { timeout: options.timeout, logger: options.logger });
    this.eventBus = options.eventBus || null;
    this.logger = options.logger || { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  }

  _require(input, field) {
    if (input == null || input[field] == null || input[field] === '') {
      throw new ValidationError(`Missing required field: ${field}`);
    }
    return input[field];
  }

  _emit(type, payload) {
    if (this.eventBus) {
      this.eventBus.emit(type, payload);
    } else {
      this.logger.warn('adapter', 'event.ignored', `No event bus configured for ${type}`);
    }
  }

  async createProject(input) {
    const name = this._require(input, 'name');
    const category = this._require(input, 'category');
    const owner_id = this._require(input, 'owner_id');

    this.logger.debug('adapter', 'project.create.request', { name, category, owner_id });
    const result = await this.client.post('/proto_iy/project', { name, category, owner_id });

    const project = {
      project_id: result.project_id,
      name,
      category,
      owner_id,
      status: 'created',
      created_at: new Date().toISOString()
    };

    this._emit('project.created', project);
    this.logger.info('adapter', 'project.created', `Project ${result.project_id} created via Proto.I.Y engine`);
    return { ok: true, project };
  }

  async getProject(id) {
    this.logger.debug('adapter', 'project.get', { project_id: id });
    const result = await this.client.get(`/proto_iy/project/${id}`);
    return { ok: true, project: result };
  }

  async createTimeline(input) {
    const project_id = this._require(input, 'project_id');
    const milestones = this._require(input, 'milestones');
    const start_date = this._require(input, 'start_date');
    const duration_days = this._require(input, 'duration_days');

    if (!Array.isArray(milestones) || milestones.length === 0) {
      throw new ValidationError('milestones must be a non-empty array');
    }

    this.logger.debug('adapter', 'timeline.create.request', { project_id, milestones, start_date, duration_days });
    await this.client.post('/proto_iy/timeline', { project_id, milestones, start_date, duration_days });

    const created = milestones.map(milestone => ({
      project_id,
      milestone,
      start_date,
      duration_days,
      status: 'reached',
      reached_at: new Date().toISOString()
    }));

    this._emit('timeline.created', {
      project_id,
      milestones: created,
      start_date,
      duration_days,
      created_at: new Date().toISOString()
    });

    for (const item of created) {
      this._emit('milestone.reached', item);
    }

    this.logger.info('adapter', 'timeline.created', `Timeline for project ${project_id} created with ${milestones.length} milestones`);
    return { ok: true, project_id, milestones: created };
  }

  async getTimeline(projectId) {
    this.logger.debug('adapter', 'timeline.get', { project_id: projectId });
    const result = await this.client.get(`/proto_iy/timeline/${projectId}`);
    return { ok: true, project_id: projectId, timeline: result };
  }

  async health() {
    const url = this.client.endpoint;
    this.logger.debug('adapter', 'health.check', url);
    try {
      const data = await this.client.get('/health');
      return { ok: true, status: data.status || 'unknown', endpoint: url, data };
    } catch (err) {
      return { ok: false, status: 'unreachable', endpoint: url, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }
}

module.exports = { ProtoIYEngineAdapter };
