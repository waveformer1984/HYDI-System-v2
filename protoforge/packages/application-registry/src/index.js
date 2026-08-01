const fs = require('fs');
const path = require('path');
const { discover } = require('../../../packages/application-manifest/src/index');

const LIFECYCLE_STATES = Object.freeze([
  'created',
  'registered',
  'active',
  'degraded',
  'deprecated',
  'archived'
]);

const VALID_TRANSITIONS = Object.freeze({
  created: ['registered'],
  registered: ['active'],
  active: ['degraded', 'deprecated'],
  degraded: ['active', 'deprecated', 'archived'],
  deprecated: ['archived'],
  archived: []
});

function isValidState(state) {
  return LIFECYCLE_STATES.includes(state);
}

function canTransition(from, to) {
  if (!isValidState(from) || !isValidState(to)) return false;
  if (from === to) return true;
  return VALID_TRANSITIONS[from].includes(to);
}

class ApplicationRegistry {
  constructor(options = {}) {
    this.applications = new Map();
    const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
    this.searchDirs = options.searchDirs || [
      path.join(repoRoot, 'switchboard'),
      path.join(repoRoot, 'protoforge-applications')
    ];
    if (options.autoLoad !== false) {
      this.loadFromManifests();
    }
  }

  _now() {
    return new Date().toISOString();
  }

  _normalizeName(name) {
    return name.toLowerCase().replace(/[\s_-]/g, '');
  }

  loadFromManifests() {
    const manifests = discover(this.searchDirs);
    for (const manifest of manifests) {
      this.register({
        name: manifest.name,
        version: manifest.version,
        capabilities: manifest.capabilities,
        eventsProduced: manifest.eventsProduced,
        eventsConsumed: manifest.eventsConsumed,
        providers: manifest.providers,
        dependencies: manifest.dependencies,
        healthRequirements: manifest.healthRequirements,
        status: manifest.deprecated ? 'deprecated' : 'active',
        owner: manifest.owner || null,
        registeredAt: this._now()
      });
    }
    return this.list();
  }

  register(app) {
    if (!app || typeof app !== 'object') {
      throw new TypeError('Application must be an object');
    }
    if (!app.name || typeof app.name !== 'string') {
      throw new Error('Application name is required');
    }
    const key = this._normalizeName(app.name);
    const status = app.status || 'created';
    if (!isValidState(status)) {
      throw new Error(`Invalid lifecycle state: ${status}`);
    }

    const existing = this.applications.get(key);
    const record = {
      ...app,
      status,
      version: app.version || '0.0.0',
      registeredAt: app.registeredAt || this._now(),
      updatedAt: this._now(),
      previousStatus: existing ? existing.status : null
    };
    this.applications.set(key, record);
    return record;
  }

  get(name) {
    return this.applications.get(this._normalizeName(name)) || null;
  }

  list() {
    return [...this.applications.values()];
  }

  getByStatus(status) {
    return this.list().filter(a => a.status === status);
  }

  transition(name, next) {
    const key = this._normalizeName(name);
    const app = this.applications.get(key);
    if (!app) {
      return { ok: false, error: `Application not found: ${name}` };
    }
    if (!isValidState(next)) {
      return { ok: false, error: `Invalid lifecycle state: ${next}` };
    }
    if (!canTransition(app.status, next)) {
      return { ok: false, error: `Cannot transition ${app.status} -> ${next}` };
    }
    const updated = {
      ...app,
      status: next,
      previousStatus: app.status,
      updatedAt: this._now()
    };
    this.applications.set(key, updated);
    return { ok: true, application: updated };
  }

  deprecate(name) {
    return this.transition(name, 'deprecated');
  }

  archive(name) {
    return this.transition(name, 'archived');
  }

  activate(name) {
    return this.transition(name, 'active');
  }

  delete(name) {
    return this.applications.delete(this._normalizeName(name));
  }

  versions(name) {
    const app = this.get(name);
    return app ? [app.version] : [];
  }
}

module.exports = {
  ApplicationRegistry,
  LIFECYCLE_STATES,
  VALID_TRANSITIONS,
  isValidState,
  canTransition
};
