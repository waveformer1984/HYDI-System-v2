const fs = require('fs');
const path = require('path');
const { JsonStore } = require('./persistence/json-store');

const startTime = Date.now();

function countByStatus(items, field) {
  return items.reduce((acc, it) => {
    const s = it[field] || 'unknown';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});
}

function collect(repository, config) {
  const store = repository.store;
  const state = store.load ? store.load() : store.state || {};
  const dbExists = fs.existsSync(config.dbPath);
  const backupDir = config.backupDir;
  const backups = backupDir && fs.existsSync(backupDir)
    ? fs.readdirSync(backupDir).filter(f => f.endsWith('.bak'))
    : [];

  const pendingModeration = [
    ...(state.messages || []).filter(m => m.quarantined),
    ...(state.applications || []).filter(a => a.quarantined)
  ].length;

  return {
    version: '0.1.0',
    schemaVersion: state.schemaVersion || null,
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    storage: {
      adapter: store.constructor.name,
      dbPath: config.dbPath,
      exists: dbExists,
      healthy: state.schemaVersion === 1
    },
    backup: {
      directory: backupDir,
      count: backups.length,
      latest: backups.length ? path.join(backupDir, backups.sort().reverse()[0]) : null
    },
    events: {
      transport: repository.eventBus.transports.map(t => t.constructor.name),
      count: repository.eventBus.transports[0] && repository.eventBus.transports[0].events ? repository.eventBus.transports[0].events.length : null
    },
    counts: {
      users: (state.users || []).length,
      venues: (state.venues || []).length,
      gigs: (state.gigs || []).length,
      applications: (state.applications || []).length,
      contracts: (state.contracts || []).length,
      payments: (state.payments || []).length,
      ratings: (state.ratings || []).length,
      audit: (state.audit_log || []).length
    },
    pending: {
      contracts: (state.contracts || []).filter(c => c.status === 'draft' || c.status === 'signed').length,
      payments: (state.payments || []).filter(p => p.status === 'pending').length,
      moderation: pendingModeration
    },
    lastAtomicWrite: store.lastAtomicWrite || null
  };
}

module.exports = { collect };
