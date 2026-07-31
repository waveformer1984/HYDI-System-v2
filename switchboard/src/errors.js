class DomainError extends Error {
  constructor(message, status = 500, code = 'DomainError', field = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return { error: this.code, message: this.message, field: this.field, status: this.status };
  }
}

class ValidationError extends DomainError {
  constructor(message, field) { super(message, 400, 'ValidationError', field); }
}

class NotFoundError extends DomainError {
  constructor(message = 'Not found') { super(message, 404, 'NotFoundError'); }
}

class ConflictError extends DomainError {
  constructor(message) { super(message, 409, 'ConflictError'); }
}

class StorageError extends DomainError {
  constructor(message) { super(message, 500, 'StorageError'); }
}

class RateLimitError extends DomainError {
  constructor(message = 'Rate limit exceeded') { super(message, 429, 'RateLimitError'); }
}

module.exports = { DomainError, ValidationError, NotFoundError, ConflictError, StorageError, RateLimitError };
