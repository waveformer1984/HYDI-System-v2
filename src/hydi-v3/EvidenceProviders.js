'use strict';

function makeItem(event, source, overrides = {}) {
  return {
    id: `ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: event.type || 'unknown',
    source,
    at: event.at || Date.now(),
    provenance: overrides.provenance || `${source}:${event.source || 'unknown'}`,
    relevance: Number.isFinite(overrides.relevance) ? overrides.relevance : 0.5,
    weight: Number.isFinite(overrides.weight) ? overrides.weight : 0.5,
    confidence: Number.isFinite(overrides.confidence) ? overrides.confidence : 0.5,
    data: overrides.data !== undefined ? overrides.data : { value: 1 },
    tags: Array.isArray(overrides.tags) ? overrides.tags : [source, event.type].filter(Boolean),
  };
}

function gitExtractor(event) {
  const type = event.type;
  if (type === 'CommitCreated') return makeItem(event, 'git', { relevance: 0.8, weight: 0.7, confidence: 0.9, data: { value: 1, kpiImpact: 'engineeringVelocity' } });
  if (type === 'WorkingTreeDirty') return makeItem(event, 'git', { relevance: 0.4, weight: 0.3, confidence: 0.6, data: { value: -0.2 } });
  if (type === 'BranchStale') return makeItem(event, 'git', { relevance: 0.6, weight: 0.4, confidence: 0.7, data: { value: -0.3 } });
  return makeItem(event, 'git', { relevance: 0.5, weight: 0.4, confidence: 0.7 });
}

function filesystemExtractor(event) {
  const type = event.type;
  if (type === 'FileCreated' || type === 'DirectoryCreated') return makeItem(event, 'filesystem', { relevance: 0.6, weight: 0.5, confidence: 0.7, data: { value: 0.5 } });
  if (type === 'FileDeleted' || type === 'DirectoryDeleted') return makeItem(event, 'filesystem', { relevance: 0.5, weight: 0.4, confidence: 0.6, data: { value: -0.2 } });
  return makeItem(event, 'filesystem', { relevance: 0.4, weight: 0.3, confidence: 0.6 });
}

function manufacturingExtractor(event) {
  const type = event.type;
  if (type === 'PrinterCompleted') return makeItem(event, 'manufacturing', { relevance: 0.9, weight: 0.8, confidence: 0.9, data: { value: 1, kpiImpact: 'manufacturingThroughput' } });
  if (type === 'PrinterFailed') return makeItem(event, 'manufacturing', { relevance: 0.9, weight: 0.8, confidence: 0.9, data: { value: -1 } });
  if (type === 'PrinterPaused' || type === 'PrinterIdle' || type === 'MaterialLow') return makeItem(event, 'manufacturing', { relevance: 0.5, weight: 0.4, confidence: 0.7, data: { value: -0.3 } });
  return makeItem(event, 'manufacturing', { relevance: 0.5, weight: 0.4, confidence: 0.7 });
}

function genericExtractor(event, source) {
  return makeItem(event, source, { relevance: 0.4, weight: 0.3, confidence: 0.5 });
}

class EvidenceProviders {
  constructor() {
    this.providers = new Map();
  }

  registerDefaults() {
    this.register('git', gitExtractor);
    this.register('filesystem', filesystemExtractor);
    this.register('manufacturing', manufacturingExtractor);
    this.register('inventory', (event) => genericExtractor(event, 'inventory'));
    this.register('financial', (event) => genericExtractor(event, 'financial'));
    this.register('calendar', (event) => genericExtractor(event, 'calendar'));
    this.register('customer', (event) => genericExtractor(event, 'customer'));
    this.register('manual', () => null);
    return this;
  }

  register(name, extractor) {
    if (!name || typeof extractor !== 'function') {
      throw new Error('Evidence provider requires a name and an extractor function');
    }
    this.providers.set(name, { name, extract: extractor });
    return this;
  }

  get(name) {
    return this.providers.get(name);
  }

  list() {
    return Array.from(this.providers.keys());
  }

  extract(source, event) {
    const provider = this.providers.get(source);
    if (!provider) return null;
    const result = provider.extract(event);
    if (!result) return null;
    if (Array.isArray(result)) return result;
    return [result];
  }
}

module.exports = { EvidenceProviders, makeItem, genericExtractor };
