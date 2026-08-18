const crypto = require('crypto');
const { ValidationError } = require('../errors');

const RIGHT_TYPES = ['composition', 'sample', 'performance', 'master', 'synchronization'];

class Rights {
  constructor(input = {}, deps = {}) {
    this.id = input.id || crypto.randomUUID();
    this.assetId = input.asset_id || input.assetId;
    this.rights = input.rights || [];
    this.collaborators = input.collaborators || [];
    this.createdAt = input.created_at || input.createdAt || new Date().toISOString();
    this.updatedAt = input.updated_at || input.updatedAt || this.createdAt;
    this._eventBus = deps.eventBus;
    this._logger = deps.logger || { info: () => {} };

    this.validate();
  }

  toJSON() {
    return {
      id: this.id,
      asset_id: this.assetId,
      rights: this.rights,
      collaborators: this.collaborators,
      created_at: this.createdAt,
      updated_at: this.updatedAt
    };
  }

  validate() {
    if (!this.assetId) throw new ValidationError('asset_id is required', 'asset_id');
    for (const right of this.rights) {
      if (!RIGHT_TYPES.includes(right.type)) {
        throw new ValidationError(`right type must be one of ${RIGHT_TYPES.join(', ')}`, 'type');
      }
      if (right.percentage != null && (right.percentage < 0 || right.percentage > 100)) {
        throw new ValidationError('right percentage must be between 0 and 100', 'percentage');
      }
    }
    this._validateCollaboratorPercentages();
  }

  _validateCollaboratorPercentages() {
    const total = this.collaborators.reduce((sum, c) => sum + Number(c.percentage || 0), 0);
    if (total > 100) throw new ValidationError('Collaborator split percentages cannot exceed 100%', 'percentage');
  }

  addRight(right) {
    if (!RIGHT_TYPES.includes(right.type)) {
      throw new ValidationError(`right type must be one of ${RIGHT_TYPES.join(', ')}`, 'type');
    }
    this.rights.push(right);
    this.updatedAt = new Date().toISOString();
    this._emit('rights.registered', { right });
    return this;
  }

  addCollaborator(collaborator) {
    if (!collaborator.creator_id && !collaborator.owner) {
      throw new ValidationError('collaborator must have creator_id or owner', 'collaborator');
    }
    this.collaborators.push({
      id: crypto.randomUUID(),
      creator_id: collaborator.creator_id || collaborator.owner,
      percentage: Number(collaborator.percentage || 0),
      role: collaborator.role || 'collaborator',
      created_at: new Date().toISOString()
    });
    this._validateCollaboratorPercentages();
    this.updatedAt = new Date().toISOString();
    this._emit('collaborator.added', { collaborator });
    this._emitRoyaltyIfSplit();
    return this;
  }

  _emitRoyaltyIfSplit() {
    if (this.collaborators.length >= 1) {
      this._emit('royalty.created', {
        assetId: this.assetId,
        splits: this.collaborators.map(c => ({ owner: c.creator_id, percentage: c.percentage }))
      });
    }
  }

  hasSampleSources() {
    return this.rights.some(r => r.type === 'sample' && r.source);
  }

  _emit(type, metadata) {
    const payload = {
      entityId: this.id,
      assetId: this.assetId,
      timestamp: this.updatedAt,
      metadata
    };
    if (this._eventBus) this._eventBus.emit(type, payload);
    this._logger.info('domain', type, `Rights ${this.id} updated`, payload);
  }
}

module.exports = { Rights, RIGHT_TYPES };
