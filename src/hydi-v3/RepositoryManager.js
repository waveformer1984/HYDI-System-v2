'use strict';

class RepositoryManager {
  constructor(config = {}) {
    this.repositories = new Map();
    this.logger = config.logger || console;
  }

  addRepository({ id, type, name, packages, url, offline }) {
    const repo = {
      id,
      name: name || id,
      type: type || 'local',
      url: url || null,
      offline: offline !== false,
      packages: new Map((packages || []).map((p) => [p.id, p])),
      lastSync: offline ? null : Date.now(),
    };
    this.repositories.set(id, repo);
    return repo;
  }

  search(query = {}) {
    const results = [];
    for (const repo of this.repositories.values()) {
      for (const cap of repo.packages.values()) {
        if (this._matches(cap, query)) results.push({ ...cap, repository: repo.id, offline: repo.offline });
      }
    }
    return results;
  }

  _matches(cap, query) {
    if (query.type && cap.type !== query.type) return false;
    if (query.category && cap.category !== query.category) return false;
    if (query.offline === true && cap.offlineCompatible === false) return false;
    if (query.q) {
      const q = query.q.toLowerCase();
      const hay = `${cap.id} ${cap.description} ${cap.category} ${cap.publisher}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  getCapability(id, repoId) {
    if (repoId) {
      const repo = this.repositories.get(repoId);
      return repo && repo.packages.has(id) ? repo.packages.get(id) : null;
    }
    for (const repo of this.repositories.values()) {
      if (repo.packages.has(id)) return { ...repo.packages.get(id), repository: repo.id, offline: repo.offline };
    }
    return null;
  }

  listRepositories() {
    return Array.from(this.repositories.values()).map((r) => ({ id: r.id, name: r.name, type: r.type, offline: r.offline, count: r.packages.size }));
  }

  sync(repoId) {
    const repo = this.repositories.get(repoId);
    if (!repo) return { success: false, error: 'repo_not_found' };
    if (repo.offline) return { success: true, offline: true, message: 'offline_repository_unchanged' };
    repo.lastSync = Date.now();
    return { success: true, updated: 0 };
  }

  publish(repoId, capability) {
    const repo = this.repositories.get(repoId);
    if (!repo) return { success: false, error: 'repo_not_found' };
    repo.packages.set(capability.id, capability);
    return { success: true, id: capability.id };
  }
}

module.exports = RepositoryManager;
