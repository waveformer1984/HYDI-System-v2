const { ValidationError } = require('../errors');

class ProtoIYEngineAdapter {
  constructor(options = {}) {
    this.endpoint = (options.endpoint || 'http://localhost:5000').replace(/\/$/, '');
    this.eventBus = options.eventBus || null;
    this.logger = options.logger || { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    this.timeout = options.timeout || 5000;
  }

  _require(input, field) {
    if (input == null || input[field] == null || input[field] === '') {
      throw new ValidationError(`Missing required field: ${field}`);
    }
    return input[field];
  }

  async _post(path, payload) {
    const url = `${this.endpoint}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`Proto.I.Y engine returned ${res.status} for ${path}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
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
    const result = await this._post('/proto_iy/project', { name, category, owner_id });

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

  async createTimeline(input) {
    const project_id = this._require(input, 'project_id');
    const milestones = this._require(input, 'milestones');
    const start_date = this._require(input, 'start_date');
    const duration_days = this._require(input, 'duration_days');

    if (!Array.isArray(milestones) || milestones.length === 0) {
      throw new ValidationError('milestones must be a non-empty array');
    }

    this.logger.debug('adapter', 'timeline.create.request', { project_id, milestones, start_date, duration_days });
    await this._post('/proto_iy/timeline', { project_id, milestones, start_date, duration_days });

    const created = milestones.map(milestone => ({
      project_id,
      milestone,
      start_date,
      duration_days,
      status: 'created',
      created_at: new Date().toISOString()
    }));

    for (const item of created) {
      this._emit('milestone.created', item);
    }

    this.logger.info('adapter', 'timeline.created', `Timeline for project ${project_id} created with ${milestones.length} milestones`);
    return { ok: true, project_id, milestones: created };
  }

  async health() {
    const url = `${this.endpoint}/health`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      if (!res.ok) return { ok: false, status: 'unhealthy', endpoint: this.endpoint };
      const data = await res.json();
      return { ok: true, status: data.status || 'unknown', endpoint: this.endpoint, data };
    } catch (err) {
      return { ok: false, status: 'unreachable', endpoint: this.endpoint, error: err instanceof Error ? err.message : 'Unknown error' };
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { ProtoIYEngineAdapter };
