class DomainError extends Error {
  constructor(message, field) {
    super(message);
    this.name = this.constructor.name;
    this.field = field || null;
  }
}

class ValidationError extends DomainError {}
class NotFoundError extends DomainError {}
class ConflictError extends DomainError {}

module.exports = { DomainError, ValidationError, NotFoundError, ConflictError };
