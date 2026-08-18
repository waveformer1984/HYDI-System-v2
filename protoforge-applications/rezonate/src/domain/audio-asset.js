const crypto = require('crypto');
const { ValidationError } = require('../errors');

const ASSET_TYPES = ['stem', 'sample', 'vocal', 'instrument', 'mix', 'generated_song'];
const OWNERSHIP_STATUSES = ['draft', 'registered', 'minted', 'listed'];

class AudioAsset {
  constructor(input = {}, deps = {}) {
    this.id = input.id || crypto.randomUUID();
    this.projectId = input.project_id || input.projectId || null;
    this.type = input.type || 'sample';
    this.sourceTrack = input.source_track || input.sourceTrack || null;
    this.filePath = input.file_path || input.filePath || null;
    this.bpm = input.bpm != null ? Number(input.bpm) : null;
    this.key = input.key || null;
    this.metadata = input.metadata || {};
    this.ownershipStatus = input.ownership_status || input.ownershipStatus || 'draft';
    this.createdAt = input.created_at || input.createdAt || new Date().toISOString();
    this.updatedAt = input.updated_at || input.updatedAt || this.createdAt;
    this._eventBus = deps.eventBus;
    this._logger = deps.logger || { info: () => {} };

    this.validate();
  }

  toJSON() {
    return {
      id: this.id,
      project_id: this.projectId,
      type: this.type,
      source_track: this.sourceTrack,
      file_path: this.filePath,
      bpm: this.bpm,
      key: this.key,
      metadata: this.metadata,
      ownership_status: this.ownershipStatus,
      created_at: this.createdAt,
      updated_at: this.updatedAt
    };
  }

  validate() {
    if (!ASSET_TYPES.includes(this.type)) {
      throw new ValidationError(`asset type must be one of ${ASSET_TYPES.join(', ')}`, 'type');
    }
    if (!OWNERSHIP_STATUSES.includes(this.ownershipStatus)) {
      throw new ValidationError(`ownership status must be one of ${OWNERSHIP_STATUSES.join(', ')}`, 'ownership_status');
    }
    if (this.filePath != null && typeof this.filePath !== 'string') {
      throw new ValidationError('file_path must be a string', 'file_path');
    }
    if (this.bpm != null && (Number.isNaN(this.bpm) || this.bpm < 0)) {
      throw new ValidationError('bpm must be a non-negative number', 'bpm');
    }
  }

  updateMetadata(updates) {
    this.metadata = { ...this.metadata, ...updates };
    this.updatedAt = new Date().toISOString();
    this._emit('audio.asset.updated', { field: 'metadata' });
    return this;
  }

  setOwnershipStatus(status) {
    if (!OWNERSHIP_STATUSES.includes(status)) {
      throw new ValidationError(`ownership status must be one of ${OWNERSHIP_STATUSES.join(', ')}`, 'ownership_status');
    }
    const previous = this.ownershipStatus;
    this.ownershipStatus = status;
    this.updatedAt = new Date().toISOString();
    this._emit('ownership.status_changed', { previous, new: status });
    return this;
  }

  _emit(type, metadata) {
    const payload = {
      entityId: this.id,
      assetType: this.type,
      timestamp: this.updatedAt,
      metadata
    };
    if (this._eventBus) this._eventBus.emit(type, payload);
    this._logger.info('domain', type, `Asset ${this.id} updated`, payload);
  }
}

module.exports = { AudioAsset, ASSET_TYPES, OWNERSHIP_STATUSES };
