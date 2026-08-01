const { ValidationError } = require('./errors');

function requireString(input, key, options = {}) {
  const v = input != null ? input[key] : undefined;
  const s = v == null ? '' : String(v).trim();
  if (!s) throw new ValidationError(`${key} is required`, key);
  if (options.min != null && s.length < options.min) throw new ValidationError(`${key} too short`, key);
  if (options.max != null && s.length > options.max) throw new ValidationError(`${key} too long`, key);
  return s;
}

function requireDate(input, key) {
  const v = input != null ? input[key] : undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${key} must be a date`, key);
  return d.toISOString();
}

function requireOneOf(input, key, allowed) {
  const v = requireString(input, key);
  if (!allowed.includes(v)) throw new ValidationError(`${key} must be one of ${allowed.join(', ')}`, key);
  return v;
}

function boolOr(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes'].includes(String(value).toLowerCase());
}

function intOr(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

module.exports = { requireString, requireDate, requireOneOf, boolOr, intOr };
