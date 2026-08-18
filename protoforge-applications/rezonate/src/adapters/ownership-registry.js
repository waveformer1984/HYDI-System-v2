const crypto = require('crypto');

const OWNERSHIP_STATUSES = ['draft', 'verified', 'registered'];

class OwnershipRegistryAdapter {
  constructor(options = {}) {
    this.eventBus = options.eventBus;
    this.logger = options.logger || { info: () => {}, warn: () => {} };
    this.records = new Map();
  }

  registerAsset(assetId, owner, input = {}) {
    if (!assetId) return { ok: false, error: 'assetId is required' };
    if (!owner) return { ok: false, error: 'owner is required' };
    const record = {
      id: crypto.randomUUID(),
      asset_id: assetId,
      owner,
      ownership_type: input.ownership_type || 'creator',
      splits: input.splits || [],
      status: 'draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: input.metadata || {}
    };
    this.records.set(record.id, record);
    this._emit('ownership.created', { record });
    this.logger.info('ownership', 'ownership.created', `Asset ${assetId} registered`, { registryId: record.id });
    return { ok: true, registryId: record.id, record };
  }

  verifyOwnership(registryId) {
    const record = this.records.get(registryId);
    if (!record) return { ok: false, error: 'ownership record not found' };
    if (record.status !== 'draft') return { ok: false, error: 'record cannot be verified' };
    record.status = 'verified';
    record.updated_at = new Date().toISOString();
    this._emit('ownership.verified', { registryId, record });
    this.logger.info('ownership', 'ownership.verified', `Ownership ${registryId} verified`, { registryId });
    return { ok: true, record };
  }

  getOwnershipRecord(registryId) {
    const record = this.records.get(registryId) || null;
    return { ok: !!record, record };
  }

  listRecordsForAsset(assetId) {
    return [...this.records.values()].filter(r => r.asset_id === assetId);
  }

  _emit(type, metadata) {
    if (this.eventBus) this.eventBus.emit(type, metadata);
  }
}

module.exports = { OwnershipRegistryAdapter, OWNERSHIP_STATUSES };
