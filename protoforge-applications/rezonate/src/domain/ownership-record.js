const crypto = require('crypto');
const { ValidationError } = require('../errors');

const OWNERSHIP_TYPES = ['creator', 'collaborator', 'license'];
const OWNERSHIP_STATUSES = ['draft', 'verified', 'registered'];

const VALID_TRANSITIONS = {
  draft: ['verified'],
  verified: ['registered'],
  registered: []
};

const EVENT_MAP = {
  verified: 'ownership.verified',
  registered: 'rights.registered'
};

class OwnershipRecord {
  constructor(input = {}, deps = {}) {
    this.id = input.id || crypto.randomUUID();
    this.assetId = input.asset_id || input.assetId;
    this.creatorId = input.creator_id || input.creatorId;
    this.ownershipType = input.ownership_type || input.ownershipType || 'creator';
    this.percentage = input.percentage != null ? Number(input.percentage) : 100;
    this.status = input.status || 'draft';
    this.metadata = input.metadata || {};
    this.createdAt = input.created_at || input.createdAt || new Date().toISOString();
    this.updatedAt = input.updated_at || input.updatedAt || this.createdAt;
    this._eventBus = deps.eventBus;
    this._logger = deps.logger || { info: () => {}, warn: () => {} };

    this.validate();
  }

  toJSON() {
    return {
      id: this.id,
      asset_id: this.assetId,
      creator_id: this.creatorId,
      ownership_type: this.ownershipType,
      percentage: this.percentage,
      status: this.status,
      metadata: this.metadata,
      created_at: this.createdAt,
      updated_at: this.updatedAt
    };
  }

  validate() {
    if (!this.assetId) throw new ValidationError('asset_id is required', 'asset_id');
    if (!this.creatorId) throw new ValidationError('creator_id is required', 'creator_id');
    if (!OWNERSHIP_TYPES.includes(this.ownershipType)) {
      throw new ValidationError(`ownership_type must be one of ${OWNERSHIP_TYPES.join(', ')}`, 'ownership_type');
    }
    if (!OWNERSHIP_STATUSES.includes(this.status)) {
      throw new ValidationError(`status must be one of ${OWNERSHIP_STATUSES.join(', ')}`, 'status');
    }
    if (Number.isNaN(this.percentage) || this.percentage < 0 || this.percentage > 100) {
      throw new ValidationError('percentage must be between 0 and 100', 'percentage');
    }
  }

  canTransition(newStatus) {
    return VALID_TRANSITIONS[this.status].includes(newStatus);
  }

  transition(newStatus) {
    if (!OWNERSHIP_STATUSES.includes(newStatus)) {
      throw new ValidationError(`Invalid status: ${newStatus}`, 'status');
    }
    if (!this.canTransition(newStatus)) {
      throw new ValidationError(`Cannot transition from ${this.status} to ${newStatus}`, 'status');
    }
    const previous = this.status;
    this.status = newStatus;
    this.updatedAt = new Date().toISOString();
    this._emit(previous, newStatus);
    return this;
  }

  _emit(previous, newState) {
    const eventType = 'ownership.created';
    const payload = {
      entityId: this.id,
      assetId: this.assetId,
      previousStatus: previous,
      newStatus: newState,
      timestamp: this.updatedAt,
      metadata: this.toJSON()
    };
    if (this._eventBus) this._eventBus.emit(eventType, payload);
    this._logger.info('domain', eventType, `Ownership ${this.id} ${previous} → ${newState}`, payload);
  }

  static validateSplit(records) {
    if (!Array.isArray(records) || records.length === 0) {
      throw new ValidationError('At least one record is required for split', 'records');
    }
    const total = records.reduce((sum, r) => sum + Number(r.percentage || 0), 0);
    if (total > 100) throw new ValidationError('Split percentages cannot exceed 100%', 'percentage');
    return total;
  }
}

module.exports = { OwnershipRecord, OWNERSHIP_TYPES, OWNERSHIP_STATUSES };
