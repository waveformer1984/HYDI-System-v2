// core/capability-registry.js
//
// Worker registration & lookup. Each worker declares the domains it handles
// (e.g., 'outreach', 'cad', 'analysis'). The semantic router picks the best
// match for a given intent. Designed to support the Pathways doc's
// "Capability Registry → Best Worker Selection" stage.
//
// Usage:
//   registry.register({
//     id: 'outreach-worker-01',
//     domains: ['outreach', 'email', 'lead'],
//     version: '1.0.0',
//     selfScore: (event) => 0.8, // optional, default 1.0
//     metadata: { instance: 'us-east' }
//   });
//   registry.find('outreach') // → matching workers

class CapabilityRegistry {
  constructor() {
    this.workers = new Map(); // id → worker
  }

  register(worker) {
    if (!worker || !worker.id) throw new Error('worker.id is required');
    if (!Array.isArray(worker.domains) || worker.domains.length === 0) {
      throw new Error(`worker ${worker.id} must declare at least one domain`);
    }
    const entry = {
      id: worker.id,
      domains: worker.domains.map((d) => String(d).toLowerCase()),
      version: worker.version || '0.0.0',
      selfScore: typeof worker.selfScore === 'function'
        ? worker.selfScore
        : () => 1.0,
      metadata: worker.metadata || {},
      registeredAt: new Date().toISOString()
    };
    // Preserve dispatch surface: in-process function takes priority over endpoint.
    if (typeof worker.execute === 'function') entry.execute = worker.execute;
    if (worker.endpoint) entry.endpoint = worker.endpoint;
    this.workers.set(worker.id, entry);
    return this.workers.get(worker.id);
  }

  unregister(id) {
    return this.workers.delete(id);
  }

  get(id) {
    return this.workers.get(id);
  }

  list() {
    return Array.from(this.workers.values());
  }

  // Find all workers that handle a given domain (case-insensitive).
  find(domain) {
    const d = String(domain).toLowerCase();
    return this.list().filter((w) => w.domains.includes(d));
  }

  // Find workers whose domains overlap with any of the given domain candidates.
  findAny(domains) {
    const set = new Set(domains.map((d) => String(d).toLowerCase()));
    return this.list().filter((w) => w.domains.some((d) => set.has(d)));
  }

  snapshot() {
    return this.list().map((w) => ({
      id: w.id,
      domains: w.domains,
      version: w.version,
      metadata: w.metadata,
      registeredAt: w.registeredAt
    }));
  }
}

module.exports = { CapabilityRegistry };
