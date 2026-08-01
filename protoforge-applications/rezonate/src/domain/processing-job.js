const crypto = require('crypto');
const { ValidationError } = require('../errors');

const STATES = {
  QUEUED: 'queued',
  GENERATING: 'generating',
  STEMS_PROCESSING: 'stems_processing',
  ANALYZING: 'analyzing',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

const VALID_TRANSITIONS = {
  [STATES.QUEUED]: [STATES.GENERATING, STATES.STEMS_PROCESSING, STATES.ANALYZING, STATES.FAILED],
  [STATES.GENERATING]: [STATES.STEMS_PROCESSING, STATES.ANALYZING, STATES.COMPLETED, STATES.FAILED],
  [STATES.STEMS_PROCESSING]: [STATES.ANALYZING, STATES.COMPLETED, STATES.FAILED],
  [STATES.ANALYZING]: [STATES.COMPLETED, STATES.FAILED],
  [STATES.COMPLETED]: [STATES.FAILED],
  [STATES.FAILED]: []
};

const EVENT_MAP = {
  [STATES.GENERATING]: 'processing.started',
  [STATES.STEMS_PROCESSING]: 'stems.processing.started',
  [STATES.ANALYZING]: 'analysis.started',
  [STATES.COMPLETED]: 'processing.completed',
  [STATES.FAILED]: 'processing.failed'
};

class ProcessingJob {
  constructor(input = {}, deps = {}) {
    this.id = input.id || crypto.randomUUID();
    this.type = input.type || 'stems';
    this.projectId = input.project_id || input.projectId || null;
    this.sourcePath = input.source_path || input.sourcePath || null;
    this.prompt = input.prompt || null;
    this.clip = input.clip || false;
    this.state = input.state || STATES.QUEUED;
    this.error = input.error || null;
    this.metadata = input.metadata || {};
    this.createdAt = input.created_at || input.createdAt || new Date().toISOString();
    this.updatedAt = input.updated_at || input.updatedAt || this.createdAt;
    this._eventBus = deps.eventBus;
    this._logger = deps.logger || { warn: () => {}, info: () => {} };

    if (!Object.values(STATES).includes(this.state)) {
      throw new ValidationError(`Invalid state: ${this.state}`);
    }
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      project_id: this.projectId,
      source_path: this.sourcePath,
      prompt: this.prompt,
      clip: this.clip,
      state: this.state,
      error: this.error,
      metadata: this.metadata,
      created_at: this.createdAt,
      updated_at: this.updatedAt
    };
  }

  canTransition(newState) {
    return VALID_TRANSITIONS[this.state].includes(newState);
  }

  transition(newState, metadata = {}) {
    if (!Object.values(STATES).includes(newState)) {
      throw new ValidationError(`Invalid target state: ${newState}`);
    }
    if (!this.canTransition(newState)) {
      throw new ValidationError(`Cannot transition from ${this.state} to ${newState}`);
    }
    const previous = this.state;
    this.state = newState;
    this.updatedAt = new Date().toISOString();
    this.metadata = { ...this.metadata, ...metadata };
    this._emit(previous, newState, this.metadata);
    return this;
  }

  fail(error) {
    this.error = error instanceof Error ? error.message : String(error);
    this.transition(STATES.FAILED, { error: this.error });
    return this;
  }

  _emit(previousState, newState, metadata) {
    const eventType = EVENT_MAP[newState] || 'processing.state_changed';
    const payload = {
      entityId: this.id,
      previousState,
      newState,
      timestamp: this.updatedAt,
      metadata
    };
    if (this._eventBus) this._eventBus.emit(eventType, payload);
    this._logger.info('domain', eventType, `Job ${this.id} ${previousState} → ${newState}`, payload);
  }

  static STATES() {
    return { ...STATES };
  }
}

module.exports = { ProcessingJob, STATES };
