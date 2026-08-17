const { ValidationError } = require('./errors');

const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

function isString(value) { return typeof value === 'string'; }
function isNumber(value) { return typeof value === 'number' && !Number.isNaN(value); }
function isInteger(value) { return Number.isInteger(value); }

function present(value) {
  return value !== undefined && value !== null && value !== '';
}

function requireString(obj, field, opts = {}) {
  const value = obj[field];
  if (!present(value)) throw new ValidationError(`${field} is required`, field);
  if (!isString(value)) throw new ValidationError(`${field} must be a string`, field);
  if (opts.min && value.length < opts.min) throw new ValidationError(`${field} must be at least ${opts.min} characters`, field);
  if (opts.max && value.length > opts.max) throw new ValidationError(`${field} must be at most ${opts.max} characters`, field);
  if (opts.email && !EMAIL_RE.test(value)) throw new ValidationError(`${field} must be a valid email`, field);
  if (opts.enum && !opts.enum.includes(value)) throw new ValidationError(`${field} must be one of ${opts.enum.join(', ')}`, field);
  if (opts.pattern && !opts.pattern.test(value)) throw new ValidationError(`${field} format is invalid`, field);
  return value;
}

function requireNumber(obj, field, opts = {}) {
  const value = obj[field];
  if (value === undefined || value === null) throw new ValidationError(`${field} is required`, field);
  if (!isNumber(value)) throw new ValidationError(`${field} must be a number`, field);
  if (opts.min !== undefined && value < opts.min) throw new ValidationError(`${field} must be at least ${opts.min}`, field);
  if (opts.max !== undefined && value > opts.max) throw new ValidationError(`${field} must be at most ${opts.max}`, field);
  return value;
}

function requireInteger(obj, field, opts = {}) {
  const value = obj[field];
  if (value === undefined || value === null) throw new ValidationError(`${field} is required`, field);
  if (!isInteger(value)) throw new ValidationError(`${field} must be an integer`, field);
  if (opts.min !== undefined && value < opts.min) throw new ValidationError(`${field} must be at least ${opts.min}`, field);
  if (opts.max !== undefined && value > opts.max) throw new ValidationError(`${field} must be at most ${opts.max}`, field);
  return value;
}

function requireDate(obj, field) {
  const value = obj[field];
  if (!present(value)) throw new ValidationError(`${field} is required`, field);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${field} must be a valid ISO 8601 date`, field);
  return value;
}

function requireOneOf(obj, field, values) {
  const value = obj[field];
  if (!present(value)) throw new ValidationError(`${field} is required`, field);
  if (!values.includes(value)) throw new ValidationError(`${field} must be one of ${values.join(', ')}`, field);
  return value;
}

function optionalString(obj, field, opts = {}) {
  const value = obj[field];
  if (!present(value)) return null;
  return requireString({ [field]: value }, field, opts);
}

function validateUser(input) {
  return {
    email: requireString(input, 'email', { email: true, max: 254 }),
    password: requireString(input, 'password', { min: 4, max: 128 }),
    name: requireString(input, 'name', { min: 1, max: 128 }),
    role: requireOneOf(input, 'role', ['performer', 'venue', 'admin']),
    age: input.age !== undefined ? requireInteger(input, 'age', { min: 1, max: 120 }) : null,
    parent_email: optionalString(input, 'parent_email', { email: true, max: 254 }),
    parent_approved: input.parent_approved === true || input.parent_approved === 1,
    skills: Array.isArray(input.skills) ? input.skills.filter(s => typeof s === 'string' && s.length <= 64) : [],
    latitude: input.latitude !== undefined ? requireNumber(input, 'latitude', { min: -90, max: 90 }) : null,
    longitude: input.longitude !== undefined ? requireNumber(input, 'longitude', { min: -180, max: 180 }) : null,
    bio: optionalString(input, 'bio', { max: 2048 })
  };
}

function validateGig(input) {
  return {
    venue_id: requireString(input, 'venue_id'),
    title: requireString(input, 'title', { min: 1, max: 200 }),
    description: optionalString(input, 'description', { max: 4000 }),
    required_skills: Array.isArray(input.required_skills) ? input.required_skills.filter(s => typeof s === 'string' && s.length <= 64) : [],
    start_time: requireDate(input, 'start_time'),
    end_time: requireDate(input, 'end_time'),
    min_age: input.min_age !== undefined ? requireInteger(input, 'min_age', { min: 0, max: 120 }) : null,
    max_age: input.max_age !== undefined ? requireInteger(input, 'max_age', { min: 0, max: 120 }) : null,
    latitude: input.latitude !== undefined ? requireNumber(input, 'latitude', { min: -90, max: 90 }) : null,
    longitude: input.longitude !== undefined ? requireNumber(input, 'longitude', { min: -180, max: 180 }) : null,
    budget: input.budget !== undefined ? requireNumber(input, 'budget', { min: 0 }) : null,
    owner_id: optionalString(input, 'owner_id')
  };
}

function validateVenue(input) {
  return {
    owner_id: requireString(input, 'owner_id'),
    name: requireString(input, 'name', { min: 1, max: 200 }),
    address: optionalString(input, 'address', { max: 500 }),
    latitude: input.latitude !== undefined ? requireNumber(input, 'latitude', { min: -90, max: 90 }) : null,
    longitude: input.longitude !== undefined ? requireNumber(input, 'longitude', { min: -180, max: 180 }) : null,
    contact_email: optionalString(input, 'contact_email', { email: true, max: 254 })
  };
}

module.exports = {
  requireString,
  requireNumber,
  requireInteger,
  requireDate,
  requireOneOf,
  optionalString,
  validateUser,
  validateGig,
  validateVenue
};
